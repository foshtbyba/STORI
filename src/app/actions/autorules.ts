'use server';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { runAutoRules, AUTO_RULE_TYPES } from '@/lib/autorules';
import type { AutoRuleParams } from '@/lib/autorules';

/**
 * Автоправила — управление шаблонами и назначениями. v1: доступно команде
 * (ADMIN/LEAD), т.к. правила трогают деньги на кабинетах. Баеров подключим позже.
 */

async function teamGate() {
  const user = await requireUser();
  if (!canSeeTeam(user.role as Role)) return { user, ok: false as const };
  return { user, ok: true as const };
}

export type RuleRow = {
  id: string;
  name: string;
  type: string;
  level: string;
  windowDays: number;
  params: AutoRuleParams;
  enabled: boolean;
  assignments: { id: string; adAccountId: string; scopeFbId: string; accountName: string }[];
};

export type AssignAccount = { id: string; name: string; externalId: string; buyer: string; agency: boolean };

/** Список правил со всеми назначениями (для UI). */
export async function listAutoRules(): Promise<{ ok: boolean; rules?: RuleRow[]; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rules = await prisma.autoRule.findMany({
    orderBy: { createdAt: 'desc' },
    include: { assignments: true },
  });
  const accIds = [...new Set(rules.flatMap((r) => r.assignments.map((a) => a.adAccountId)))];
  const accs = accIds.length
    ? await prisma.adAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true, externalId: true } })
    : [];
  const nameById = new Map(accs.map((a) => [a.id, a.name || a.externalId.replace(/^act_/, '')] as const));
  return {
    ok: true,
    rules: rules.map((r) => {
      let params: AutoRuleParams = {};
      try { params = JSON.parse(r.params || '{}'); } catch { params = {}; }
      return {
        id: r.id, name: r.name, type: r.type, level: r.level, windowDays: r.windowDays,
        params, enabled: r.enabled,
        assignments: r.assignments.map((a) => ({
          id: a.id, adAccountId: a.adAccountId, scopeFbId: a.scopeFbId,
          accountName: nameById.get(a.adAccountId) || a.adAccountId,
        })),
      };
    }),
  };
}

/** Кабинеты, на которые можно вешать правила (для пикера назначения). */
export async function listAssignableAccounts(): Promise<{ ok: boolean; accounts?: AssignAccount[]; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rows = await prisma.adAccount.findMany({
    where: { enabled: true, adToken: { enabled: true } },
    select: { id: true, name: true, externalId: true, agency: true, adToken: { select: { buyer: { select: { handle: true } } } } },
    orderBy: [{ name: 'asc' }],
  });
  return {
    ok: true,
    accounts: rows.map((r) => ({
      id: r.id, name: r.name || r.externalId.replace(/^act_/, ''), externalId: r.externalId,
      buyer: r.adToken.buyer?.handle || '', agency: r.agency,
    })),
  };
}

/** Создать/обновить правило. id пуст — создаём. */
export async function saveAutoRule(input: {
  id?: string; name: string; type: string; level: string; windowDays: number; params: AutoRuleParams;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Впиши название правила' };
  if (!AUTO_RULE_TYPES.some((t) => t.type === input.type)) return { ok: false, error: 'Неизвестный тип правила' };
  const level = ['campaign', 'adset', 'ad'].includes(input.level) ? input.level : 'ad';
  const windowDays = Math.min(31, Math.max(1, Math.round(input.windowDays || 1)));
  const params = JSON.stringify(input.params ?? {});
  if (input.id) {
    await prisma.autoRule.update({ where: { id: input.id }, data: { name, type: input.type, level, windowDays, params } });
    return { ok: true, id: input.id };
  }
  const created = await prisma.autoRule.create({
    data: { name, type: input.type, level, windowDays, params, buyerId: g.user.buyer?.id ?? '', scope: 'owner' },
  });
  return { ok: true, id: created.id };
}

export async function toggleAutoRule(id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  await prisma.autoRule.update({ where: { id }, data: { enabled } });
  return { ok: true };
}

export async function deleteAutoRule(id: string): Promise<{ ok: boolean; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  await prisma.autoRule.delete({ where: { id } });
  return { ok: true };
}

/** Полностью задать список кабинетов правила (весь каб; сужение по цели — позже). */
export async function setRuleAccounts(ruleId: string, accountIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const want = new Set(accountIds);
  const existing = await prisma.autoRuleAssignment.findMany({ where: { ruleId, scopeFbId: '' }, select: { id: true, adAccountId: true } });
  const have = new Set(existing.map((e) => e.adAccountId));
  const toAdd = [...want].filter((a) => !have.has(a));
  const toRemove = existing.filter((e) => !want.has(e.adAccountId)).map((e) => e.id);
  if (toRemove.length) await prisma.autoRuleAssignment.deleteMany({ where: { id: { in: toRemove } } });
  for (const adAccountId of toAdd) {
    await prisma.autoRuleAssignment.create({ data: { ruleId, adAccountId, scopeFbId: '' } });
  }
  return { ok: true };
}

export type LogRow = {
  id: string; ruleName: string; accountName: string; targetType: string; targetName: string;
  action: string; reason: string; createdAt: string;
};

export async function loadAutoRuleLog(limit = 60): Promise<{ ok: boolean; rows?: LogRow[]; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rows = await prisma.autoRuleLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(200, limit) });
  return {
    ok: true,
    rows: rows.map((r) => ({
      id: r.id, ruleName: r.ruleName, accountName: r.accountName, targetType: r.targetType,
      targetName: r.targetName, action: r.action, reason: r.reason, createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** Прогнать правила прямо сейчас (для проверки из UI). */
export async function runAutoRulesNow(): Promise<{ ok: boolean; actions?: number; rules?: number; errors?: number; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const r = await runAutoRules();
  return { ok: true, actions: r.actions, rules: r.rules, errors: r.errors };
}
