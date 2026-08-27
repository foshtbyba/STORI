'use client';

import { useEffect, useState } from 'react';

/**
 * «Скопировать для конструктора».
 *
 * Кладёт в буфер одну строку с данными оффера — её вставляют в поле приёма в
 * билдере, и он сам расставляет партнёрку, ID, гео и остальное. Если браузер
 * в буфер не пускает (бывает без https), показываем строку прямо на месте:
 * выделить и скопировать руками всё равно можно.
 */
export default function CopyOffer({
  payload,
  gaps,
}: {
  payload: string;
  /** Чего не хватает, чтобы билдер собрал ленд без ручной доводки. */
  gaps: string[];
}) {
  const [state, setState] = useState<'idle' | 'done' | 'manual'>('idle');

  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(payload);
      setState('done');
    } catch {
      setState('manual');
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <button
        type="button"
        onClick={copy}
        title={gaps.length ? `Не хватает: ${gaps.join(', ')}` : 'Вставляется в конструктор одной кнопкой'}
        className={`flex items-center justify-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition ${
          state === 'done'
            ? 'bg-sage text-bg'
            : 'border border-line text-mute hover:border-sage hover:text-sage'
        }`}
      >
        {state === 'done' ? 'Скопировано' : 'Копировать для билдера'}
      </button>

      {gaps.length ? (
        <span className="text-[11px] leading-relaxed text-amber">
          не хватает: {gaps.join(', ')}
        </span>
      ) : null}

      {state === 'manual' ? (
        <textarea
          readOnly
          rows={3}
          value={payload}
          onFocus={(e) => e.currentTarget.select()}
          className="n w-full resize-none rounded-xl border border-line bg-sub p-2.5 text-[10.5px] leading-relaxed text-mute outline-none"
        />
      ) : null}
    </div>
  );
}
