'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export type ActionResult = { ok: true } | { ok: false; error: string };

const Tier = z.object({
  /** Порог в центах ($ × 100). */
  fromCents: z.number().int().min(0).max(100_000_000),
  ratePct: z.number().int().min(0).max(100),
});

const Input = z.object({
  id: z.string().min(1),
  /** Оклад за неделю в рублях. */
  fixedRub: z.number().int().min(0).max(1_000_000),
  tiers: z.array(Tier).min(1).max(12),
});

/**
 * Редактор зарплатной лесенки: оклад и ступени порогов. Лесенка общая — её
 * правит только админ, и меняется она разом для всех, кто на неё завязан.
 */
export async function saveSalaryRule(input: unknown): Promise<ActionResult> {
  await requireAdmin();
  const parsed = Input.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверь цифры лесенки.' };
  const { id, fixedRub, tiers } = parsed.data;

  const rule = await prisma.salaryRule.findUnique({ where: { id } });
  if (!rule) return { ok: false, error: 'Такой лесенки нет.' };

  // Пороги держим по возрастанию — так их читает и расчёт, и экран.
  const sorted = [...tiers].sort((a, b) => a.fromCents - b.fromCents);

  await prisma.salaryRule.update({
    where: { id },
    data: { fixedRub, tiersJson: JSON.stringify(sorted) },
  });

  // Лесенка влияет на все зарплатные экраны разом.
  revalidatePath('/admin');
  revalidatePath('/payroll');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true };
}

const BuyerInput = z.object({
  fixedRub: z.number().int().min(0).max(1_000_000),
  tiers: z.array(Tier).min(1).max(12),
});

/**
 * Лесенка под конкретного баера. Если он сидит на общей лесенке (её делят
 * другие), правка не должна задеть остальных — поэтому в этом случае форкаем:
 * заводим баеру свою лесенку и правим уже её. Если лесенка и так только его —
 * правим на месте.
 */
export async function saveBuyerLadder(buyerId: string, input: unknown): Promise<ActionResult> {
  await requireAdmin();
  if (!buyerId) return { ok: false, error: 'Не указан баер.' };
  const parsed = BuyerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Проверь цифры лесенки.' };
  const { fixedRub, tiers } = parsed.data;

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return { ok: false, error: 'Такого баера нет.' };

  const sorted = [...tiers].sort((a, b) => a.fromCents - b.fromCents);
  const tiersJson = JSON.stringify(sorted);

  // Своя ли это лесенка: на ней сидит только он один?
  const shared = buyer.salaryRuleId
    ? (await prisma.buyer.count({ where: { salaryRuleId: buyer.salaryRuleId } })) > 1
    : true;

  if (buyer.salaryRuleId && !shared) {
    await prisma.salaryRule.update({ where: { id: buyer.salaryRuleId }, data: { fixedRub, tiersJson } });
  } else {
    const rule = await prisma.salaryRule.create({
      data: { name: `${buyer.handle} · своя`, tiersJson, fixedRub },
    });
    await prisma.buyer.update({ where: { id: buyerId }, data: { salaryRuleId: rule.id } });
  }

  revalidatePath('/admin');
  revalidatePath('/payroll');
  revalidatePath('/dashboard');
  revalidatePath('/peak');
  return { ok: true };
}
