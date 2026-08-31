'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Panel, Badge } from './ui';

/**
 * Панель-плитка, которая раскрывается по клику на шапку. По умолчанию свёрнута:
 * тяжёлый график не грузит экран, пока он не нужен. Заголовок и краткая сводка
 * видны всегда, тело — только в раскрытом виде.
 */
export default function CollapsiblePanel({
  icon,
  tint,
  title,
  aside,
  summary,
  defaultOpen = false,
  className = '',
  children,
}: {
  icon: ReactNode;
  tint?: string;
  title: string;
  aside?: ReactNode;
  /** Короткая сводка в свёрнутом виде (справа). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Panel className={`p-4 sm:p-6 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-y-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5 sm:gap-[13px]">
          <Badge tint={tint}>{icon}</Badge>
          <span className="text-[17px] font-semibold tracking-[-0.015em]">{title}</span>
          {aside ? (
            <>
              <span className="hidden h-5 w-px bg-line2 sm:block" />
              {aside}
            </>
          ) : null}
        </span>
        <span className="flex items-center gap-3">
          {summary}
          <span className="text-[12px] text-dim">{open ? 'свернуть' : 'развернуть'}</span>
        </span>
      </button>
      {open ? <div className="mt-5">{children}</div> : null}
    </Panel>
  );
}
