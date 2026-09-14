'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Фильтр офферов по вертикали. Кастомный выпадающий список в дизайне дешборда —
 * вместо системного select (тот выглядит инородно и стрелка липнет к краю).
 * Выбор сохраняется в ссылке; «все вертикали» — сброс.
 */
export default function OfferVerticalFilter({
  verticals,
  selected,
  status,
  query,
}: {
  verticals: string[];
  selected: string;
  status?: string;
  query?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Клик вне — закрыть.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = (v: string) => {
    setOpen(false);
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    if (v) p.set('vertical', v);
    const s = p.toString();
    router.push(s ? `/offers?${s}` : '/offers');
  };

  const items = [{ value: '', label: 'все вертикали' }, ...verticals.map((v) => ({ value: v, label: v }))];
  const current = items.find((i) => i.value === selected)?.label ?? 'все вертикали';

  return (
    <div ref={ref} className="relative w-[168px] shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-full border bg-sub pl-4 pr-3 text-[12.5px] transition ${open ? 'border-sage text-sage' : 'border-line2 text-soft hover:border-sage'}`}
      >
        <span className="truncate">{current}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`shrink-0 text-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute right-0 z-30 mt-1.5 w-full overflow-hidden rounded-[14px] border border-line bg-panel-glass p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur">
          {items.map((it) => {
            const on = it.value === selected;
            return (
              <button
                key={it.value || 'all'}
                type="button"
                onClick={() => go(it.value)}
                className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12.5px] transition ${on ? 'bg-sage-t text-sage' : 'text-soft hover:bg-sub'}`}
              >
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {on ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0">
                    <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
