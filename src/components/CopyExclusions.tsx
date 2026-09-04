'use client';

import { useEffect, useRef, useState } from 'react';

export type ExclusionGroup = {
  /** Гео, к которому относится список: «CZ». Пусто — список общий на все гео. */
  key: string;
  items: string[];
};

/**
 * «Скопировать исключения» — списком, по строке на значение.
 *
 * Вводят их через запятую (так быстрее печатать), а рекламный кабинет ждёт
 * ровно наоборот. Раньше это перекладывали руками в блокноте на каждый запуск.
 *
 * Гео у оффера обычно несколько, и запрещено в них разное — поэтому кнопка
 * раскрывается списком гео, как и «копировать для конструктора». Гео одно (или
 * исключения общие на все) — копируем сразу, без лишнего клика.
 *
 * Если браузер в буфер не пускает (без https такое бывает), показываем готовый
 * текст прямо на месте: выделить и скопировать всё равно можно.
 */
export default function CopyExclusions({
  label,
  title,
  groups,
}: {
  /** Что пишем на кнопке: «копировать регионы». */
  label: string;
  /** Подпись для подсказки: «Регионы-исключения». */
  title: string;
  groups: ExclusionGroup[];
}) {
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

  const filled = groups.filter((g) => g.items.length > 0);
  if (filled.length === 0) return null;

  async function copy(group: ExclusionGroup) {
    setManual(null);
    const text = group.items.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setDone(group.key || 'ok');
      setOpen(false);
    } catch {
      setManual(text);
      setOpen(false);
    }
  }

  const only = filled.length === 1 ? filled[0] : null;
  const pill = `shrink-0 rounded-full px-3 py-1 text-[11px] transition ${
    done ? 'bg-sage-t text-sage' : 'bg-raise text-mute hover:text-soft'
  }`;

  return (
    <div ref={root} className="relative shrink-0">
      {only ? (
        <button
          type="button"
          onClick={() => copy(only)}
          title={`${title} — ${only.items.length} строк, каждая с новой`}
          className={pill}
        >
          {done ? 'скопировано' : `${label} · ${only.items.length}`}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          title={`${title} — у каждого гео свои, выбери нужное`}
          className={pill}
        >
          {done ? `скопировано · ${done.toUpperCase()}` : `${label} · по гео`}
        </button>
      )}

      {open ? (
        <div className="absolute right-0 top-full z-20 mt-1.5 min-w-[190px] overflow-hidden rounded-xl border border-line2 bg-panel py-1 shadow-lg">
          {filled.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => copy(g)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[12px] text-soft transition hover:bg-sub hover:text-text"
            >
              <span className="n">{g.key.toUpperCase()}</span>
              <span className="text-[11px] text-dim">{g.items.length}</span>
            </button>
          ))}
        </div>
      ) : null}

      {manual ? (
        // Буфер закрыт — отдаём текст как есть, уже построчно.
        <textarea
          readOnly
          value={manual}
          rows={6}
          onFocus={(e) => e.currentTarget.select()}
          className="n absolute right-0 top-full z-20 mt-1.5 w-[280px] resize-y rounded-xl border border-line bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-soft outline-none"
        />
      ) : null}
    </div>
  );
}
