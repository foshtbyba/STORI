'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Фильтр отчётов по дням по баеру: выбрал человека — видишь только его строки
 * и итог. Сохраняет неделю и режим овнеров в ссылке. «Все» — сброс фильтра.
 *
 * Свой дропдаун (не нативный <select>): у нативного список рисует ОС — чужой
 * шрифт, галочка, мимо всей вёрстки. Тут список в общем дизайне приложения.
 */
export default function DayBuyerFilter({
  buyers,
  selected,
  week,
  owners,
}: {
  buyers: { id: string; handle: string }[];
  selected: string;
  week?: string;
  owners?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (buyer: string) => {
    setOpen(false);
    const p = new URLSearchParams();
    if (week) p.set('week', week);
    if (owners) p.set('owners', '1');
    if (buyer) p.set('buyer', buyer);
    const q = p.toString();
    router.push(q ? `/days?${q}` : '/days');
  };

  const options = [{ id: '', handle: 'все баеры' }, ...buyers];
  const current = options.find((o) => o.id === selected) ?? options[0];

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Показать одного баера"
        className={`flex h-9 items-center gap-2 rounded-full border bg-sub px-3.5 text-[12.5px] text-soft transition ${open ? 'border-sage' : 'border-line2 hover:border-line'}`}
      >
        <span className="truncate">{current.handle}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} className={`pointer-events-none shrink-0 text-mute transition ${open ? 'rotate-180' : ''}`} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul role="listbox" className="absolute right-0 top-full z-20 mt-1.5 max-h-64 min-w-[160px] overflow-auto rounded-xl border border-line2 bg-raise p-1.5 shadow-lg shadow-black/40">
          {options.map((o) => {
            const isCurrent = o.id === selected;
            return (
              <li key={o.id || '__all'} role="option" aria-selected={isCurrent}>
                <button
                  type="button"
                  onClick={() => go(o.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition hover:bg-sub ${isCurrent ? 'text-sage' : 'text-text'}`}
                >
                  <span className="w-3 shrink-0 text-sage">{isCurrent ? '✓' : ''}</span>
                  <span className="truncate">{o.handle}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
