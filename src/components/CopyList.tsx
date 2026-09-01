'use client';

import { useEffect, useState } from 'react';

/**
 * «Скопировать списком» — исключения одной кнопкой в буфер, по строке на
 * значение.
 *
 * Вводят их через запятую (так быстрее печатать), а рекламный кабинет ждёт
 * ровно наоборот — каждый город с новой строки. Раньше это перекладывали
 * руками в блокноте на каждый запуск; теперь перекладывает кнопка.
 *
 * Если браузер в буфер не пускает (без https такое бывает), показываем готовый
 * текст прямо на месте — выделить и скопировать всё равно можно.
 */
export default function CopyList({
  items,
  label,
  title,
}: {
  items: string[];
  /** Что пишем на кнопке в спокойном состоянии. */
  label: string;
  /** Подпись для подтверждения: «Города скопированы». */
  title: string;
}) {
  const [done, setDone] = useState(false);
  const [manual, setManual] = useState<string | null>(null);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(t);
  }, [done]);

  if (items.length === 0) return null;

  const text = items.join('\n');

  async function copy() {
    setManual(null);
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
    } catch {
      setManual(text);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={copy}
        title={`${title} — ${items.length} строк, каждая с новой`}
        className={`shrink-0 rounded-full px-3 py-1 text-[11px] transition ${
          done ? 'bg-sage-t text-sage' : 'bg-raise text-mute hover:text-soft'
        }`}
      >
        {done ? 'скопировано' : `${label} · ${items.length}`}
      </button>
      {manual ? (
        // Буфер закрыт — отдаём текст как есть, уже построчно.
        <textarea
          readOnly
          value={manual}
          rows={Math.min(items.length, 8)}
          onFocus={(e) => e.currentTarget.select()}
          className="n mt-2 w-full resize-y rounded-xl border border-line bg-panel px-3 py-2 text-[11.5px] leading-relaxed text-soft outline-none"
        />
      ) : null}
    </>
  );
}
