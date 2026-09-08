import 'server-only';
import { prisma } from './db';
import { teamSummary } from './queries';
import { weekKey } from './period';

/**
 * Фонд баеров — касса чистого заработка команды (только для админа).
 *
 * Баланс = стартовая база (общий бюджет на открут) + чистый команды за ВСЁ
 * время − выводы. Чистый недели = профит − расходники − выплаты баерам, только
 * по баерам, не овнерам. Минус недели переносится хвостом и перекрывается
 * плюсом следующих — это учитывает сама зарплата (см. computePayout), а тут
 * просто суммируем профит − расходники − выплаты по всем неделям.
 *
 * База в баланс входит, но текстом на экране не подписывается. Выводы вносит
 * админ вручную. Все недели считаем вживую, чтобы формула всегда была свежей.
 */

/** Стартовая база фонда в центах — 1900$. */
export const FUND_BASE_CENTS = 190_000;

export async function fundState() {
  const [withdrawals, dayDates, closedPeriods] = await Promise.all([
    prisma.fundEntry.findMany({ where: { kind: 'withdrawal' }, orderBy: { createdAt: 'desc' } }),
    prisma.dayReport.groupBy({ by: ['date'] }),
    prisma.period.findMany({ where: { status: 'CLOSED' }, select: { key: true } }),
  ]);
  const closedKeys = new Set(closedPeriods.map((p) => p.key));

  const allWeeks = new Set<string>();
  for (const d of dayDates) allWeeks.add(weekKey(d.date));

  const raw: { key: string; cents: number; open: boolean }[] = [];
  for (const wk of allWeeks) {
    const s = await teamSummary(wk);
    raw.push({ key: wk, cents: s.totals.teamNetCents, open: !closedKeys.has(wk) });
  }
  // Накопительный итог считаем по возрастанию (старые → новые): именно он
  // честно показывает, где плюс недели просто закрыл прошлый минус, а где пошёл
  // реальный заработок. Минусовая неделя тянет итог вниз и не прячется.
  raw.sort((a, b) => (a.key < b.key ? -1 : 1));
  let running = 0;
  const asc = raw.map((w) => {
    running += w.cents;
    return { ...w, cumCents: running };
  });
  // Показываем новыми сверху.
  const weeks = [...asc].sort((a, b) => (a.key < b.key ? 1 : -1));

  const accrued = running;
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
