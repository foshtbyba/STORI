'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Справочник агентов заводит/правит команда (как и отчёты дня). */
async function assertTeam(): Promise<string | null> {
  const user = await requireUser();
  return canSeeTeam(user.role as Role) ? null : 'Агентов правит админ.';
}

const AgentInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Впиши имя агента').max(60),
  // Процент как есть (6 или 6,5) — переводим в базисные пункты.
  pct: z.number().min(0).max(100),
});

const bpsFromPct = (pct: number) => Math.round(pct * 100);

/** Создать или переименовать/переставить процент агента. */
export async function saveAgent(input: unknown): Promise<ActionResult> {
  const denied = await assertTeam();
  if (denied) return { ok: false, error: denied };

  const parsed = AgentInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поля.' };
  }
  const { id, name, pct } = parsed.data;
  const commissionBps = bpsFromPct(pct);

  // Имя уникально: не плодим двух «Иванов» с разными ставками по ошибке.
  const clash = await prisma.agent.findFirst({
    where: { name, ...(id ? { NOT: { id } } : {}) },
    select: { id: true },
  });
  if (clash) return { ok: false, error: 'Агент с таким именем уже есть.' };

  if (id) {
    await prisma.agent.update({ where: { id }, data: { name, commissionBps } });
  } else {
    const count = await prisma.agent.count();
    await prisma.agent.create({ data: { name, commissionBps, sort: count } });
  }
  revalidatePath('/days/new');
  return { ok: true };
}

/** Скрыть агента из выбора (прошлые строки с ним остаются как есть). */
export async function archiveAgent(id: string, archived: boolean): Promise<ActionResult> {
  const denied = await assertTeam();
  if (denied) return { ok: false, error: denied };
  if (!id) return { ok: false, error: 'Нет агента.' };
  await prisma.agent.update({ where: { id }, data: { archived } });
  revalidatePath('/days/new');
  return { ok: true };
}
