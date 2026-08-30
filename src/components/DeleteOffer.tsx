'use client';

import { useEffect, useState } from 'react';

/**
 * Удаление оффера в два шага. Промахнуться по «удалить» легко, а вместе с
 * оффером уходят гео и файлы — поэтому сначала спрашиваем.
 *
 * Появляется подтверждение на том же месте: красная «Удалить» плавно
 * выезжает вправо, а на старом месте кнопки оказывается «Отмена». Так
 * рефлекторный второй клик попадает в отмену, а не в удаление.
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
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!armed) {
      setShow(false);
      return;
    }
    const r = requestAnimationFrame(() => setShow(true));
    const t = setTimeout(() => setArmed(false), 4000);
    return () => {
      cancelAnimationFrame(r);
      clearTimeout(t);
    };
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className="rounded-full border border-line2 bg-sub px-3.5 py-1.5 text-[11.5px] text-mute transition hover:border-rust hover:text-rust"
      >
        удалить
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`hidden max-w-[150px] truncate text-[12px] text-soft transition-all duration-200 sm:inline ${
          show ? 'opacity-100' : 'opacity-0'
        }`}
      >
        Удалить «{name}»?
      </span>
      {/* Красная «Удалить» выезжает вправо из-под «Отмены». */}
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          className={`rounded-full bg-rust px-3.5 py-1.5 text-[12px] font-semibold text-bg transition-all duration-200 ease-out hover:opacity-90 ${
            show ? 'translate-x-0 opacity-100' : '-translate-x-3 opacity-0'
          }`}
        >
          Удалить
        </button>
      </form>
      {/* «Отмена» — ровно там, где была кнопка «удалить». */}
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="rounded-full border border-line2 bg-sub px-3.5 py-1.5 text-[12px] text-mute transition hover:text-soft"
      >
        Отмена
      </button>
    </span>
  );
}
