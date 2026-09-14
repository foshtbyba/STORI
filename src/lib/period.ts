/**
 * Расчётный период — НЕДЕЛЯ, с понедельника по воскресенье, и ключом ей
 * служит дата понедельника: 2026-08-24. За неделю считается всё — статистика,
 * оклад, пороги ставки, курс и закрытие.
 *
 * Месячные помощники ниже остались для календаря посещаемости: там нужна
 * именно сетка месяца, неделя её не заменяет.
 */
export function periodKeyOf(date: Date) {
  return weekKey(date);
}

/** Границы расчётного периода. */
export function periodRange(key: string) {
  return weekBounds(key);
}

/** Подпись расчётного периода: «24 — 30 августа». */
export function periodTitle(key: string) {
  return weekLabel(key);
}

/** Календарные месяцы: YYYY-MM. Нужны только календарю посещаемости. */
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

/**
 * Дата и время последнего обновления: «07.09 в 14:35». Время — в поясе
 * команды (SYNC_TZ, по умолчанию Москва), а не в UTC: сервер живёт в UTC, но
 * баеру важно своё время. Intl сам переведёт.
 */
export function fmtWhen(date: Date, tz = process.env.SYNC_TZ || 'Europe/Moscow') {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${g('day')}.${g('month')} в ${g('hour')}:${g('minute')}`;
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

/** Дни отрезка — по ним строится дневной график недели. */
export function daysOfRange({ from, to }: { from: Date; to: Date }) {
  const out: Date[] = [];
  for (const d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) out.push(new Date(d));
  return out;
}

/**
 * Ключ отрезка бывает двух видов: неделя (2026-08-24, дата понедельника) и
 * месяц (2026-08). По длине их и различаем — так один переключатель умеет
 * листать и то, и другое.
 */
export function isWeekKey(key: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(key);
}

export function rangeOf(key: string) {
  return isWeekKey(key) ? weekBounds(key) : periodBounds(key);
}

export function titleOf(key: string) {
  return isWeekKey(key) ? weekLabel(key) : periodLabel(key);
}

export function shiftKey(key: string, by: number) {
  return isWeekKey(key) ? shiftWeek(key, by) : shiftPeriod(key, by);
}

/**
 * Можно ли ещё трогать запись этой даты: открыты только текущая и прошлая
 * неделя. Позапрошлая и раньше — закрытый период (зарплаты посчитаны), правкам
 * и удалению задним числом там не место.
 */
export function isWeekEditable(date: Date, now: Date = new Date()): boolean {
  const w = weekKey(date);
  const cur = weekKey(now);
  return w === cur || w === shiftKey(cur, -1);
}

/** Тот же момент времени, но другим масштабом: неделя ↔ месяц. */
export function switchMode(key: string, mode: 'week' | 'month') {
  const { from } = rangeOf(key);
  return mode === 'week' ? weekKey(from) : periodKey(from);
}

/**
 * Недели, которые попадают в отрезок, — по ключу понедельника.
 *
 * Нужны там, где отрезок шире расчётного периода: зарплата считается за
 * неделю, и месячная сводка обязана складывать четыре-пять недельных листов,
 * а не считать процент от месячной суммы. Иначе месяц показывает ставку,
 * которой на деле ни у кого не было.
 */
export function weeksOfRange({ from, to }: { from: Date; to: Date }) {
  const out: string[] = [];
  for (const d = weekStart(from); d < to; d.setUTCDate(d.getUTCDate() + 7)) {
    out.push(dayKey(d));
  }
  return out;
}

/**
 * Граница ручной правки отчётов: понедельник ПРОШЛОЙ недели. Отчёты текущей и
 * прошлой недели править можно, всё, что раньше (позапрошлая и глубже), — уже
 * только чтение. Синхронизация под это правило не подпадает: она пишет цифры
 * сама, а запрет касается ручных правок человека.
 */
const EDIT_WINDOW_WEEKS = 1;
export function editWindowStart(now: Date = new Date()) {
  const monday = weekStart(now);
  monday.setUTCDate(monday.getUTCDate() - 7 * EDIT_WINDOW_WEEKS);
  return monday;
}

/** Можно ли ещё править отчёт за эту дату руками. */
export function isEditable(date: Date, now: Date = new Date()) {
  return date.getTime() >= editWindowStart(now).getTime();
}
