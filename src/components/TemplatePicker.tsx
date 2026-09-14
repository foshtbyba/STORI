'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Opt = { id: string; name: string };

/**
 * Выбор шаблона гео при заливе. Кастомный выпадающий список в дизайне дешборда
 * с поиском: шаблонов много (по стране на каждый), нативный select разворачивался
 * простынёй. Вписал «PT» — остались подходящие, выбрал как раньше.
 */
export default function TemplatePicker({
  templates,
  value,
  onPick,
}: {
  templates: Opt[];
  value: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Клик вне — закрыть.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Открыли — фокус в поиск и чистое поле.
  useEffect(() => {
    if (open) {
      setQ('');
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  const current = templates.find((t) => t.id === value)?.name ?? '— шаблон гео —';
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? templates.filter((t) => t.name.toLowerCase().includes(needle)) : templates),
    [templates, needle],
  );

  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative w-[280px] max-w-full shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-xl border bg-sub pl-3.5 pr-3 text-[12.5px] transition ${open ? 'border-sage text-sage' : 'border-line2 text-soft hover:border-sage'}`}
      >
        <span className={`truncate ${value ? '' : 'text-mute'}`}>{current}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`shrink-0 text-mute transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="absolute left-0 z-30 mt-1.5 w-full overflow-hidden rounded-[14px] border border-line bg-panel-glass p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Впиши гео… (PT, UA, ES)"
            className="mb-1 h-8 w-full rounded-[10px] border border-line2 bg-bg px-3 text-[12px] text-soft outline-none placeholder:text-dim focus:border-sage"
          />
          <div className="scroll-slim max-h-[260px] overflow-auto">
            {value ? (
              <button type="button" onClick={() => pick('')} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12px] text-mute transition hover:bg-sub">
                — сбросить —
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-mute">Ничего не найдено.</div>
            ) : (
              filtered.map((t) => {
                const on = t.id === value;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => pick(t.id)}
                    className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12.5px] transition ${on ? 'bg-sage-t text-sage' : 'text-soft hover:bg-sub'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    {on ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0">
                        <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
