'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireTeamView } from '@/lib/auth';
import { moneyInputToCents } from '@/lib/format';

const Input = z.object({
  buyerId: z.string().min(1),
  periodKey: z.string().regex(/^\d{4}-\d{2}$/),
  amountCents: z.number().int().min(1),
  note: z.string().max(200),
});

/**
 * Разовое начисление сверх процента. Суммы приходят в рублях — команда так
 * думает и так договаривается, — а хранятся в долларовых центах по курсу
 * периода, как и вся остальная арифметика.
 */
export async function addBonus(formData: FormData) {
  const user = await requireTeamView();

  const periodKey = String(formData.get('periodKey') ?? '');
  const currency = String(formData.get('currency') ?? 'RUB');
  const typed = moneyInputToCents(formData.get('amount'));

  const period = await prisma.period.findUnique({ where: { key: periodKey } });
  if (!period || period.status === 'CLOSED') return;

  const amountCents =
    currency === 'RUB' ? Math.round((typed * 100) / period.rubPerUsd) : typed;

  const parsed = Input.safeParse({
    buyerId: String(formData.get('buyerId') ?? ''),
    periodKey,
    amountCents,
    note: String(formData.get('note') ?? ''),
  });
  if (!parsed.success) return;

  const bonus = await prisma.bonus.create({ data: parsed.data });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Bonus',
      entityId: bonus.id,
      action: 'create',
      diffJson: JSON.stringify(parsed.data),
    },
  });

  revalidatePath('/payroll');
  revalidatePath('/');
}

export async function deleteBonus(formData: FormData) {
  const user = await requireTeamView();
  const id = String(formData.get('id') ?? '');

  const bonus = await prisma.bonus.findUnique({ where: { id } });
  if (!bonus) return;
  const period = await prisma.period.findUnique({ where: { key: bonus.periodKey } });
  if (period?.status === 'CLOSED') return;

  await prisma.bonus.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Bonus',
      entityId: id,
      action: 'delete',
      diffJson: JSON.stringify({ buyerId: bonus.buyerId, amountCents: bonus.amountCents }),
    },
  });

  revalidatePath('/payroll');
  revalidatePath('/');
}
