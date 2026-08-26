'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { teamSummary } from '@/lib/queries';

/**
 * Closing a period freezes its day reports and writes the payout each buyer is
 * owed, at the rate and FX in force right now. Reopening is deliberate and
 * audited — the numbers a buyer was shown should not move quietly.
 */
export async function closePeriod(key: string) {
  const user = await requireAdmin();
  const summary = await teamSummary(key);

  await prisma.$transaction(async (tx) => {
    for (const row of summary.buyers) {
      const data = {
        profitCents: row.profitCents,
        consumableCents: row.consumableCents,
        baseCents: row.baseCents,
        ratePct: row.ratePct,
        salaryCents: row.salaryCents,
        bonusCents: row.bonusCents,
        totalCents: row.totalCents,
      };
      await tx.payout.upsert({
        where: { periodId_buyerId: { periodId: summary.period.id, buyerId: row.buyer.id } },
        create: { ...data, periodId: summary.period.id, buyerId: row.buyer.id },
        update: data,
      });
    }
    await tx.period.update({ where: { key }, data: { status: 'CLOSED', closedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorId: user.id,
        actorName: user.name,
        entity: 'Period',
        entityId: summary.period.id,
        action: 'close',
        diffJson: JSON.stringify({ key, payouts: summary.buyers.length }),
      },
    });
  });

  revalidatePath('/payroll');
  return { ok: true as const };
}

export async function reopenPeriod(key: string) {
  const user = await requireAdmin();
  const period = await prisma.period.update({
    where: { key },
    data: { status: 'OPEN', closedAt: null },
  });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Period',
      entityId: period.id,
      action: 'reopen',
      diffJson: JSON.stringify({ key }),
    },
  });
  revalidatePath('/payroll');
  return { ok: true as const };
}

export async function setRate(key: string, rubPerUsd: number) {
  await requireAdmin();
  await prisma.period.update({ where: { key }, data: { rubPerUsd: Math.round(rubPerUsd * 100) } });
  revalidatePath('/payroll');
  revalidatePath('/');
  return { ok: true as const };
}
