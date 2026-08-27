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

  return (
    <span className="flex items-center gap-2">
      <span className="text-[11px] text-mute">Удалить «{name}»?</span>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className="text-[11.5px] font-semibold text-rust">
          да
        </button>
      </form>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-[11.5px] text-dim transition hover:text-soft"
      >
        нет
      </button>
    </span>
  );
}
