'use client';

import { useRouter } from 'next/navigation';

/**
 * Фильтр отчётов по дням по баеру: выбрал человека — видишь только его строки
 * и итог. Сохраняет неделю и режим овнеров в ссылке. «Все» — сброс фильтра.
 */
export default function DayBuyerFilter({
  buyers,
  selected,
  week,
  owners,
}: {
  buyers: { id: string; handle: string }[];
  selected: string;
  week?: string;
  owners?: boolean;
}) {
  const router = useRouter();

  const go = (buyer: string) => {
    const p = new URLSearchParams();
    if (week) p.set('week', week);
    if (owners) p.set('owners', '1');
    if (buyer) p.set('buyer', buyer);
    const q = p.toString();
    router.push(q ? `/days?${q}` : '/days');
  };

  return (
    <select
      value={selected}
      onChange={(e) => go(e.target.value)}
      className="h-9 rounded-full border border-line2 bg-sub px-3.5 text-[12.5px] text-soft outline-none focus:border-sage"
      title="Показать одного баера"
    >
      <option value="">все баеры</option>
      {buyers.map((b) => (
        <option key={b.id} value={b.id}>{b.handle}</option>
      ))}
    </select>
  );
}
