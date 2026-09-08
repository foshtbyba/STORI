import 'server-only';
import { prisma } from './db';
import { teamSummary } from './queries';
import { weekKey } from './period';

/**
 * Фонд баеров — касса чистого заработка команды (только для админа).
 *
 * Баланс = стартовая база (общий бюджет на открут) + чистый профит команды за
 * ВСЁ время − выводы. Чистый = профит − зарплата − расходники, только по баерам
 * (овнеры исключены). Считаем по всем неделям с данными, включая текущую
 * незакрытую. База закреплена, но текстом на экране не подписывается — просто
 * входит в баланс. Выводы вносит админ вручную.
 *
 * Быстродействие: закрытые недели фиксируются в FundEntry при закрытии зарплаты
 * (см. actions/period.ts) и досчитываются бэкфиллом один раз; открытые недели
 * пересчитываются вживую (их немного — текущая и ещё не закрытые).
 */

/** Стартовая база фонда в центах — 1900$. */
export const FUND_BASE_CENTS = 190_000;

/** Досчитать в фонд уже закрытые недели, которых ещё нет (разово, кэш). */
async function backfillClosedPeriods() {
  const [closed, existing] = await Promise.all([
    prisma.period.findMany({ where: { status: 'CLOSED' }, select: { id: true, key: true } }),
    prisma.fundEntry.findMany({ where: { kind: 'accrual' }, select: { periodId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.periodId));
  for (const p of closed.filter((p) => !have.has(p.id))) {
    try {
      const s = await teamSummary(p.key);
      await prisma.fundEntry.upsert({
        where: { kind_periodId: { kind: 'accrual', periodId: p.id } },
        create: { kind: 'accrual', periodId: p.id, periodKey: p.key, amountCents: s.totals.teamNetCents },
        update: { amountCents: s.totals.teamNetCents, periodKey: p.key },
      });
    } catch { /* пропускаем сбойную неделю */ }
  }
}

export async function fundState() {
  await backfillClosedPeriods();

  const [entries, dayDates, closedPeriods] = await Promise.all([
    prisma.fundEntry.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.dayReport.groupBy({ by: ['date'] }),
    prisma.period.findMany({ where: { status: 'CLOSED' }, select: { key: true } }),
  ]);

  const withdrawals = entries.filter((e) => e.kind === 'withdrawal');
  const closedByKey = new Map(entries.filter((e) => e.kind === 'accrual').map((a) => [a.periodKey, a.amountCents]));
  const closedKeys = new Set(closedPeriods.map((p) => p.key));

  // Все недели, где вообще есть дни. Закрытые берём из кэша, открытые — вживую.
  const allWeeks = new Set<string>();
  for (const d of dayDates) allWeeks.add(weekKey(d.date));

  const weeks: { key: string; cents: number; open: boolean }[] = [];
  for (const wk of allWeeks) {
    if (closedKeys.has(wk)) {
      weeks.push({ key: wk, cents: closedByKey.get(wk) ?? 0, open: false });
    } else {
      const s = await teamSummary(wk);
      weeks.push({ key: wk, cents: s.totals.teamNetCents, open: true });
    }
  }
  weeks.sort((a, b) => (a.key < b.key ? 1 : -1));

  const accrued = weeks.reduce((s, w) => s + w.cents, 0);
  const withdrawn = withdrawals.reduce((s, w) => s + w.amountCents, 0);
  return {
    base: FUND_BASE_CENTS,
    accrued,
    withdrawn,
    balance: FUND_BASE_CENTS + accrued - withdrawn,
    weeks,
    withdrawals,
  };
}
