'use client';

import { useState, useRef, useLayoutEffect } from 'react';
import type { ReactNode } from 'react';

/**
 * Сворачивает длинный блок до нескольких строк и раскрывает по клику. Кнопка
 * появляется только если контент реально не влез — короткие блоки остаются как
 * есть. Нужна на карточке оффера: длинный список городов-исключений раздувал
 * карточку, а у соседних без него внизу зияла пустота.
 */
export default function Clamp({
  collapsedPx = 54,
  children,
  moreLabel = 'показать всё',
  lessLabel = 'свернуть',
}: {
  collapsedPx?: number;
  children: ReactNode;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setOverflow(el.scrollHeight > collapsedPx + 4);
  }, [children, collapsedPx]);

  return (
    <div>
      <div
        ref={ref}
        style={{ maxHeight: open || !overflow ? undefined : collapsedPx }}
        className="overflow-hidden transition-[max-height] duration-300 ease-out"
      >
        {children}
      </div>
      {overflow ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-[11.5px] text-mute transition hover:text-soft"
        >
          {open ? lessLabel : moreLabel}
        </button>
      ) : null}
    </div>
  );
}
