'use client';

import { useRouter } from 'next/navigation';
import DateField from './DateField';

/**
 * Переключатель недель над отчётами.
 *
 * На странице всегда одна неделя — та, что идёт сейчас. За всё, что раньше,
 * отвечает календарь: выбрал любой день — открылась его неделя. Стрелки
 * листают по одной, «Текущая» возвращает в сегодняшнюю.
 */
export default function WeekNav({
  week,
  label,
  keep,
}: {
  week: string;
  label: string;
  /** Оставлено для совместимости с вызовами; больше не используется. */
  isCurrent?: boolean;
  /** Параметры, которые надо сохранять при смене недели (фильтр баера, овнеры). */
  keep?: Record<string, string>;
}) {
  const router = useRouter();
  const go = (key: string) => {
    const p = new URLSearchParams({ week: key });
    for (const [k, v] of Object.entries(keep ?? {})) if (v) p.set(k, v);
    router.push(`/days?${p.toString()}`);
  };

  const shift = (weeks: number) => {
    const [y, m, d] = week.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + weeks * 7));
    go(at.toISOString().slice(0, 10));
  };

  return (
    <div className="flex items-center gap-1.5">
      {/* Кнопку «Текущая» убрали ради ровного ряда — возврат к текущей неделе
          теперь на иконке слева от заголовка. */}
      <button
        type="button"
        aria-label="Неделя назад"
        onClick={() => shift(-1)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-mute transition hover:bg-sub hover:text-soft"
      >
        ‹
      </button>

      <DateField
        variant="inline"
        align="right"
        range="week"
        value={week}
        label={label}
        onChange={go}
      />

      <button
        type="button"
        aria-label="Неделя вперёд"
        onClick={() => shift(1)}
        className="flex h-7 w-7 items-center justify-center rounded-full text-mute transition hover:bg-sub hover:text-soft"
      >
        ›
      </button>
    </div>
  );
}
