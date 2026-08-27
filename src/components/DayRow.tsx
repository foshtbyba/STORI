'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usd, grossUp } from '@/lib/money';
import { updateDay, deleteDay } from '@/app/actions/days';
import { Avatar } from './ui';

export type DayRowData = {
  id: string;
  day: string;
  weekday: string;
  buyer: { initials: string; color: string; handle: string };
  source: string;
  revenueCents: number;
  spendNetCents: number;
  spendGrossCents: number;
  commissionBps: number;
  note: string;
};

const GRID = 'grid grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)_auto] items-center';

/**
 * Строка отчёта за день. Админ правит её на месте: раскрывается три поля,
 * расход с комиссией пересчитывается на лету. Уходить на отдельный экран ради
 * исправленной цифры незачем.
 */
export default function DayRow({ row, canEdit }: { row: DayRowData; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const num = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
  const [revenue, setRevenue] = useState(num(row.revenueCents));
  const [spend, setSpend] = useState(num(row.spendNetCents));
  const [pct, setPct] = useState((row.commissionBps / 100).toString());
  const [note, setNote] = useState(row.note);

  const toCents = (v: string) => {
    const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const bps = Math.round((Number.parseFloat(pct.replace(',', '.')) || 0) * 100);
  const gross = grossUp(toCents(spend), bps);
  const profit = toCents(revenue) - gross;

  function save() {
    setError(null);
    start(async () => {
      const res = await updateDay({
        id: row.id,
        revenueCents: toCents(revenue),
        spendNetCents: toCents(spend),
        commissionBps: bps,
        note,
      });
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  function remove() {
    setError(null);
    start(async () => {
      const res = await deleteDay(row.id);
      if (!res.ok) return setError(res.error);
      router.refresh();
    });
  }

  const field = 'n h-9 w-full rounded-lg border border-line bg-sub px-3 text-right text-[13px] outline-none transition focus:border-sage';

  return (
    <div className="border-t border-line">
      <div className={`${GRID} py-3`}>
        <span className="flex items-baseline gap-2">
          <span className="n text-[15px] font-semibold">{row.day}</span>
          <span className="text-[11px] text-mute">{row.weekday}</span>
        </span>
        <span className="flex items-center gap-2.5">
          <Avatar initials={row.buyer.initials} color={row.buyer.color} size={28} />
          <span className="text-[13px]">{row.buyer.handle}</span>
        </span>
        <span className="truncate text-[13px] text-soft">{row.source}</span>
        <span className="n text-right text-[13.5px] text-soft">{usd(row.revenueCents)}</span>
        <span className="n text-right text-[13.5px] text-mute">{usd(row.spendNetCents)}</span>
        <span className="n text-right text-[13.5px] text-mute">
          {usd(row.spendGrossCents)}
          <span className="ml-1.5 text-[11px] text-dim">{(row.commissionBps / 100).toFixed(2)}%</span>
        </span>
        <span
          className="n text-right text-[17px] font-semibold"
          style={{ color: row.revenueCents - row.spendGrossCents >= 0 ? '#b4c68c' : '#ce6e58' }}
        >
          {usd(row.revenueCents - row.spendGrossCents, { sign: true })}
        </span>
        <span className="pl-3">
          {canEdit ? (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-full bg-sub px-3 py-1 text-[11.5px] text-mute transition hover:text-soft"
            >
              {open ? 'закрыть' : 'править'}
            </button>
          ) : null}
        </span>
      </div>

      {open ? (
        <div className="mb-3 rounded-[18px] bg-sub p-4">
          <div className="grid grid-cols-[1fr_1fr_0.6fr_1.6fr_auto] items-end gap-3">
            <label className="block">
              <span className="lab mb-1.5 block">Доход</span>
              <input value={revenue} onChange={(e) => setRevenue(e.target.value)} inputMode="decimal" className={field} />
            </label>
            <label className="block">
              <span className="lab mb-1.5 block">Расход</span>
              <input value={spend} onChange={(e) => setSpend(e.target.value)} inputMode="decimal" className={field} />
            </label>
            <label className="block">
              <span className="lab mb-1.5 block">Комиссия</span>
              <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" className={field} />
            </label>
            <label className="block">
              <span className="lab mb-1.5 block">Комментарий</span>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={`${field} text-left`}
              />
            </label>
            <span className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="h-9 rounded-full bg-sage px-5 text-[12.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
              >
                {pending ? '…' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={pending}
                className="h-9 rounded-full bg-raise px-4 text-[12.5px] text-rust transition hover:opacity-90 disabled:opacity-40"
              >
                Удалить
              </button>
            </span>
          </div>
          <p className="mt-3 text-[11.5px] text-mute">
            С комиссией <span className="n text-soft">{usd(gross)}</span>, профит{' '}
            <span className="n" style={{ color: profit >= 0 ? '#b4c68c' : '#ce6e58' }}>
              {usd(profit, { sign: true })}
            </span>
            {error ? <span className="ml-2 text-rust">{error}</span> : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
