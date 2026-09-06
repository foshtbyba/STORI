'use client';

import { useFormStatus } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * Кнопка отправки, которая гаснет на время отправки.
 *
 * Обычная кнопка формы остаётся живой, пока сервер думает: второй клик — и в
 * базе два одинаковых оффера. Здесь состояние берётся у самой формы, так что
 * пока запрос в пути кнопка не нажимается и честно пишет, что занята.
 *
 * Работает только внутри `<form>` — на том и стоит: собственного состояния у
 * неё нет, и рассинхронизироваться ей не с чем.
 */
export default function SubmitButton({
  children,
  pendingLabel = 'Сохраняю…',
  className = '',
}: {
  children: ReactNode;
  /** Что написать, пока идёт отправка. */
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} ${pending ? 'cursor-progress opacity-60' : ''}`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
