import { sum } from './money';

export type Tier = { fromCents: number; ratePct: number };

/**
 * The ladder is not marginal: the rate of the highest threshold reached is
 * applied to the whole base. That is what makes the thresholds worth chasing —
 * and what makes the gap below one expensive. Both facts are surfaced in the UI.
 */
export const DEFAULT_TIERS: Tier[] = [
  { fromCents: 80_000, ratePct: 30 },
  { fromCents: 160_000, ratePct: 30 },
  { fromCents: 240_000, ratePct: 30 },
  { fromCents: 500_000, ratePct: 40 },
  { fromCents: 1_000_000, ratePct: 50 },
];

export function parseTiers(json: string | null | undefined): Tier[] {
  if (!json) return DEFAULT_TIERS;
  try {
    const parsed = JSON.parse(json) as Tier[];
    if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_TIERS;
    return [...parsed].sort((a, b) => a.fromCents - b.fromCents);
  } catch {
    return DEFAULT_TIERS;
  }
}

/** Оклад за период по умолчанию, в рублях. */
export const DEFAULT_FIXED_RUB = 10_000;

/**
 * Оклад задан в рублях, а вся арифметика идёт в долларовых центах. Курс
 * хранится в сотых (8400 = 84,00 ₽/$), отсюда множитель.
 */
export function okladCents(fixedRub: number, rubPerUsd: number) {
  if (!rubPerUsd) return 0;
  return Math.round((fixedRub * 10_000) / rubPerUsd);
}

export function rateFor(baseCents: number, tiers: Tier[]): number {
  let rate = 0;
  for (const tier of tiers) if (baseCents >= tier.fromCents) rate = tier.ratePct;
  return rate;
}

/** The next threshold a buyer has not reached yet, and what reaching it pays. */
export function nextTier(baseCents: number, tiers: Tier[]) {
  const upcoming = tiers.find((t) => t.fromCents > baseCents);
  if (!upcoming) return null;
  const current = rateFor(baseCents, tiers);
  const salaryNow = Math.round((baseCents * current) / 100);
  const salaryThen = Math.round((upcoming.fromCents * upcoming.ratePct) / 100);
  return {
    fromCents: upcoming.fromCents,
    ratePct: upcoming.ratePct,
    needCents: upcoming.fromCents - baseCents,
    gainCents: salaryThen - salaryNow,
  };
}

export type PayoutInput = {
  profitCents: number;
  consumableCents: number;
  consumablesAffectSalary: boolean;
  tiers: Tier[];
  fixedRub?: number;
  /** Курс в сотых: нужен, чтобы перевести рублёвый оклад в доллары. */
  rubPerUsd: number;
  bonusCents?: number;
};

/**
 * Оклад — нижняя граница, а не добавка. Не взял минимальный порог или ушёл в
 * минус — получаешь оклад и ничего сверх него. Взял порог — процент считается
 * со всей суммы и оклад в нём растворяется.
 */
export function computePayout(input: PayoutInput) {
  const baseCents = input.consumablesAffectSalary
    ? input.profitCents - input.consumableCents
    : input.profitCents;
  const ratePct = baseCents > 0 ? rateFor(baseCents, input.tiers) : 0;
  const tierCents = Math.max(0, Math.round((baseCents * ratePct) / 100));
  const fixedCents = okladCents(input.fixedRub ?? DEFAULT_FIXED_RUB, input.rubPerUsd);
  const onOklad = tierCents <= fixedCents;
  const salaryCents = onOklad ? fixedCents : tierCents;
  const bonusCents = input.bonusCents ?? 0;
  return {
    baseCents,
    ratePct,
    tierCents,
    fixedCents,
    /** Выплату вытянул оклад, а не процент. */
    onOklad,
    salaryCents,
    bonusCents,
    totalCents: salaryCents + bonusCents,
    next: nextTier(baseCents, input.tiers),
  };
}

export function payrollTotals(rows: { salaryCents: number; bonusCents: number; baseCents: number }[]) {
  const salary = sum(rows, (r) => r.salaryCents);
  const bonus = sum(rows, (r) => r.bonusCents);
  const base = sum(rows, (r) => r.baseCents);
  return { salary, bonus, base, total: salary + bonus, avgRate: base ? (salary / base) * 100 : 0 };
}
