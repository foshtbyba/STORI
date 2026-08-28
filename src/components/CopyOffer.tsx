'use client';

import { useEffect, useRef, useState } from 'react';

export type GeoPayload = {
  langCode: string;
  payload: string;
  gaps: string[];
};

/**
 * «Скопировать для конструктора».
 *
 * У оффера обычно несколько гео, и в билдер под каждое уходит своё — поэтому
 * кнопка раскрывается списком гео. Одно гео — копируем сразу, без лишнего
 * клика. Если браузер в буфер не пускает (бывает без https), показываем
 * строку прямо на месте: выделить и скопировать руками всё равно можно.
 */
export default function CopyOffer({ geos }: { geos: GeoPayload[] }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 1800);
    return () => clearTimeout(t);
  }, [done]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  async function copy(g: GeoPayload) {
    setManual(null);
    try {
      await navigator.clipboard.writeText(g.payload);
      setDone(g.langCode);
      setOpen(false);
    } catch {
      setManual(g.payload);
      setOpen(false);
    }
  }

  if (geos.length === 0) {
    return (
      <span className="flex-1 rounded-full border border-line px-4 py-2 text-center text-[12px] text-dim">
        гео не заведены
      </span>
    );
  }

  const label = done ? `Скопировано · ${done.toUpperCase()}` : 'Копировать для билдера';

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => (geos.length === 1 ? copy(geos[0]) : setOpen((o) => !o))}
        className={`flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-[12.5px] font-semibold transition ${
          done
            ? 'bg-sage text-bg'
            : 'border border-line2 bg-sub text-soft hover:border-sage hover:text-sage'
        }`}
      >
        {label}
        {geos.length > 1 && !done ? (
          <span className="n text-[11px] opacity-70">{geos.length} гео</span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-full min-w-[210px] overflow-hidden rounded-xl border border-line2 bg-raise p-1.5 shadow-lg shadow-black/40">
          {geos.map((g) => (
            <button
              key={g.langCode}
              type="button"
              onClick={() => copy(g)}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-sub"
            >
              <span className="n text-[13px] font-semibold">{g.langCode.toUpperCase()}</span>
              {g.gaps.length ? (
                <span className="truncate text-[10.5px] text-amber">нет: {g.gaps.join(', ')}</span>
              ) : (
                <span className="text-[10.5px] text-dim">готово</span>
              )}
            </button>
          ))}
        </div>
      ) : null}

      {manual ? (
        <textarea
          readOnly
          rows={3}
          value={manual}
          onFocus={(e) => e.currentTarget.select()}
          className="n mt-2 w-full resize-none rounded-xl border border-line bg-sub p-2.5 text-[10.5px] leading-relaxed text-mute outline-none"
        />
      ) : null}
    </div>
  );
}
