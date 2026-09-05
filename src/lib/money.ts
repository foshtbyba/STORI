/**
 * Money is stored as integer USD cents everywhere. Nothing in the app holds a
 * float amount, so totals never drift.
 *
 * Показываем целые доллары: центы в отчётности не считаем. Хранение при этом
 * остаётся в центах — арифметика идёт по целым и никуда не уплывает, округляем
 * только на выводе. Крупное округление живёт ровно в одном месте — на
 * «Вершине», где важен порядок, а не сумма.
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

/**
 * Следующая веха для горы — круглая сумма строго выше достигнутой.
 *
 * По ней растёт вершина: она идёт за лидером и всегда стоит чуть выше него,
 * так что подниматься есть куда в любой день недели, а склон не превращается
 * ни в лесенку с плоскими участками, ни в потолок.
 *
 * Шаг подобран так, чтобы лидер оказывался примерно на 65–90% высоты. Мелкий
 * шаг на малых суммах здесь важнее красоты круглого числа: с шагом в $250
 * лидер с $50 стоял бы у самой подошвы, и гора выглядела бы мёртвой как раз
 * тогда, когда за ней интереснее всего следить — в начале недели.
 *
 * «Строго выше» — обязательно: веха вровень с достигнутым снова упирала бы
 * гору в потолок.
 */
export function nextPeakMilestone(cents: number): number {
  const dollars = Math.max(0, cents / 100);
  const step =
    dollars < 100 ? 25
    : dollars < 250 ? 50
    : dollars < 1_000 ? 100
    : dollars < 5_000 ? 500
    : dollars < 10_000 ? 1_000
    : dollars < 50_000 ? 5_000
    : dollars < 100_000 ? 10_000
    : 50_000;
  return (Math.floor(dollars / step) + 1) * step * 100;
}

function money(value: number, symbol: string, sign?: boolean) {
  const body =
    symbol === '$'
      ? '$' + fmt(Math.abs(value))
      : fmt(Math.abs(value)) + ' ' + symbol;
  if (sign && value > 0) return '+' + body;
  return value < 0 ? '−' + body : body;
}

function fmt(value: number) {
  return value.toLocaleString('ru-RU');
}

export function usd(cents: number, opts: { sign?: boolean; round?: boolean } = {}) {
  const value = opts.round ? roundForPeak(cents) : Math.round(cents / 100);
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

/**
 * Округление до целого доллара — на уровне самих денег, а не показа.
 *
 * Иначе выходит расхождение: две строки по $121,43 показываются как $121 и
 * $121, а их сумма — как $243. Никто не ошибся, просто складывали центы, а
 * показывали доллары. Раз центы мы не считаем, их не должно быть и в
 * производных суммах: комиссия, оклад, процент и бонус ложатся на целый
 * доллар сразу, и тогда столбик всегда сходится.
 */
export function wholeDollars(cents: number) {
  return Math.round(cents / 100) * 100;
}

/**
 * Округление вверх до целого доллара. Расход и доход из синка нормализуем
 * именно так — чтобы никогда не занизить: $194.34 → $195. Копейки внутри
 * дашборда всё равно не показываются, а «вверх» команда выбрала осознанно.
 */
export function ceilDollars(cents: number) {
  return Math.ceil(cents / 100) * 100;
}

/**
 * От потраченного на рекламу — к тому, что ушло с кошелька.
 *
 * Комиссия платёжки сидит ВНУТРИ перевода, а не приплюсовывается сверху.
 * Овнер отправляет $3 000, платёжка забирает свои 4,5% из этой же суммы, и на
 * кабинет ложится $2 865. Значит обратно идём делением на оставшуюся долю, а
 * не умножением на надбавку: $2 865 / 0,955 = $3 000, комиссия ровно $135 —
 * те самые 4,5% от перевода.
 *
 * Умножение давало $2 993: процент считался от куска, а не от целого, и с
 * каждого закида терялось по несколько долларов. Ошибка маленькая, но
 * системная — и всегда в одну сторону.
 */
export function grossUp(spendNetCents: number, commissionBps: number) {
  const rest = 1 - commissionBps / 10_000;
  // Ставка в 100% и выше смысла не имеет: возвращаем расход как есть.
  if (rest <= 0) return wholeDollars(spendNetCents);
  return wholeDollars(spendNetCents / rest);
}

/** Прежняя формула — нужна только чтобы найти строки, посчитанные по ней. */
export function grossUpLegacy(spendNetCents: number, commissionBps: number) {
  return wholeDollars(spendNetCents * (1 + commissionBps / 10_000));
}

export function profitOf(d: { revenueCents: number; spendGrossCents: number }) {
  return d.revenueCents - d.spendGrossCents;
}

export function sum<T>(rows: T[], pick: (row: T) => number) {
  return rows.reduce((acc, row) => acc + pick(row), 0);
}
