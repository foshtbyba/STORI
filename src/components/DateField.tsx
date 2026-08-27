'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];

const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;

/** Ширина листа календаря и отступ, который держим от краёв экрана. */
const W = 268;
const GAP = 14;

const parse = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : new Date();
};

/**
 * Поле даты со своим календарём.
 *
 * Родной <input type="date"> открывает системную панель: она приезжает со
 * своими шрифтами, красными выходными и кнопкой «Очистить» — мимо всей
 * остальной вёрстки. Здесь календарь свой и выглядит как наш же список
 * выбора, а значение уезжает в форму скрытым полем.
 */
export default function DateField({
  name,
  value,
  defaultValue,
  onChange,
  disabled = false,
  label,
  align = 'left',
  variant = 'field',
  range = 'day',
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  /** Своя подпись на кнопке вместо даты — например, диапазон недели. */
  label?: string;
  align?: 'left' | 'right';
  /** `week` — подсвечивать всю неделю выбранного дня, а не один день. */
  range?: 'day' | 'week';
  /** `inline` — компактная кнопка для шапки панели, без рамки поля. */
  variant?: 'field' | 'inline';
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? iso(new Date()));
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parse(current));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  /**
   * Календарь рисуем поверх страницы, а не внутри блока.
   *
   * Абсолютный блок внутри потока не меняет высоту родителя, но всё равно
   * попадает в область прокрутки документа: открыл календарь у нижнего поля —
   * и страница выросла, появилась лишняя прокрутка. С fixed этого не
   * происходит: координаты считаем от кнопки и разворачиваем вверх, если
   * снизу не помещается.
   */
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (open) setMonth(parse(current));
  }, [open, current]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const t = trigger.current?.getBoundingClientRect();
      if (!t) return;
      const h = sheet.current?.offsetHeight ?? 320;
      const below = window.innerHeight - t.bottom;
      const wanted = below < h + 12 && t.top > h + 12 ? t.top - h - 6 : t.bottom + 6;
      // На совсем низком экране не помещается ни вниз, ни вверх — тогда просто
      // прижимаем к краю, чтобы календарь не уехал за пределы видимого.
      const top = Math.max(8, Math.min(wanted, window.innerHeight - h - 8));
      // Ширину берём у документа, а не у окна: innerWidth считает и полосу
      // прокрутки, из-за неё календарь у правого края вставал под неё впритык.
      const vw = document.documentElement.clientWidth;
      // У правого края разворачиваем от правого угла поля, а не от левого:
      // иначе календарь упирается в кромку экрана.
      const toRight = align === 'right' || t.left + W + GAP > vw;
      const wantedLeft = toRight ? t.right - W : t.left;
      const left = Math.max(GAP, Math.min(wantedLeft, vw - W - GAP));
      setAt({ left, top });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align, month]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!root.current?.contains(t) && !sheet.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(day: Date) {
    const next = iso(day);
    if (!controlled) setInner(next);
    onChange?.(next);
    setOpen(false);
  }

  const shown = parse(current);
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1));
  // Неделя начинается с понедельника, поэтому воскресенье уезжает в конец.
  const lead = (first.getUTCDay() + 6) % 7;
  const total = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
  ).getUTCDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= total; d++) {
    cells.push(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), d)));
  }

  const shift = (by: number) =>
    setMonth(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + by, 1)));

  const today = iso(new Date());
  const mondayOf = (d: Date) => {
    const m = new Date(d);
    m.setUTCDate(m.getUTCDate() - ((m.getUTCDay() + 6) % 7));
    return iso(m);
  };
  const currentWeek = mondayOf(shown);

  return (
    <div ref={root} className="relative">
      {name ? <input type="hidden" name={name} value={current} /> : null}

      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={
          variant === 'inline'
            ? `n flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition ${
                open ? 'border-sage text-soft' : 'border-line text-mute hover:border-line2 hover:text-soft'
              }`
            : `n flex h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 text-left text-[14px] transition ${
                disabled
                  ? 'cursor-default border-line bg-sub text-mute'
                  : open
                    ? 'border-sage bg-sub'
                    : 'border-line bg-sub hover:border-line2'
              }`
        }
      >
        <span>
          {label ??
            `${String(shown.getUTCDate()).padStart(2, '0')}.${String(
              shown.getUTCMonth() + 1,
            ).padStart(2, '0')}.${shown.getUTCFullYear()}`}
        </span>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={2} className="shrink-0 text-mute" aria-hidden>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
        <div
          ref={sheet}
          role="dialog"
          style={{ left: at?.left ?? -9999, top: at?.top ?? -9999 }}
          className="fixed z-50 w-[268px] rounded-xl border border-line2 bg-raise p-3 shadow-lg shadow-black/40"
        >
          <div className="mb-2.5 flex items-center justify-between">
            <button type="button" onClick={() => shift(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-mute transition hover:bg-sub hover:text-soft">
              ‹
            </button>
            <span className="text-[13px] font-semibold">
              {MONTHS[month.getUTCMonth()]} {month.getUTCFullYear()}
            </span>
            <button type="button" onClick={() => shift(1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-mute transition hover:bg-sub hover:text-soft">
              ›
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <span key={w} className="text-center text-[10.5px] text-dim">{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {cells.map((day, i) => {
              if (!day) return <span key={`x${i}`} />;
              const key = iso(day);
              const active =
                range === 'week' ? mondayOf(day) === currentWeek : key === current;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick(day)}
                  className={`n flex h-8 items-center justify-center rounded-lg text-[12.5px] transition ${
                    active
                      ? range === 'week'
                        ? 'bg-sage-t font-semibold text-sage'
                        : 'bg-sage font-semibold text-bg'
                      : key === today
                        ? 'text-sage hover:bg-sub'
                        : 'text-soft hover:bg-sub'
                  }`}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => pick(new Date())}
            className="mt-2.5 w-full rounded-lg bg-sub py-1.5 text-[12px] text-mute transition hover:text-soft"
          >
            Сегодня
          </button>
        </div>,
            document.body,
          )
        : null}
    </div>
  );
}
