'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { usd, grossUp } from '@/lib/money';
import { AGENCY_SOURCE } from '@/lib/extra-spend';
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
  /**
   * Агентка за тот же день того же баера. Это отдельная запись со своей
   * комиссией, но в отчёте она не самостоятельный день, а приписка к расходу:
   * иначе строка «−$165 без дохода» читалась бы как убыточный день.
   */
  extra?: {
    id: string;
    spendNetCents: number;
    spendGrossCents: number;
    commissionBps: number;
    note: string;
  };
};

/**
 * На телефоне в строку влезает только главное: день, баер, профит и правка.
 * Источник и разложение спенда прячем — они есть на широком экране и в правке.
 */
const GRID =
  'grid grid-cols-[0.8fr_1.1fr_1fr_92px] items-center md:grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)_92px]';

/**
 * Строка отчёта за день. Админ правит её на месте: раскрывается три поля,
 * расход с комиссией пересчитывается на лету. Уходить на отдельный экран ради
 * исправленной цифры незачем.
 */
const num = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

export default function DayRow({ row, canEdit }: { row: DayRowData; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [revenue, setRevenue] = useState(num(row.revenueCents));
  const [spend, setSpend] = useState(num(row.spendNetCents));
  const [pct, setPct] = useState((row.commissionBps / 100).toString());
  const [note, setNote] = useState(row.note);
  const [extraSpend, setExtraSpend] = useState(row.extra ? num(row.extra.spendNetCents) : '');
  const [extraNote, setExtraNote] = useState(row.extra?.note ?? '');

  const toCents = (v: string) => {
    const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };
  const bps = Math.round((Number.parseFloat(pct.replace(',', '.')) || 0) * 100);
  const gross = grossUp(toCents(spend), bps);
  // В правке считаем сразу с агенткой — иначе профит под полями расходится с
  // тем, что показано в самой строке.
  const extraGross = row.extra ? grossUp(toCents(extraSpend), row.extra.commissionBps) : 0;
  const profit = toCents(revenue) - gross - extraGross;

  // Итоги строки: расход и профит дня — это ФБ плюс агентка.
  const netTotal = row.spendNetCents + (row.extra?.spendNetCents ?? 0);
  const grossTotal = row.spendGrossCents + (row.extra?.spendGrossCents ?? 0);
  const profitTotal = row.revenueCents - grossTotal;

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

  // Агентка правится тут же, но своей кнопкой: это отдельная запись, и
  // сохранять её вместе с основной строкой значило бы переписывать обе разом
  // даже когда трогали одну.
  function saveExtra() {
    if (!row.extra) return;
    setError(null);
    start(async () => {
      const cents = toCents(extraSpend);
      const res = cents > 0
        ? await updateDay({
            id: row.extra!.id,
            revenueCents: 0,
            spendNetCents: cents,
            commissionBps: row.extra!.commissionBps,
            note: extraNote,
          })
        : // Стёрли сумму — записи больше нет, как и в таблице ввода.
          await deleteDay(row.extra!.id);
      if (!res.ok) return setError(res.error);
      setOpen(false);
      router.refresh();
    });
  }

  const [armed, setArmed] = useState(false);
  function remove() {
    // Удаление в два клика: первый взводит «точно?», второй удаляет.
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3000);
      return;
    }
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
        {/* Агентка своей строкой не идёт — она приписана к дню. Помечаем день,
            чтобы было видно: часть расхода тут ручная и со своей ставкой. */}
        <span className="hidden min-w-0 items-center gap-2 text-[13px] text-soft md:flex">
          <span className="truncate">{row.source}</span>
          {row.extra || row.source === AGENCY_SOURCE ? (
            <span className="shrink-0 rounded-full bg-amber-t px-2 py-0.5 text-[10px] text-amber">
              {row.extra ? '+ агентка' : 'руками'}
            </span>
          ) : null}
        </span>
        <span className="n hidden text-right text-[13.5px] text-soft md:block">{usd(row.revenueCents)}</span>
        {/* Расход дня — ФБ плюс агентка. Агентку дописываем справа, а не прячем
            в сумму: ставки у них разные, и человек должен видеть, из чего
            сложилась цифра. */}
        <span className="n hidden text-right text-[13.5px] text-mute md:block">
          {usd(row.spendNetCents)}
          {row.extra ? (
            <span className="ml-1.5 text-[11.5px] text-amber">+{usd(row.extra.spendNetCents)}</span>
          ) : null}
        </span>
        <span
          className="n hidden text-right text-[13.5px] text-mute md:block"
          title={
            row.extra
              ? `Facebook ${usd(row.spendGrossCents)} (${(row.commissionBps / 100).toFixed(2)}%) + агентка ${usd(row.extra.spendGrossCents)} (${(row.extra.commissionBps / 100).toFixed(2)}%)`
              : undefined
          }
        >
          {usd(grossTotal)}
          <span className="ml-1.5 text-[11px] text-dim">
            {(row.commissionBps / 100).toFixed(2)}%
            {row.extra ? ` +${(row.extra.commissionBps / 100).toFixed(2)}%` : ''}
          </span>
        </span>
        <span
          className="n text-right text-[17px] font-semibold"
          style={{ color: profitTotal >= 0 ? '#b4c68c' : '#ce6e58' }}
        >
          {usd(profitTotal, { sign: true })}
        </span>
        <span className="pl-2 md:pl-3">
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
          <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[1fr_1fr_0.6fr_1.6fr_auto]">
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
                className={`h-9 rounded-full px-4 text-[12.5px] transition hover:opacity-90 disabled:opacity-40 ${
                  armed ? 'bg-rust font-semibold text-bg' : 'bg-raise text-rust'
                }`}
              >
                {armed ? 'точно?' : 'Удалить'}
              </button>
            </span>
          </div>
          {row.extra ? (
            <div className="mt-3 border-t border-line pt-3">
              <div className="grid grid-cols-2 items-end gap-3 md:grid-cols-[1fr_0.6fr_1.6fr_auto]">
                <label className="block">
                  <span className="lab mb-1.5 block text-amber">Агентка</span>
                  <input
                    value={extraSpend}
                    onChange={(e) => setExtraSpend(e.target.value)}
                    inputMode="decimal"
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className="lab mb-1.5 block">Комиссия</span>
                  <input
                    value={(row.extra.commissionBps / 100).toFixed(2)}
                    readOnly
                    className={`${field} text-dim`}
                    title="У агентки ставка своя и правкой дня не меняется"
                  />
                </label>
                <label className="block">
                  <span className="lab mb-1.5 block">Какой кабинет</span>
                  <input
                    value={extraNote}
                    onChange={(e) => setExtraNote(e.target.value)}
                    className={`${field} text-left`}
                  />
                </label>
                <button
                  type="button"
                  onClick={saveExtra}
                  disabled={pending}
                  className="h-9 rounded-full bg-raise px-5 text-[12.5px] text-amber transition hover:opacity-90 disabled:opacity-40"
                >
                  {pending ? '…' : 'Сохранить агентку'}
                </button>
              </div>
              <p className="mt-2 text-[11px] text-dim">
                С комиссией <span className="n">{usd(extraGross)}</span>. Стёртая сумма удалит
                агентку за этот день.
              </p>
            </div>
          ) : null}

          <p className="mt-3 text-[11.5px] text-mute">
            С комиссией <span className="n text-soft">{usd(gross + extraGross)}</span>, профит{' '}
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
