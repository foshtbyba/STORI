'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { grossUp, usd } from '@/lib/money';
import { saveDayGrid } from '@/app/actions/days';
import { Panel, PanelHead, Avatar } from './ui';
import Select from './Select';
import DateField from './DateField';
import { IconCalendar } from './icons';

export type GridBuyer = { id: string; handle: string; initials: string; color: string };
export type GridSeed = {
  buyerId: string;
  revenue: string;
  spend: string;
  pct: string;
  consumable: string;
};

const toCents = (v: string) => {
  const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toBps = (v: string) => {
  const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/**
 * Отчёт за день на всю команду одной таблицей: строка на баера, колонки —
 * доход, расход, комиссия платёжки и расходники. Комиссия считается на лету,
 * расходники тем же сохранением уезжают на экран «Расходники» именной строкой.
 */
export default function DayGrid({
  date,
  buyers,
  types,
  seed,
  seedTypeId,
  defaultPct,
  locked,
}: {
  date: string;
  buyers: GridBuyer[];
  types: { id: string; name: string }[];
  seed: GridSeed[];
  seedTypeId: string;
  defaultPct: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState(seedTypeId || types[0]?.id || '');

  const byId = new Map(seed.map((s) => [s.buyerId, s]));
  const [rows, setRows] = useState<GridSeed[]>(() =>
    buyers.map((b) => byId.get(b.id) ?? { buyerId: b.id, revenue: '', spend: '', pct: defaultPct, consumable: '' }),
  );

  function patch(buyerId: string, field: keyof GridSeed, value: string) {
    setRows((prev) => prev.map((r) => (r.buyerId === buyerId ? { ...r, [field]: value } : r)));
    setNote(null);
  }

  const calc = useMemo(
    () =>
      rows.map((r) => {
        const revenueCents = toCents(r.revenue);
        const spendNetCents = toCents(r.spend);
        const bps = toBps(r.pct);
        const spendGrossCents = grossUp(spendNetCents, bps);
        return {
          ...r,
          revenueCents,
          spendNetCents,
          commissionBps: bps,
          spendGrossCents,
          consumableCents: toCents(r.consumable),
          profitCents: revenueCents - spendGrossCents,
          touched: Boolean(r.revenue || r.spend || r.consumable),
        };
      }),
    [rows],
  );

  const totals = calc.reduce(
    (acc, r) => ({
      revenue: acc.revenue + r.revenueCents,
      gross: acc.gross + r.spendGrossCents,
      consumable: acc.consumable + r.consumableCents,
      profit: acc.profit + r.profitCents,
      filled: acc.filled + (r.touched ? 1 : 0),
    }),
    { revenue: 0, gross: 0, consumable: 0, profit: 0, filled: 0 },
  );

  function submit() {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await saveDayGrid(
        date,
        typeId,
        calc.map((r) => ({
          buyerId: r.buyerId,
          revenueCents: r.revenueCents,
          spendNetCents: r.spendNetCents,
          commissionBps: r.commissionBps,
          consumableCents: r.consumableCents,
        })),
      );
      if (!res.ok) return setError(res.error);
      setNote(`Записано строк: ${res.saved ?? 0}.`);
      router.refresh();
    });
  }

  const cell = 'n h-10 w-full rounded-lg border border-line bg-sub px-3 text-right text-[13.5px] outline-none transition focus:border-sage';
  const cols = 'grid grid-cols-[1.4fr_1fr_1fr_0.75fr_1fr_1fr_1fr] items-center gap-2.5';

  return (
    <Panel className="flex flex-col p-6">
      <PanelHead
        icon={<IconCalendar color="#b4c68c" />}
        tint="bg-sage-t"
        title="Отчёт за день"
        aside={<span className="text-[12.5px] text-mute">вся команда одной таблицей</span>}
        right={
          <span className="w-[168px]">
            <DateField value={date} onChange={(next) => router.push(`/days/new?date=${next}`)} />
          </span>
        }
      />

      <div className="mt-4 flex items-center gap-3">
        <span className="text-[12px] text-mute">Расходники списываем как</span>
        <span className="w-[220px]">
          <Select value={typeId} onChange={setTypeId} options={types.map((t) => ({ value: t.id, label: t.name }))} />
        </span>
      </div>

      <div className={`${cols} mt-5 pb-2.5`}>
        <span className="lab">Баер</span>
        <span className="lab text-right">Доход</span>
        <span className="lab text-right">Расход</span>
        <span className="lab text-right">Комиссия</span>
        <span className="lab text-right">С комиссией</span>
        <span className="lab text-right">Расходники</span>
        <span className="lab text-right">Профит</span>
      </div>

      {calc.map((r) => {
        const buyer = buyers.find((b) => b.id === r.buyerId)!;
        return (
          <div key={r.buyerId} className={`${cols} border-t border-line py-2.5`}>
            <span className="flex items-center gap-2.5">
              <Avatar initials={buyer.initials} color={buyer.color} size={28} />
              <span className="text-[13.5px] font-semibold">{buyer.handle}</span>
            </span>
            <input
              value={r.revenue}
              onChange={(e) => patch(r.buyerId, 'revenue', e.target.value)}
              inputMode="decimal"
              placeholder="0"
              disabled={locked}
              className={cell}
            />
            <input
              value={r.spend}
              onChange={(e) => patch(r.buyerId, 'spend', e.target.value)}
              inputMode="decimal"
              placeholder="0"
              disabled={locked}
              className={cell}
            />
            <span className="relative">
              <input
                value={r.pct}
                onChange={(e) => patch(r.buyerId, 'pct', e.target.value)}
                inputMode="decimal"
                disabled={locked}
                className={`${cell} pr-6`}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-mute">%</span>
            </span>
            <span className="n text-right text-[13.5px] text-mid">
              {r.spendNetCents ? usd(r.spendGrossCents) : '—'}
            </span>
            <input
              value={r.consumable}
              onChange={(e) => patch(r.buyerId, 'consumable', e.target.value)}
              inputMode="decimal"
              placeholder="0"
              disabled={locked}
              className={`${cell} ${r.consumableCents ? 'text-rust' : ''}`}
            />
            <span
              className="n text-right text-[16px] font-semibold"
              style={{ color: !r.touched ? '#5b5b5d' : r.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
            >
              {r.touched ? usd(r.profitCents, { sign: true }) : '—'}
            </span>
          </div>
        );
      })}

      <div className={`${cols} mt-2.5 rounded-[18px] bg-sub px-4 py-3.5`}>
        <span className="lab text-text">Итого</span>
        <span className="n text-right text-[13.5px]">{usd(totals.revenue)}</span>
        <span className="n text-right text-[13px] text-mute">—</span>
        <span className="n text-right text-[13px] text-mute">—</span>
        <span className="n text-right text-[13.5px] text-mid">{usd(totals.gross)}</span>
        <span className="n text-right text-[13.5px] text-rust">{usd(totals.consumable)}</span>
        <span
          className="n text-right text-[18px] font-semibold"
          style={{ color: totals.profit >= 0 ? '#b4c68c' : '#ce6e58' }}
        >
          {usd(totals.profit, { sign: true })}
        </span>
      </div>

      <div className="mt-4 flex items-center gap-3.5">
        <button
          type="button"
          onClick={submit}
          disabled={pending || locked || totals.filled === 0}
          className="h-11 rounded-full bg-sage px-7 text-[13.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Сохраняем…' : `Сохранить день · ${totals.filled}`}
        </button>
        <span className="text-[12px] text-mute">
          {locked
            ? 'Период закрыт — правки заблокированы.'
            : 'Пустые строки не сохраняются. Расходники уедут на свой экран именной строкой.'}
        </span>
        {note ? <span className="text-[12.5px] text-sage">{note}</span> : null}
        {error ? <span className="text-[12.5px] text-rust">{error}</span> : null}
      </div>
    </Panel>
  );
}
