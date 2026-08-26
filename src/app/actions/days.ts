'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser, scopeBuyerId } from '@/lib/auth';
import { grossUp } from '@/lib/money';
import { periodKey } from '@/lib/period';
import { canSeeTeam, type Role } from '@/lib/roles';

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
  const period = await prisma.period.findUnique({ where: { key: periodKey(date) } });
  return period?.status === 'CLOSED' ? 'Период закрыт — правки заблокированы.' : null;
}

/** Buyers may only ever write rows for themselves. */
async function assertCanWriteFor(buyerId: string) {
  const user = await requireUser();
  const scoped = scopeBuyerId(user);
  if (scoped && scoped !== buyerId) return { user, error: 'Нет доступа к этому баеру.' };
  return { user, error: null as string | null };
}

export async function saveDay(input: unknown): Promise<ActionResult> {
  const parsed = DayInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверь поля формы.' };
  const data = parsed.data;

  const { user, error } = await assertCanWriteFor(data.buyerId);
  if (error) return { ok: false, error };

  const date = new Date(`${data.date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(date);
  if (closed) return { ok: false, error: closed };

  const method = data.paymentMethodId
    ? await prisma.paymentMethod.findUnique({ where: { id: data.paymentMethodId } })
    : null;
  const commissionBps = method?.commissionBps ?? 450;
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
  revalidatePath('/');
  revalidatePath('/peak');
  return { ok: true };
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
    return { ok: false, error: 'Импорт за команду доступен админу и тимлиду.' };
  }

  const parsed = z.array(ImportRow).safeParse(rows);
  if (!parsed.success || parsed.data.length === 0) return { ok: false, error: 'Нечего импортировать.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: 'Некорректная дата.' };

  const when = new Date(`${date}T00:00:00.000Z`);
  const closed = await assertPeriodOpen(when);
  if (closed) return { ok: false, error: closed };

  const buyers = await prisma.buyer.findMany({ where: { archived: false } });
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
  revalidatePath('/');
  revalidatePath('/peak');
  return { ok: true, imported, skipped };
}
