'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type Opt = { id: string; name: string };

/**
 * Универсальный combobox в общем дизайне (как выбор шаблона гео): само поле —
 * и есть поиск. Печатаешь → список фильтруется → выбираешь. Значение отдаётся
 * через onChange и, если задан `name`, скрытым input-ом (для нативных форм).
 */
export default function ComboSelect({
  options,
  defaultValue = '',
  value,
  onChange,
  name,
  placeholder = '— выбери —',
  searchPlaceholder = 'Поиск…',
  allowClear = true,
  className = '',
}: {
  options: Opt[];
  defaultValue?: string;
  value?: string;
  onChange?: (id: string) => void;
  name?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  allowClear?: boolean;
  className?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue);
  const current = controlled ? (value as string) : inner;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setQ(''); }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const selectedName = options.find((o) => o.id === current)?.name ?? '';
  const needle = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (needle ? options.filter((o) => o.name.toLowerCase().includes(needle)) : options),
    [options, needle],
  );

  const openUp = () => { setOpen(true); setQ(''); setTimeout(() => inputRef.current?.select(), 0); };
  const pick = (id: string) => {
    if (!controlled) setInner(id);
    onChange?.(id);
    setOpen(false);
    setQ('');
    inputRef.current?.blur();
  };

  const shown = open ? q : selectedName;

  return (
    <div ref={ref} className={`relative ${className || 'w-[240px] max-w-full'}`}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <div className={`flex h-9 items-center rounded-xl border bg-sub pr-2 transition ${open ? 'border-sage' : 'border-line2 hover:border-sage'}`}>
        <input
          ref={inputRef}
          value={shown}
          onFocus={openUp}
          onChange={(e) => { if (!open) setOpen(true); setQ(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (filtered.length) pick(filtered[0].id); }
            else if (e.key === 'Escape') { setOpen(false); setQ(''); inputRef.current?.blur(); }
          }}
          placeholder={open ? searchPlaceholder : placeholder}
          spellCheck={false}
          autoComplete="off"
          className={`h-full min-w-0 flex-1 rounded-xl bg-transparent pl-3.5 pr-1 text-[12.5px] outline-none placeholder:text-mute ${current && !open ? 'text-soft' : 'text-soft'}`}
        />
        <button
          type="button"
          tabIndex={-1}
          onMouseDown={(e) => { e.preventDefault(); if (open) { setOpen(false); setQ(''); } else openUp(); }}
          aria-label={open ? 'Закрыть' : 'Открыть'}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-mute transition hover:text-sage"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open ? (
        <div className="absolute left-0 z-30 mt-1.5 w-full overflow-hidden rounded-[14px] border border-line bg-panel-glass p-1 shadow-[0_12px_30px_rgba(0,0,0,0.5)] backdrop-blur">
          <div className="scroll-slim max-h-[280px] overflow-auto">
            {allowClear && current ? (
              <button type="button" onMouseDown={(e) => { e.preventDefault(); pick(''); }} className="flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12px] text-mute transition hover:bg-sub">
                — сбросить —
              </button>
            ) : null}
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-mute">Ничего не найдено.</div>
            ) : (
              filtered.map((o) => {
                const on = o.id === current;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}
                    className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-1.5 text-left text-[12.5px] transition ${on ? 'bg-sage-t text-sage' : 'text-soft hover:bg-sub'}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
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
