'use client';

import { useEffect, useState } from 'react';

/**
 * Удаление оффера в два шага. Вместе с ним уходят гео и загруженные файлы, а
 * промахнуться по «удалить» на телефоне легко — поэтому сначала спрашиваем.
 */
export default function DeleteOffer({
  id,
  name,
  action,
}: {
  id: string;
  name: string;
  action: (formData: FormData) => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="text-[11.5px] text-mute transition hover:text-rust"
      >
        удалить
      </button>
    );
  }

  // Вопрос занимает свою строку целиком: втиснутый рядом с датой он не влезал
  // и уползал за край карточки.
  return (
    <span className="flex basis-full items-center justify-between gap-3 rounded-xl bg-rust-t px-3 py-2">
      <span className="min-w-0 truncate text-[12px] text-soft">Удалить «{name}»?</span>
      <span className="flex shrink-0 items-center gap-1.5">
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="rounded-full bg-rust px-3.5 py-1.5 text-[12px] font-semibold text-bg transition hover:opacity-90"
          >
            Удалить
          </button>
        </form>
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded-full px-3 py-1.5 text-[12px] text-mute transition hover:text-soft"
        >
          Отмена
        </button>
      </span>
    </span>
  );
}
