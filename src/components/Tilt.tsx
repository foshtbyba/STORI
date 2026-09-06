'use client';

import { useRef, useState, type ReactNode } from 'react';

const MAX_Y = 14;
const MAX_X = 8;

/**
 * Лёгкий разворот сцены мышью. Рельеф считается на сервере под один ракурс,
 * поэтому это наклон картинки, а не пересчёт геометрии: гора чуть отзывается
 * на перетаскивание и возвращается по двойному клику.
 */
export default function Tilt({ children }: { children: ReactNode }) {
  const [angle, setAngle] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const from = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    from.current = { px: e.clientX, py: e.clientY, x: angle.x, y: angle.y };
    setDragging(true);
  }

  function move(e: React.PointerEvent) {
    const start = from.current;
    if (!start) return;
    const clamp = (v: number, max: number) => Math.max(-max, Math.min(max, v));
    setAngle({
      y: clamp(start.y + (e.clientX - start.px) / 22, MAX_Y),
      x: clamp(start.x - (e.clientY - start.py) / 30, MAX_X),
    });
  }

  function up(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    from.current = null;
    setDragging(false);
  }

  const idle = angle.x === 0 && angle.y === 0;

  return (
    <div
      className={`relative select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ perspective: '1600px' }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => setAngle({ x: 0, y: 0 })}
    >
      <div
        style={{
          transform: `rotateX(${angle.x}deg) rotateY(${angle.y}deg)`,
          transformStyle: 'preserve-3d',
          transition: dragging ? 'none' : 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {children}
      </div>
      <span
        className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-dim transition"
        style={{ opacity: idle ? 1 : 0 }}
      >
        потяни, чтобы развернуть
      </span>
    </div>
  );
}
