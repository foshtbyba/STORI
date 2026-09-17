'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { grossUp, DEFAULT_COMMISSION_BPS } from '@/lib/money';
import { periodKeyOf, isEditable } from '@/lib/period';
import { canSeeTeam, type Role } from '@/lib/roles';
import { GRID_CONSUMABLE_NOTE } from '@/lib/consumables';
import { AGENCY_SOURCE, AGENCY_COMMISSION_BPS } from '@/lib/extra-spend';

const DayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  buyerId: z.string().min(1),
  offerId: z.string().optional().nullable(),
  source: z.string().min(1).max(40),
  revenueCents: z.number().int().min(0),
  spendNetCents: z.number().int().min(0),
  paymentMethodId: z.string().optional().nullable(),
  /** Explicit gross wins over the computed one — that is what the team writes. */
  spendGrossCents: z.number().int().min(0).optional().nullable(),
  note: z.string().max(500).optional(),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

async function assertPeriodOpen(date: Date): Promise<string | null> {
  // Позапрошлая неделя и глубже правкам недоступна — только чтение. Текущую и
  // прошлую править ещё можно. Синхронизация сюда не заходит: запрет — про руки.
  if (!isEditable(date)) return 'Неделя старше прошлой — правки закрыты, только чтение.';
  const period = await prisma.period.findUnique({ where: { key: periodKeyOf(date) } });
  return period?.status === 'CLOSED' ? 'Период закрыт — правки заблокированы.' : null;
}

/**
 * Отчёты по дням заводит только админ или тимлид. Баер их видит у себя, но
 * не пишет: цифры дня — основа для зарплаты, и правка своей же строки была бы
 * конфликтом интересов.
 */
async function assertCanWrite() {
  const user = await requireUser();
  if (!canSeeTeam(user.role as Role)) {
    return { user, error: 'Отчёты заводит админ.' };
  }
  return { user, error: null as string | null };
}

export async function saveDay(input: unknown): Promise<ActionResult> {
  const parsed = DayInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверь поля формы.' };
  const data = parsed.data;

  const { user, error } = await assertCanWrite();
  if (error) return { ok: false, error };

  const date = new Date(`${data.date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(date);
  if (closed) return { ok: false, error: closed };

  const method = data.paymentMethodId
    ? await prisma.paymentMethod.findUnique({ where: { id: data.paymentMethodId } })
    : null;
  const commissionBps = method?.commissionBps ?? DEFAULT_COMMISSION_BPS;
  const spendGrossCents = data.spendGrossCents ?? grossUp(data.spendNetCents, commissionBps);

  const row = {
    date,
    buyerId: data.buyerId,
    offerId: data.offerId || null,
    source: data.source,
    revenueCents: data.revenueCents,
    spendNetCents: data.spendNetCents,
    paymentMethodId: data.paymentMethodId || null,
    commissionBps,
    spendGrossCents,
    note: data.note ?? '',
  };

  // SQLite treats NULLs as distinct in unique indexes, so a plain upsert would
  // happily create a second "no offer" row for the same day. Match by hand.
  const existing = await prisma.dayReport.findFirst({
    where: { buyerId: row.buyerId, date: row.date, source: row.source, offerId: row.offerId },
    select: { id: true },
  });
  const saved = existing
    ? await prisma.dayReport.update({ where: { id: existing.id }, data: row })
    : await prisma.dayReport.create({ data: row });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'DayReport',
      entityId: saved.id,
      action: 'upsert',
      diffJson: JSON.stringify(row),
    },
  });

  revalidatePath('/days');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true };
}

const GridRow = z.object({
  buyerId: z.string().min(1),
  revenueCents: z.number().int().min(0),
  spendNetCents: z.number().int().min(0),
  commissionBps: z.number().int().min(0).max(10_000),
  consumableCents: z.number().int().min(0),
});

/**
 * Отчёт за день таблицей: строка на баера, комиссия считается от чистого
 * расхода, расходники той же кнопкой уезжают именной строкой на свой экран.
 */
export async function saveDayGrid(
  date: string,
  typeId: string,
  rows: unknown,
): Promise<ActionResult & { saved?: number }> {
  const { user, error } = await assertCanWrite();
  if (error) return { ok: false, error };

  const parsed = z.array(GridRow).safeParse(rows);
  if (!parsed.success) return { ok: false, error: 'Проверь цифры в таблице.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Некорректная дата.' };

  const when = new Date(`${date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(when);
  if (closed) return { ok: false, error: closed };

  const wantsConsumables = parsed.data.some((r) => r.consumableCents > 0);
  if (wantsConsumables && !typeId) {
    return { ok: false, error: 'Выбери тип расходника.' };
  }

  // Овнеры тоже заводятся этой таблицей — их доход/расход вводят руками. В
  // командную стату они всё равно не попадают (teamSummary их исключает).
  const buyers = await prisma.buyer.findMany({ where: { archived: false } });
  const byId = new Map(buyers.map((b) => [b.id, b]));
  let saved = 0;

  for (const row of parsed.data) {
    const buyer = byId.get(row.buyerId);
    if (!buyer) continue;

    const filled = row.revenueCents > 0 || row.spendNetCents > 0;
    const existing = await prisma.dayReport.findFirst({
      where: { buyerId: buyer.id, date: when, source: buyer.source, offerId: null },
      select: { id: true },
    });

    if (filled) {
      const data = {
        date: when,
        buyerId: buyer.id,
        offerId: null,
        source: buyer.source,
        revenueCents: row.revenueCents,
        spendNetCents: row.spendNetCents,
        commissionBps: row.commissionBps,
        spendGrossCents: grossUp(row.spendNetCents, row.commissionBps),
        note: '',
      };
      const day = existing
        ? await prisma.dayReport.update({ where: { id: existing.id }, data })
        : await prisma.dayReport.create({ data });
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorName: user.name,
          entity: 'DayReport',
          entityId: day.id,
          action: 'grid',
          diffJson: JSON.stringify(data),
        },
      });
      saved += 1;
    } else if (existing) {
      // Строку очистили руками — убираем и запись, иначе она останется висеть.
      await prisma.dayReport.delete({ where: { id: existing.id } });
    }

    if (!typeId) continue;
    const entry = await prisma.consumableEntry.findFirst({
      where: { buyerId: buyer.id, date: when, typeId, note: GRID_CONSUMABLE_NOTE },
      select: { id: true },
    });
    if (row.consumableCents > 0) {
      const data = {
        date: when,
        buyerId: buyer.id,
        typeId,
        qty: 1,
        totalCents: row.consumableCents,
        note: GRID_CONSUMABLE_NOTE,
      };
      if (entry) await prisma.consumableEntry.update({ where: { id: entry.id }, data });
      else await prisma.consumableEntry.create({ data });
    } else if (entry) {
      await prisma.consumableEntry.delete({ where: { id: entry.id } });
    }
  }

  revalidatePath('/days');
  revalidatePath('/days/new');
  revalidatePath('/consumables');
  revalidatePath('/payroll');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true, saved };
}

