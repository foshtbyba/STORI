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
  isCurrent,
}: {
  week: string;
  label: string;
  isCurrent: boolean;
}) {
  const router = useRouter();
  const go = (key: string) => router.push(`/days?week=${key}`);

  const shift = (weeks: number) => {
    const [y, m, d] = week.split('-').map(Number);
    const at = new Date(Date.UTC(y, m - 1, d + weeks * 7));
    go(at.toISOString().slice(0, 10));
  };

  return (
    <div className="flex items-center gap-1.5">
      {isCurrent ? null : (
        <button
          type="button"
          onClick={() => go(new Date().toISOString().slice(0, 10))}
          className="n rounded-full border border-line px-3 py-1.5 text-[12.5px] text-mute transition hover:border-line2 hover:text-soft"
        >
          Текущая
        </button>
      )}

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
