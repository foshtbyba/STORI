import 'server-only';
import { prisma } from './db';
import { fundState } from './fund';
import { grossUp, DEFAULT_COMMISSION_BPS } from './money';

/**
 * Касса — сведение реальных денег проекта с тем, что насчитал дашборд.
 *
 * Все деньги делятся на три доли:
 *   • доля овнера 1  — его личные деньги в обороте;
 *   • доля овнера 2  — его личные;
 *   • общий капитал баеров — это Фонд ($1900 база + профит/минус баеров − выводы).
 *
 * Доля овнера = утверждённый стартовый баланс на дату-якорь + заработок его
 * кабинетов после якоря − его выводы. Заработок = профит кабинетов (доход −
 * расход с комиссией) − его собственные расходники − половина общего overhead
 * (общак делится 50/50 между овнерами).
 *
 * «Ожидается» = доли овнеров + фонд баеров. «По факту» = снимок реальных денег
 * по источникам, который админ вносит руками. Расхождение = факт − ожидается.
 */

export type OwnerShare = {
  buyerId: string;
  handle: string;
  initials: string;
  color: string;
  openingCents: number;
  anchorDate: Date | null;
  /** Профит кабинетов после якоря (доход − расход с комиссией). */
  profitCents: number;
  /** Собственные расходники овнера после якоря. */
  consumableCents: number;
  /** Половина общего overhead после якоря — доля этого овнера в общаке. */
  overheadCents: number;
  /** opening + profit − consumables − overhead. */
  earnedCents: number;
  withdrawnCents: number;
  /** Прочие движения (внешние заливы/доход/расход мимо дашборда), со знаком. */
  adjustmentCents: number;
  /** opening + earned − withdrawn + adjustments. */
  balanceCents: number;
  withdrawals: { id: string; amountCents: number; note: string; date: Date }[];
  adjustments: { id: string; amountCents: number; note: string; date: Date }[];
};

/** С даты-якоря — сколько овнер заработал сверх стартового баланса. */
async function ownerEarned(buyerId: string, anchor: Date) {
  const [days, cons, overhead] = await Promise.all([
    prisma.dayReport.aggregate({
      where: { buyerId, date: { gte: anchor } },
      _sum: { revenueCents: true, spendGrossCents: true },
    }),
    prisma.consumableEntry.aggregate({
      where: { buyerId, date: { gte: anchor } },
      _sum: { totalCents: true },
    }),
    prisma.overheadDay.aggregate({
      where: { date: { gte: anchor } },
      _sum: { spendCents: true },
    }),
  ]);
  const profitCents = (days._sum.revenueCents ?? 0) - (days._sum.spendGrossCents ?? 0);
  const consumableCents = cons._sum.totalCents ?? 0;
  // Overhead хранится в нетто (до комиссии) — приводим к реальному кэшу той же
  // накруткой, что и весь расход, и делим пополам между овнерами.
  const overheadGross = grossUp(overhead._sum.spendCents ?? 0, DEFAULT_COMMISSION_BPS);
  const overheadCents = Math.round(overheadGross / 2);
  return { profitCents, consumableCents, overheadCents };
}

export async function treasuryState() {
  const [owners, snapshot, fund, adjustments] = await Promise.all([
    prisma.buyer.findMany({
      where: { owner: true, archived: false },
      include: { ownerCapital: true, ownerWithdrawals: { orderBy: { date: 'desc' } } },
      orderBy: { handle: 'asc' },
    }),
    prisma.treasurySnapshot.findFirst({ orderBy: { date: 'desc' } }),
    fundState(),
    prisma.capitalAdjustment.findMany({ orderBy: { date: 'desc' } }),
  ]);

  const adjOf = (scope: string, buyerId: string | null) =>
    adjustments.filter((a) => a.scope === scope && (buyerId === null ? true : a.buyerId === buyerId));

  const shares: OwnerShare[] = await Promise.all(
    owners.map(async (o) => {
      const opening = o.ownerCapital?.openingCents ?? 0;
      // Нет якоря — считаем заработок с самого начала (эпоха), чтобы цифра всё
      // равно была; админ задаст точную дату и старт на экране.
      const anchor = o.ownerCapital?.anchorDate ?? new Date(0);
      const { profitCents, consumableCents, overheadCents } = await ownerEarned(o.id, anchor);
      const withdrawnCents = o.ownerWithdrawals.reduce((s, w) => s + w.amountCents, 0);
      const myAdj = adjOf('owner', o.id);
      const adjustmentCents = myAdj.reduce((s, a) => s + a.amountCents, 0);
      const earnedCents = profitCents - consumableCents - overheadCents;
      return {
        buyerId: o.id,
        handle: o.handle,
        initials: o.initials,
        color: o.color,
        openingCents: opening,
        anchorDate: o.ownerCapital?.anchorDate ?? null,
        profitCents,
        consumableCents,
        overheadCents,
        earnedCents,
        withdrawnCents,
        adjustmentCents,
        balanceCents: opening + earnedCents - withdrawnCents + adjustmentCents,
        withdrawals: o.ownerWithdrawals.map((w) => ({
          id: w.id,
          amountCents: w.amountCents,
          note: w.note,
          date: w.date,
        })),
        adjustments: myAdj.map((a) => ({ id: a.id, amountCents: a.amountCents, note: a.note, date: a.date })),
      };
    }),
  );

  const buyersAdj = adjOf('buyers', null);
  const buyersAdjustmentCents = buyersAdj.reduce((s, a) => s + a.amountCents, 0);
  const buyersAdjustments = buyersAdj.map((a) => ({ id: a.id, amountCents: a.amountCents, note: a.note, date: a.date }));

  const ownersCents = shares.reduce((s, o) => s + o.balanceCents, 0);
  const buyersCents = fund.balance + buyersAdjustmentCents;
  const expectedCents = ownersCents + buyersCents;

  const realBySource = snapshot
    ? {
        partnersCents: snapshot.partnersCents,
        brocardCents: snapshot.brocardCents,
        cardCents: snapshot.cardCents,
        agentsCents: snapshot.agentsCents,
      }
    : null;
  const realCents = realBySource
    ? realBySource.partnersCents + realBySource.brocardCents + realBySource.cardCents + realBySource.agentsCents
    : null;

  return {
    shares,
    ownersCents,
    buyersCents,
    buyersAdjustmentCents,
    buyersAdjustments,
    fund,
    expectedCents,
    snapshot,
    realBySource,
    realCents,
    /** Факт − ожидается: >0 денег больше, чем насчитано; <0 — недостача. */
    diffCents: realCents === null ? null : realCents - expectedCents,
  };
}
