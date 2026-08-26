/**
 * Money is stored as integer USD cents everywhere. Nothing in the app holds a
 * float amount, so totals never drift.
 *
 * Отчётные экраны показывают суммы как есть, без округления: цифра в таблице
 * обязана сходиться с цифрой в расчёте зарплаты до цента. Округление живёт
 * ровно в одном месте — на «Вершине», где важен порядок, а не точность.
 */

/**
 * Шкала округления для горы: чем крупнее сумма, тем крупнее шаг. До $1k — по
 * сотне, дальше 500 / 1k / 5k / 10k / 50k / 100k.
 */
export function roundForPeak(cents: number): number {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const step =
    abs < 1_000 ? 100
    : abs < 5_000 ? 500
    : abs < 10_000 ? 1_000
    : abs < 50_000 ? 5_000
    : abs < 100_000 ? 10_000
    : abs < 500_000 ? 50_000
    : 100_000;
  return Math.round(dollars / step) * step;
}

function money(value: number, symbol: string, sign?: boolean) {
  const body =
    symbol === '$'
      ? '$' + fmt(Math.abs(value))
      : fmt(Math.abs(value)) + ' ' + symbol;
  if (sign && value > 0) return '+' + body;
  return value < 0 ? '−' + body : body;
}

/** Целые суммы печатаем без хвоста, дробные — с двумя знаками. */
function fmt(value: number) {
  return Number.isInteger(value)
    ? value.toLocaleString('ru-RU')
    : value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function usd(cents: number, opts: { sign?: boolean; round?: boolean } = {}) {
  const value = opts.round ? roundForPeak(cents) : cents / 100;
  return money(value, '$', opts.sign);
}

export function rub(cents: number, rubPerUsd: number, opts: { round?: boolean } = {}) {
  // rubPerUsd is stored in hundredths so 8000 means 80.00 ₽/$
  const value = Math.round((cents * rubPerUsd) / 100 / 100);
  if (!opts.round) return money(value, '₽');
  const step = Math.abs(value) < 100_000 ? 100 : 1000;
  return money(Math.round(value / step) * step, '₽');
}

export function pct(part: number, whole: number, digits = 1) {
  if (!whole) return '—';
  return ((part / whole) * 100).toFixed(digits).replace('.', ',') + '%';
}

/**
 * Комиссия за пополнение по умолчанию — 4,50%. Платёжка может быть своя, но
 * в формах предзаполняем эту: команда работает с ней.
 */
export const DEFAULT_COMMISSION_BPS = 450;

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
