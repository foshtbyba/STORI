'use client';

import { useEffect, useState } from 'react';

/**
 * Удаление оффера в два шага — промахнуться легко, а вместе с оффером уходят
 * гео и файлы. Подтверждение появляется на том же месте справа, плавно
 * (проявление + лёгкий зум), ничего не прыгает и никуда не убегает.
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

  // Имя не показываем — оно и так на карточке; в подтверждении только кнопки.
  void name;

  return (
    <span className="inline-flex items-center justify-end">
      {!armed ? (
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="rounded-full border border-line2 bg-sub px-3.5 py-1.5 text-[11.5px] text-mute transition hover:border-rust hover:text-rust"
        >
          удалить
        </button>
      ) : (
        <span
          className={`inline-flex items-center gap-2 transition-all duration-200 ease-out ${
            show ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          }`}
        >
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
            className="rounded-full border border-line2 bg-sub px-3.5 py-1.5 text-[12px] text-mute transition hover:text-soft"
          >
            Отмена
          </button>
        </span>
      )}
    </span>
  );
}
