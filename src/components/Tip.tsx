'use client';

import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Стилевая подсказка вместо браузерного `title`. Само облачко рисуем через
 * портал в body с position:fixed — так оно не обрезается прокруткой таблицы и
 * не занимает место в вёрстке (появляется только при наведении).
 *
 * Облачко держим в пределах экрана: по горизонтали не даём вылезти за края, а
 * если сверху места мало (узкий экран/верх страницы) — показываем снизу. Иначе
 * на телефоне длинный текст обрезался вверху.
 */
const MAXW = 280;

export default function Tip({ label, children, className = '' }: { label: ReactNode; children: ReactNode; className?: string }) {
  const [pos, setPos] = useState<{ x: number; top: number; bottom: number } | null>(null);

  return (
    <span
      className={`relative ${className}`}
      onMouseEnter={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }}
      onMouseLeave={() => setPos(null)}
    >
      {children}
      {pos && typeof document !== 'undefined'
        ? createPortal(
            (() => {
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const half = MAXW / 2;
              // Центр облачка держим так, чтобы края не вылезли за экран.
              const x = Math.min(Math.max(pos.x, half + 8), vw - half - 8);
              // Показываем с той стороны, где больше места (иначе длинную
              // подсказку обрезало сверху). И ограничиваем высоту по экрану.
              const roomAbove = pos.top;
              const roomBelow = vh - pos.bottom;
              const below = roomBelow >= roomAbove;
              const y = below ? pos.bottom + 8 : pos.top - 8;
              const maxH = Math.max(96, (below ? roomBelow : roomAbove) - 16);
              return (
                <span
                  style={{
                    position: 'fixed',
                    left: x,
                    top: y,
                    maxWidth: Math.min(MAXW, vw - 16),
                    maxHeight: maxH,
                    overflow: 'hidden',
                    transform: `translate(-50%, ${below ? '0' : '-100%'})`,
                  }}
                  className="pointer-events-none z-50 whitespace-normal break-words rounded-lg border border-line2 bg-raise px-2.5 py-1.5 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-soft shadow-lg"
                >
                  {label}
                </span>
              );
            })(),
            document.body,
          )
        : null}
    </span>
  );
}