const ExtraRow = z.object({
  buyerId: z.string().min(1),
  spendNetCents: z.number().int().min(0),
  note: z.string().max(200).default(''),
});

/**
 * Доп. расходы за день — агентские кабинеты.
 *
 * Пишутся отдельной строкой дня с источником «Агентка»: синхронизация ходит
 * только по строкам «Facebook», поэтому ручную цифру она не перепишет, а в
 * профит, ROI и зарплату строка попадёт сама — это обычный отчёт дня, просто
 * без дохода. Комиссия у агентки своя, 6%, и других сверху нет.
 *
 * Строка на баера за день одна: сумма по всем его агентским кабинетам разом,
 * подробности — в комментарии. Так же, как расход с Brocard: там тоже одна
 * цифра на день, а не по карте на строку.
 */
export async function saveExtraSpend(
  date: string,
  rows: unknown,
): Promise<ActionResult & { saved?: number }> {
  const { user, error } = await assertCanWrite();
  if (error) return { ok: false, error };

  const parsed = z.array(ExtraRow).safeParse(rows);
  if (!parsed.success) return { ok: false, error: 'Проверь суммы.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Некорректная дата.' };

  const when = new Date(`${date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(when);
  if (closed) return { ok: false, error: closed };

  const buyers = await prisma.buyer.findMany({
    where: { archived: false },
    select: { id: true },
  });
  const known = new Set(buyers.map((b) => b.id));
  let saved = 0;

  for (const row of parsed.data) {
    if (!known.has(row.buyerId)) continue;

    const existing = await prisma.dayReport.findFirst({
      where: { buyerId: row.buyerId, date: when, source: AGENCY_SOURCE, offerId: null },
      select: { id: true },
    });

    if (row.spendNetCents > 0) {
      const data = {
        date: when,
        buyerId: row.buyerId,
        offerId: null,
        source: AGENCY_SOURCE,
        // Дохода у строки нет: он приходит из Keitaro на основную строку дня и
        // уже посчитан. Здесь только расход, иначе доход учтётся дважды.
        revenueCents: 0,
        spendNetCents: row.spendNetCents,
        commissionBps: AGENCY_COMMISSION_BPS,
        spendGrossCents: grossUp(row.spendNetCents, AGENCY_COMMISSION_BPS),
        note: row.note,
      };
      const day = existing
        ? await prisma.dayReport.update({ where: { id: existing.id }, data })
        : await prisma.dayReport.create({ data });
      await prisma.auditLog.create({
        data: {
          actorId: user.id,
          actorName: user.name,
          entity: 'DayReport',
          entityId: day.id,
          action: 'extra',
          diffJson: JSON.stringify(data),
        },
      });
      saved += 1;
    } else if (existing) {
      // Сумму стёрли — убираем и строку, иначе она останется висеть в отчёте.
      await prisma.dayReport.delete({ where: { id: existing.id } });
    }
  }

  revalidatePath('/days');
  revalidatePath('/days/new');
  revalidatePath('/payroll');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true, saved };
}

const ImportRow = z.object({
  handle: z.string().min(1),
  revenueCents: z.number().int(),
  spendNetCents: z.number().int(),
  spendGrossCents: z.number().int(),
});

export async function importDays(
  date: string,
  rows: unknown,
): Promise<ActionResult & { imported?: number; skipped?: string[] }> {
  const user = await requireUser();
  if (!canSeeTeam(user.role as Role)) {
    return { ok: false, error: 'Импорт отчётов доступен админу.' };
  }

  const parsed = z.array(ImportRow).safeParse(rows);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, error: 'Нечего импортировать.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Некорректная дата.' };

  const when = new Date(`${date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(when);
  if (closed) return { ok: false, error: closed };

  const buyers = await prisma.buyer.findMany({ where: { archived: false, owner: false } });
  const byHandle = new Map(buyers.map((b) => [b.handle.toLowerCase(), b]));

  const skipped: string[] = [];
  let imported = 0;

  for (const row of parsed.data) {
    const buyer = byHandle.get(row.handle.toLowerCase());
    if (!buyer) {
      skipped.push(row.handle);
      continue;
    }
    const bps = row.spendNetCents
      ? Math.round((row.spendGrossCents / row.spendNetCents - 1) * 10_000)
      : 0;
    const data = {
      date: when,
      buyerId: buyer.id,
      offerId: null,
      source: buyer.source,
      revenueCents: row.revenueCents,
      spendNetCents: row.spendNetCents,
      commissionBps: bps,
      spendGrossCents: row.spendGrossCents,
      note: 'импорт строкой',
    };
    const existing = await prisma.dayReport.findFirst({
      where: { buyerId: buyer.id, date: when, source: buyer.source, offerId: null },
      select: { id: true },
    });
    const saved = existing
      ? await prisma.dayReport.update({ where: { id: existing.id }, data })
      : await prisma.dayReport.create({ data });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorName: user.name,
        entity: 'DayReport',
        entityId: saved.id,
        action: 'import',
        diffJson: JSON.stringify(data),
      },
    });
    imported += 1;
  }

  revalidatePath('/days');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true, imported, skipped };
}

