/**
 * Money is stored as integer USD cents everywhere. Nothing in the app holds a
 * float amount, so totals never drift.
 *
 * Display rounding is separate and deliberately lossy: the team writes round
 * numbers, so the UI shows round numbers. Totals are always rounded from the
 * exact sum rather than from already-rounded parts, which means a column of
 * rounded rows can differ from its rounded total by a few dollars. That is the
 * honest trade — the alternative is a total that does not match the ledger.
 */

/** Round for display: tens under $1k, hundreds under $100k, thousands above. */
export function roundForDisplay(cents: number): number {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const step = abs < 1000 ? 10 : abs < 100_000 ? 100 : 1000;
  return Math.round(dollars / step) * step;
}

export function usd(cents: number, opts: { sign?: boolean; exact?: boolean } = {}) {
  const value = opts.exact ? cents / 100 : roundForDisplay(cents);
  const body = '$' + Math.abs(value).toLocaleString('ru-RU');
  if (opts.sign && value > 0) return '+' + body;
  return value < 0 ? '−' + body : body;
}

export function rub(cents: number, rubPerUsd: number) {
  // rubPerUsd is stored in hundredths so 8000 means 80.00 ₽/$
  const value = Math.round((cents * rubPerUsd) / 100 / 100);
  const step = Math.abs(value) < 100_000 ? 100 : 1000;
  return (Math.round(value / step) * step).toLocaleString('ru-RU') + ' ₽';
}

export function pct(part: number, whole: number, digits = 1) {
  if (!whole) return '—';
  return ((part / whole) * 100).toFixed(digits).replace('.', ',') + '%';
}

/** Gross a net ad spend up by the commission charged on the top-up. */
export function grossUp(spendNetCents: number, commissionBps: number) {
  return Math.round(spendNetCents * (1 + commissionBps / 10_000));
}

export function profitOf(d: { revenueCents: number; spendGrossCents: number }) {
  return d.revenueCents - d.spendGrossCents;
}

export function sum<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}
