/** Periods are calendar months keyed as YYYY-MM. */
export function periodKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodBounds(key: string) {
  const [year, month] = key.split('-').map(Number);
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  return { from, to };
}

export function periodLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  const names = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return `${names[month - 1]} ${year}`;
}

export function shiftPeriod(key: string, months: number) {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + months, 1));
  return periodKey(d);
}

export function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function fmtDay(date: Date) {
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function weekdayShort(date: Date) {
  return ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][date.getUTCDay()];
}

export function daysOfPeriod(key: string) {
  const { from, to } = periodBounds(key);
  const out: Date[] = [];
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) out.push(new Date(d));
  return out;
}

/** Понедельник недели, в которую попала дата. Всё в UTC, как и остальные даты. */
export function weekStart(date: Date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

/** Неделя кодируется датой своего понедельника: YYYY-MM-DD. */
export function weekKey(date: Date) {
  return dayKey(weekStart(date));
}

export function weekBounds(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const from = weekStart(new Date(Date.UTC(y, m - 1, d)));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return { from, to };
}

export function shiftWeek(key: string, weeks: number) {
  const { from } = weekBounds(key);
  from.setUTCDate(from.getUTCDate() + weeks * 7);
  return dayKey(from);
}

const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «18 — 24 августа» или «29 сентября — 5 октября», если неделя на стыке. */
export function weekLabel(key: string) {
  const { from, to } = weekBounds(key);
  const last = new Date(to);
  last.setUTCDate(last.getUTCDate() - 1);
  const a = from.getUTCDate();
  const b = last.getUTCDate();
  if (from.getUTCMonth() === last.getUTCMonth()) {
    return `${a} — ${b} ${MONTH_GEN[last.getUTCMonth()]}`;
  }
  return `${a} ${MONTH_GEN[from.getUTCMonth()]} — ${b} ${MONTH_GEN[last.getUTCMonth()]}`;
}
