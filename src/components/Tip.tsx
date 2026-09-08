'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Стилевая подсказка вместо браузерного `title`. Само облачко рисуем через
 * портал в body с position:fixed — так оно не обрезается прокруткой таблицы и
 * не занимает место в вёрстке (появляется только при наведении).
 */
export default function Tip({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  return (
    <span
      className={`relative ${className}`}
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== 'undefined'
        ? createPortal(
            <span
              style={{ position: 'fixed', left: pos.x, top: pos.y - 8, transform: 'translate(-50%, -100%)' }}
              className="pointer-events-none z-50 max-w-xs whitespace-normal rounded-lg border border-line2 bg-raise px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-soft shadow-lg"
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
