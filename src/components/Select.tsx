'use client';

import { useEffect, useId, useRef, useState } from 'react';

export type Option = { value: string; label: string; hint?: string };

/**
 * Родной <select> отдаёт список на откуп операционной системе — на macOS он
 * приезжает с галочкой и системными шрифтами, мимо всей остальной вёрстки.
 * Здесь список свой, а значение уезжает в форму скрытым полем, так что
 * серверные экшены работают как с обычным полем.
 */
export default function Select({
  name,
  options,
  defaultValue,
  value,
  onChange,
  placeholder = 'Выбрать',
  disabled = false,
  label,
  triggerClassName,
}: {
  name?: string;
  options: Option[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  /** Классы кнопки-триггера — чтобы вписать селект в локальный стиль полей
   *  (напр. компактный `field`). Пусто — дефолтный крупный вид. */
  triggerClassName?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? '');
  const current = controlled ? value : inner;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  const selected = options.find((o) => o.value === current);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(option: Option) {
    if (!controlled) setInner(option.value);
    onChange?.(option.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (open && options[active]) pick(options[active]);
      else setOpen(true);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      setActive((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
        return (next + options.length) % options.length;
      });
    }
  }

  return (
    <div ref={root} className="relative">
      {name ? <input type="hidden" name={name} value={current} /> : null}
      {label ? <span className="text-[11.5px] text-mute">{label}</span> : null}

      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={onKeyDown}
        className={
          triggerClassName
            ? `flex items-center justify-between gap-2 text-left ${triggerClassName} ${open ? '!border-sage' : ''} ${disabled ? 'cursor-default opacity-60' : ''}`
            : `${label ? 'mt-2 ' : ''}flex h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 text-left text-[14.5px] transition ${
                disabled
                  ? 'cursor-default border-line bg-sub text-mute'
                  : open
                    ? 'border-sage bg-sub'
                    : 'border-line bg-sub hover:border-line2'
              }`
        }
      >
        <span className={`truncate ${selected ? '' : 'text-mute'}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth={2.4} className={`pointer-events-none shrink-0 text-mute transition ${open ? 'rotate-180' : ''}`}
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-64 overflow-auto rounded-xl border border-line2 bg-raise p-1.5 shadow-lg shadow-black/40"
        >
          {options.map((option, i) => {
            const isCurrent = option.value === current;
            return (
              <li key={option.value || '__empty'} role="option" aria-selected={isCurrent}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(option)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] transition ${
                    i === active ? 'bg-sub' : ''
                  } ${isCurrent ? 'text-sage' : 'text-text'}`}
                >
                  <span className="truncate">{option.label}</span>
                  {option.hint ? (
                    <span className="n shrink-0 text-[11.5px] text-mute">{option.hint}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[13px] text-mute">Пусто</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
