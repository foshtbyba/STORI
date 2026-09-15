'use client';

import { useState, type ReactNode } from 'react';

/**
 * Лёгкий инлайн-раскрыватель: шапка-кнопка + плавное раскрытие тела
 * (grid-rows 0fr→1fr). Без своей панели/рамки — вставляется внутрь блоков,
 * где полноценная плитка была бы лишней (напр. форма добавления кабинета).
 */
export default function Reveal({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="min-w-0">
          <span className="text-[12.5px] font-semibold">{title}</span>
          {hint ? <span className="ml-2 text-[11.5px] text-mute">{hint}</span> : null}
        </span>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
          className={`pointer-events-none shrink-0 text-mute transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'mt-3 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
