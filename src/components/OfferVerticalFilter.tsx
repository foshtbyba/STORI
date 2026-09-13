'use client';

import { useRouter } from 'next/navigation';

/**
 * Фильтр офферов по вертикали. Список — из доступных вертикалей. Сохраняет
 * выбранный статус и поиск в ссылке. «Все вертикали» — сброс.
 */
export default function OfferVerticalFilter({
  verticals,
  selected,
  status,
  query,
}: {
  verticals: string[];
  selected: string;
  status?: string;
  query?: string;
}) {
  const router = useRouter();
  const go = (v: string) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    if (v) p.set('vertical', v);
    const s = p.toString();
    router.push(s ? `/offers?${s}` : '/offers');
  };

  return (
    <select
      value={selected}
      onChange={(e) => go(e.target.value)}
      className="h-9 shrink-0 rounded-full border border-line2 bg-sub px-3.5 text-[12.5px] text-soft outline-none focus:border-sage"
      title="Фильтр по вертикали"
    >
      <option value="">все вертикали</option>
      {verticals.map((v) => (
        <option key={v} value={v}>{v}</option>
      ))}
    </select>
  );
}
