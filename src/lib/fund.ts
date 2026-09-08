import 'server-only';
import { prisma } from './db';

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

export async function fundState() {
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
