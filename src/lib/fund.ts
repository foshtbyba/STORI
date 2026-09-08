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

/** Стартовая база фонда в центах по умолчанию — 1900$. Реальное значение
 *  редактируется на экране «Касса» и хранится в Setting (fund_base_cents). */
export const FUND_BASE_CENTS = 190_000;
const FUND_BASE_KEY = 'fund_base_cents';

/** Текущая стартовая база фонда: из настроек, иначе дефолт 1900$. */
export async function fundBaseCents() {
  const row = await prisma.setting.findUnique({ where: { key: FUND_BASE_KEY } });
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : FUND_BASE_CENTS;
}

export async function fundState() {
  const [withdrawals, dayDates, closedPeriods, baseCents] = await Promise.all([
    prisma.fundEntry.findMany({ where: { kind: 'withdrawal' }, orderBy: { createdAt: 'desc' } }),
    prisma.dayReport.groupBy({ by: ['date'] }),
    prisma.period.findMany({ where: { status: 'CLOSED' }, select: { key: true } }),
    fundBaseCents(),
  ]);
  const closedKeys = new Set(closedPeriods.map((p) => p.key));

  const allWeeks = new Set<string>();
  for (const d of dayDates) allWeeks.add(weekKey(d.date));

  const raw: { key: string; cents: number; open: boolean }[] = [];
  // Разложение накопленного на составляющие — чтобы на экране было видно,
  // сколько баеры принесли профитом до вычета зарплаты и расходников.
  let profitCents = 0;
  let consumableCents = 0;
  let payoutCents = 0;
  for (const wk of allWeeks) {
    const s = await teamSummary(wk);
    profitCents += s.totals.profitCents;
    consumableCents += s.totals.consumableCents;
    payoutCents += s.totals.payoutCents;
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
    base: baseCents,
    accrued,
    /** Профит баеров за всё время (доход − расход), до вычета зп и расходников. */
    profitCents,
    consumableCents,
    payoutCents,
    withdrawn,
    balance: baseCents + accrued - withdrawn,
    weeks,
    withdrawals,
  };
}
