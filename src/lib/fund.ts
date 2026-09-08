import 'server-only';
import { prisma } from './db';
import { teamSummary } from './queries';

/**
 * Фонд баеров — касса чистого заработка команды (только для админа).
 *
 * Баланс = стартовая база (общий бюджет на открут, который дали команде) +
 * накопленный чистый профит по ЗАКРЫТЫМ неделям − выводы. База закреплена и не
 * пересчитывается; недельный чистый фиксируется при закрытии недели (см.
 * actions/period.ts), выводы вносит админ вручную.
 */

/** Стартовая база фонда в центах — 1900$. */
export const FUND_BASE_CENTS = 190_000;

/**
 * Досчитываем в фонд все УЖЕ закрытые недели, которых там ещё нет. Нужно, чтобы
 * фонд сразу отражал весь заработанный за всё время чистый, а не только недели,
 * закрытые после появления фонда. Делается один раз на неделю: как только у
 * периода есть запись accrual, teamSummary для неё больше не гоняется.
 */
async function backfillClosedPeriods() {
  const [closed, existing] = await Promise.all([
    prisma.period.findMany({ where: { status: 'CLOSED' }, select: { id: true, key: true } }),
    prisma.fundEntry.findMany({ where: { kind: 'accrual' }, select: { periodId: true } }),
  ]);
  const have = new Set(existing.map((e) => e.periodId));
  const missing = closed.filter((p) => !have.has(p.id));
  for (const p of missing) {
    try {
      const s = await teamSummary(p.key);
      await prisma.fundEntry.upsert({
        where: { kind_periodId: { kind: 'accrual', periodId: p.id } },
        create: { kind: 'accrual', periodId: p.id, periodKey: p.key, amountCents: s.totals.teamNetCents },
        update: { amountCents: s.totals.teamNetCents, periodKey: p.key },
      });
    } catch {
      /* один период не досчитался — не роняем весь фонд */
    }
  }
}

export async function fundState() {
  await backfillClosedPeriods();
  const entries = await prisma.fundEntry.findMany({ orderBy: { createdAt: 'desc' } });
  let accrued = 0;
  let withdrawn = 0;
  for (const e of entries) {
    if (e.kind === 'withdrawal') withdrawn += e.amountCents;
    else accrued += e.amountCents;
  }
  const accruals = entries.filter((e) => e.kind === 'accrual');
  const withdrawals = entries.filter((e) => e.kind === 'withdrawal');
  return {
    base: FUND_BASE_CENTS,
    accrued,
    withdrawn,
    balance: FUND_BASE_CENTS + accrued - withdrawn,
    accruals,
    withdrawals,
  };
}
