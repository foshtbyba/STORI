'use server';

import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { runAutoRules, WINDOWS, type Condition, type ActionParams, type Level, type ActionKind, type StatusFilter, type Frequency } from '@/lib/autorules';

/**
 * Автоправила (конструктор FB/FBtool). v1: доступно команде (ADMIN/LEAD) — правила
 * трогают деньги на кабинетах.
 */
async function teamGate() {
  const user = await requireUser();
  return { user, ok: canSeeTeam(user.role as Role) as boolean };
}
// Правила трогают деньги на ЛЮБЫХ кабинетах (listAssignableAccounts отдаёт все),
// а прямое управление рекламой LEAD'у разрешено только по своим. Поэтому мутации
// и выбор кабинетов — только ADMIN, чтобы LEAD не мог повесить pause/бюджет на
// чужой каб в обход обычных ограничений. Просмотр правил/журнала — вся команда.
async function adminGate() {
  const user = await requireUser();
  return { user, ok: (user.role as Role) === 'ADMIN' };
}

export type RuleRow = {
  id: string; name: string; level: Level; statusFilter: StatusFilter; action: ActionKind;
  actionParams: ActionParams; frequency: Frequency; hourAt: number | null; windowKind: string;
  conditions: Condition[]; conditionsEnabled: boolean; groupName: string; enabled: boolean;
  assignments: { id: string; adAccountId: string; accountName: string }[];
};

export type AssignAccount = { id: string; name: string; externalId: string; buyer: string; agency: boolean };

const jparse = <T,>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

export async function listAutoRules(): Promise<{ ok: boolean; rules?: RuleRow[]; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rules = await prisma.autoRule.findMany({ orderBy: [{ groupName: 'asc' }, { createdAt: 'desc' }], include: { assignments: true } });
  const accIds = [...new Set(rules.flatMap((r) => r.assignments.map((a) => a.adAccountId)))];
  const accs = accIds.length ? await prisma.adAccount.findMany({ where: { id: { in: accIds } }, select: { id: true, name: true, externalId: true } }) : [];
  const nameById = new Map(accs.map((a) => [a.id, a.name || a.externalId.replace(/^act_/, '')] as const));
  return {
    ok: true,
    rules: rules.map((r) => ({
      id: r.id, name: r.name, level: r.level as Level, statusFilter: r.statusFilter as StatusFilter,
      action: r.action as ActionKind, actionParams: jparse<ActionParams>(r.actionParams, {}),
      frequency: r.frequency as Frequency, hourAt: r.hourAt, windowKind: r.windowKind,
      conditions: jparse<Condition[]>(r.conditions, []), conditionsEnabled: r.conditionsEnabled,
      groupName: r.groupName, enabled: r.enabled,
      assignments: r.assignments.map((a) => ({ id: a.id, adAccountId: a.adAccountId, accountName: nameById.get(a.adAccountId) || a.adAccountId })),
    })),
  };
}

export async function listAssignableAccounts(): Promise<{ ok: boolean; accounts?: AssignAccount[]; error?: string }> {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rows = await prisma.adAccount.findMany({
    where: { enabled: true, adToken: { enabled: true } },
    select: { id: true, name: true, externalId: true, agency: true, adToken: { select: { buyer: { select: { handle: true } } } } },
    orderBy: [{ name: 'asc' }],
  });
  return { ok: true, accounts: rows.map((r) => ({ id: r.id, name: r.name || r.externalId.replace(/^act_/, ''), externalId: r.externalId, buyer: r.adToken.buyer?.handle || '', agency: r.agency })) };
}

export type RuleInput = {
  id?: string; name: string; level: string; statusFilter: string; action: string;
  actionParams: ActionParams; frequency: string; hourAt: number | null; windowKind: string;
  conditions: Condition[]; conditionsEnabled: boolean; groupName: string;
};

export async function saveAutoRule(input: RuleInput): Promise<{ ok: boolean; id?: string; error?: string }> {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const name = input.name.trim();
  if (!name) return { ok: false, error: 'Впиши название правила' };
  const level = (['campaign', 'adset', 'ad'].includes(input.level) ? input.level : 'adset');
  const statusFilter = (['active', 'paused', 'any'].includes(input.statusFilter) ? input.statusFilter : 'active');
  const action = (['pause', 'start', 'budget_daily'].includes(input.action) ? input.action : 'pause');
  const frequency = (['halfhour', 'hour', 'midnight', 'hour_at'].includes(input.frequency) ? input.frequency : 'halfhour');
  const windowKind = (WINDOWS.some((w) => w.key === input.windowKind) ? input.windowKind : 'today');
  const hourAt = frequency === 'hour_at' ? Math.min(23, Math.max(0, Math.round(input.hourAt ?? 0))) : null;
  const conditions = (Array.isArray(input.conditions) ? input.conditions : []).filter((c) => c && c.metric && ['>', '<', '='].includes(c.op)).map((c) => ({ metric: String(c.metric), op: c.op, value: Number(c.value) || 0 }));
  const conditionsEnabled = !!input.conditionsEnabled && conditions.length > 0;
  const data = {
    name, level, statusFilter, action, actionParams: JSON.stringify(input.actionParams ?? {}),
    frequency, hourAt, windowKind, conditions: JSON.stringify(conditions), conditionsEnabled, groupName: (input.groupName || '').trim(),
  };
  if (input.id) { await prisma.autoRule.update({ where: { id: input.id }, data }); return { ok: true, id: input.id }; }
  const created = await prisma.autoRule.create({ data: { ...data, buyerId: g.user.buyer?.id ?? '', scope: 'owner' } });
  return { ok: true, id: created.id };
}

export async function toggleAutoRule(id: string, enabled: boolean) {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  await prisma.autoRule.update({ where: { id }, data: { enabled } });
  return { ok: true };
}

export async function deleteAutoRule(id: string) {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  await prisma.autoRule.delete({ where: { id } });
  return { ok: true };
}

export async function setRuleAccounts(ruleId: string, accountIds: string[]) {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const want = new Set(accountIds);
  const existing = await prisma.autoRuleAssignment.findMany({ where: { ruleId, scopeFbId: '' }, select: { id: true, adAccountId: true } });
  const have = new Set(existing.map((e) => e.adAccountId));
  const toRemove = existing.filter((e) => !want.has(e.adAccountId)).map((e) => e.id);
  if (toRemove.length) await prisma.autoRuleAssignment.deleteMany({ where: { id: { in: toRemove } } });
  for (const adAccountId of [...want].filter((a) => !have.has(a))) {
    await prisma.autoRuleAssignment.create({ data: { ruleId, adAccountId, scopeFbId: '' } });
  }
  return { ok: true };
}

export type LogRow = { id: string; ruleName: string; accountName: string; targetType: string; targetName: string; action: string; reason: string; createdAt: string };

export async function loadAutoRuleLog(limit = 80): Promise<{ ok: boolean; rows?: LogRow[]; error?: string }> {
  const g = await teamGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const rows = await prisma.autoRuleLog.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(200, limit) });
  return { ok: true, rows: rows.map((r) => ({ id: r.id, ruleName: r.ruleName, accountName: r.accountName, targetType: r.targetType, targetName: r.targetName, action: r.action, reason: r.reason, createdAt: r.createdAt.toISOString() })) };
}

/** Прогнать сейчас — force (игнорируя частоту), для проверки из UI. */
export async function runAutoRulesNow() {
  const g = await adminGate();
  if (!g.ok) return { ok: false, error: 'Только для команды' };
  const r = await runAutoRules(true);
  return { ok: true, rules: r.rules, ran: r.ran, actions: r.actions, errors: r.errors };
}
