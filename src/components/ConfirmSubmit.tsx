'use client';

import { useState, useRef } from 'react';

/**
 * Кнопка отправки формы с подтверждением в два клика. Первый клик не отправляет,
 * а «взводит» кнопку и меняет надпись на «точно?»; второй в течение пары секунд
 * — отправляет. Через 3 секунды взвод сам сбрасывается. Нужна там, где случайный
 * клик неприятен: закрыть период, удалить день, снять доступ.
 */
export default function ConfirmSubmit({
  children,
  confirmLabel = 'точно?',
  className = '',
  armedClassName = '',
  title,
  name,
  value,
}: {
  children: React.ReactNode;
  confirmLabel?: string;
  className?: string;
  /** Классы для «взведённого» состояния — обычно тревожный цвет. */
  armedClassName?: string;
  title?: string;
  name?: string;
  value?: string;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return (
    <button
      type="submit"
      name={name}
      value={value}
      title={title}
      aria-label={title}
      className={`${className} ${armed ? armedClassName : ''}`}
      onClick={(e) => {
        if (!armed) {
          e.preventDefault();
          setArmed(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
        // Взведена — клик проходит и форма отправляется как обычно.
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
