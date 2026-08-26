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
