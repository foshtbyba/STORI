'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const dollars = (v: FormDataEntryValue | null) =>
  Number(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));

/** Утверждённый стартовый баланс овнера на дату-якорь. Только админ. */
export async function saveOwnerOpening(form: FormData) {
  const user = await requireAdmin();
  const buyerId = String(form.get('buyerId') ?? '');
  const amount = dollars(form.get('opening'));
  const dateStr = String(form.get('anchor') ?? '');
  if (!buyerId || !Number.isFinite(amount)) return;
  const anchorDate = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(anchorDate.getTime())) return;
  const openingCents = Math.round(amount * 100);
  const note = String(form.get('note') ?? '').trim().slice(0, 200);

  await prisma.ownerCapital.upsert({
    where: { buyerId },
    create: { buyerId, openingCents, anchorDate, note },
    update: { openingCents, anchorDate, note },
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'OwnerCapital',
      entityId: buyerId,
      action: 'treasury:opening',
      diffJson: JSON.stringify({ openingCents, anchorDate }),
    },
  });
  revalidatePath('/treasury');
}

/** Личный вывод овнера из оборота. Только админ. */
export async function addOwnerWithdrawal(form: FormData) {
  const user = await requireAdmin();
  const buyerId = String(form.get('buyerId') ?? '');
  const amount = dollars(form.get('amount'));
  const note = String(form.get('note') ?? '').trim().slice(0, 200);
  if (!buyerId || !Number.isFinite(amount) || amount <= 0) return;
  const amountCents = Math.round(amount * 100);
  await prisma.ownerWithdrawal.create({ data: { buyerId, amountCents, note } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'OwnerWithdrawal',
      entityId: buyerId,
      action: 'treasury:owner-withdraw',
      diffJson: JSON.stringify({ amountCents, note }),
    },
  });
  revalidatePath('/treasury');
}

export async function deleteOwnerWithdrawal(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (!id) return;
  await prisma.ownerWithdrawal.deleteMany({ where: { id } });
  revalidatePath('/treasury');
}

/**
 * Снимок реальных денег по источникам на дату. Дата уникальна — повторный
 * снимок на ту же дату перезаписывает (upsert), чтобы не плодить дубли.
 * Только админ.
 */
export async function saveSnapshot(form: FormData) {
  const user = await requireAdmin();
  const dateStr = String(form.get('date') ?? '');
  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) return;
  // Нормализуем к полуночи UTC — снимок привязан к дню, не к времени.
  date.setUTCHours(0, 0, 0, 0);

  const cents = (name: string) => {
    const v = dollars(form.get(name));
    return Number.isFinite(v) ? Math.round(v * 100) : 0;
  };
  const data = {
    partnersCents: cents('partners'),
    brocardCents: cents('brocard'),
    cardCents: cents('card'),
    agentsCents: cents('agents'),
    note: String(form.get('note') ?? '').trim().slice(0, 200),
  };
  // Запись снимка и запись в аудит независимы — пишем параллельно, чтобы не
  // ждать два круга к БД подряд.
  await Promise.all([
    prisma.treasurySnapshot.upsert({
      where: { date },
      create: { date, ...data },
      update: data,
    }),
    prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorName: user.name,
        entity: 'TreasurySnapshot',
        entityId: date.toISOString().slice(0, 10),
        action: 'treasury:snapshot',
        diffJson: JSON.stringify(data),
      },
    }),
  ]);
  revalidatePath('/treasury');
}

export async function deleteSnapshot(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (!id) return;
  const snap = await prisma.treasurySnapshot.findUnique({ where: { id } });
  if (!snap) return;
  // Снимок можно удалить только первые 3 дня — потом история заморожена.
  const SNAPSHOT_LOCK_MS = 3 * 24 * 60 * 60 * 1000;
  if (Date.now() - snap.createdAt.getTime() > SNAPSHOT_LOCK_MS) return;
  await prisma.treasurySnapshot.delete({ where: { id } });
  revalidatePath('/treasury');
}

/**
 * Прочее движение денег мимо дашборда: внешний залив, доход/расход не через
 * систему. direction 'in' — приход (+), 'out' — расход (−). scope 'owner'
 * требует buyerId, 'buyers' — по общему капиталу.
 */
export async function addAdjustment(form: FormData) {
  const user = await requireAdmin();
  const scope = String(form.get('scope') ?? '');
  const buyerId = String(form.get('buyerId') ?? '') || null;
  const direction = String(form.get('direction') ?? 'in');
  const amount = dollars(form.get('amount'));
  const note = String(form.get('note') ?? '').trim().slice(0, 200);
  const dateStr = String(form.get('date') ?? '');
  if (scope !== 'owner' && scope !== 'buyers') return;
  if (scope === 'owner' && !buyerId) return;
  if (!Number.isFinite(amount) || amount <= 0) return;
  const signed = direction === 'out' ? -Math.round(amount * 100) : Math.round(amount * 100);
  const date = dateStr ? new Date(dateStr) : new Date();
  if (Number.isNaN(date.getTime())) return;

  await prisma.capitalAdjustment.create({
    data: { scope, buyerId, amountCents: signed, note, date },
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'CapitalAdjustment',
      entityId: scope === 'owner' ? buyerId! : 'buyers',
      action: 'treasury:adjust',
      diffJson: JSON.stringify({ scope, buyerId, amountCents: signed, note }),
    },
  });
  revalidatePath('/treasury');
}

export async function deleteAdjustment(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (!id) return;
  await prisma.capitalAdjustment.deleteMany({ where: { id } });
  revalidatePath('/treasury');
}

/** Стартовая база фонда баеров (общий бюджет, с которого команда начала). */
export async function saveFundBase(form: FormData) {
  const user = await requireAdmin();
  const amount = dollars(form.get('base'));
  if (!Number.isFinite(amount)) return;
  const cents = Math.round(amount * 100);
  await prisma.setting.upsert({
    where: { key: 'fund_base_cents' },
    create: { key: 'fund_base_cents', value: String(cents) },
    update: { value: String(cents) },
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Setting',
      entityId: 'fund_base_cents',
      action: 'treasury:fund-base',
      diffJson: JSON.stringify({ cents }),
    },
  });
  revalidatePath('/treasury');
  revalidatePath('/dashboard');
}