const DayEdit = z.object({
  id: z.string().min(1),
  revenueCents: z.number().int().min(0),
  spendNetCents: z.number().int().min(0),
  commissionBps: z.number().int().min(0).max(10_000),
  note: z.string().max(500),
});

/** Правка уже записанного дня. Закрытый период не трогаем. */
export async function updateDay(input: unknown): Promise<ActionResult> {
  const { user, error } = await assertCanWrite();
  if (error) return { ok: false, error };

  const parsed = DayEdit.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверь цифры.' };

  const day = await prisma.dayReport.findUnique({ where: { id: parsed.data.id } });
  if (!day) return { ok: false, error: 'Такого дня уже нет.' };
  const closed = await assertPeriodOpen(day.date);
  if (closed) return { ok: false, error: closed };

  const data = {
    revenueCents: parsed.data.revenueCents,
    spendNetCents: parsed.data.spendNetCents,
    commissionBps: parsed.data.commissionBps,
    spendGrossCents: grossUp(parsed.data.spendNetCents, parsed.data.commissionBps),
    note: parsed.data.note,
  };
  await prisma.dayReport.update({ where: { id: day.id }, data });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'DayReport',
      entityId: day.id,
      action: 'edit',
      diffJson: JSON.stringify(data),
    },
  });

  revalidatePath('/days');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  revalidatePath('/payroll');
  return { ok: true };
}

export async function deleteDay(id: string): Promise<ActionResult> {
  const { user, error } = await assertCanWrite();
  if (error) return { ok: false, error };

  const day = await prisma.dayReport.findUnique({ where: { id } });
  if (!day) return { ok: true };
  const closed = await assertPeriodOpen(day.date);
  if (closed) return { ok: false, error: closed };

  await prisma.dayReport.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'DayReport',
      entityId: id,
      action: 'delete',
      diffJson: JSON.stringify({ date: day.date, buyerId: day.buyerId }),
    },
  });

  revalidatePath('/days');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  revalidatePath('/payroll');
  return { ok: true };
}
