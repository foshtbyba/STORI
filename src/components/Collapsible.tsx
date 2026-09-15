'use client';

import { useState, type ReactNode } from 'react';
import { Panel, Badge } from './ui';

/**
 * Панель со сворачиваемым содержимым: шапка-кнопка + плавное раскрытие тела
 * (grid-rows 0fr→1fr, как у списков кабинетов). Содержимое рендерит сервер и
 * передаёт сюда детьми — серверные формы внутри работают как обычно.
 */
export default function Collapsible({
  title,
  icon,
  tint,
  aside,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  tint?: string;
  aside?: ReactNode;
  /** Всегда видимое описание — показываем и в закрытом виде (под шапкой). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel className="p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5 sm:gap-[13px]">
          <Badge tint={tint}>{icon}</Badge>
          <span className="text-[17px] font-semibold tracking-[-0.015em]">{title}</span>
          {aside}
        </span>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          className={`pointer-events-none shrink-0 text-mute transition-transform duration-300 ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {summary ? <div className="mt-3">{summary}</div> : null}
      <div className={`grid transition-all duration-300 ${open ? 'mt-3 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">{children}</div>
      </div>
    </Panel>
  );
}
