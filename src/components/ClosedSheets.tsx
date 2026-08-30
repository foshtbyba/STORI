'use client';

import { useState } from 'react';
import { Panel, Badge, Empty } from './ui';
import { IconCalendar } from './icons';

export type SheetRow = {
  key: string;
  title: string;
  closedLabel: string | null;
  /** Курс на момент закрытия, в сотых (8400 = 84 ₽/$). */
  rate: number;
  payoutCents: number;
  salaryCents: number;
  bonusCents: number;
  people: number;
  /** YYYY-MM недели листа. */
  month: string;
  monthLabel: string;
};

const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('ru-RU')}`;
const rub = (c: number, rate: number) =>
  `${Math.round((c / 100) * (rate / 100)).toLocaleString('ru-RU')} ₽`;

const GRID = 'grid grid-cols-[1.3fr_1fr] lg:grid-cols-[1.5fr_0.7fr_repeat(3,1fr)_1fr]';

/**
 * Закрытые расчётные листы: сворачиваемое окно с выбором месяца. В месяце —
 * четыре-пять недельных листов; календарём выбираешь, за какой смотреть.
 * Отдельный столбец — курс на момент закрытия (в архиве он не пересчитывается).
 */
export default function ClosedSheets({
  sheets,
  team,
  months,
}: {
  sheets: SheetRow[];
  team: boolean;
  months: { value: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState('');

  const shown = month ? sheets.filter((s) => s.month === month) : sheets;

  return (
    <Panel className="p-4 sm:p-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-y-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2.5 sm:gap-[13px]">
          <Badge tint="bg-sage-t"><IconCalendar color="#b4c68c" /></Badge>
          <span className="text-[17px] font-semibold tracking-[-0.015em]">Закрытые листы</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-[12.5px] text-mute">
            {team ? 'сколько ушло команде' : 'сколько ты получил'}
          </span>
          <span className="text-[12px] text-dim">{open ? 'свернуть' : 'развернуть'}</span>
        </span>
      </button>

      {open ? (
        <div className="mt-5">
          {months.length > 0 ? (
            <div className="mb-3 flex items-center gap-2.5">
              <span className="lab">Месяц</span>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="n h-9 rounded-lg border border-line bg-sub px-3 text-[13px] text-soft outline-none transition focus:border-sage [color-scheme:dark]"
              >
                <option value="">все</option>
                {months.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          {shown.length === 0 ? (
            <Empty>За выбранный месяц закрытых листов нет.</Empty>
          ) : (
            <>
              <div className={`${GRID} pb-2.5`}>
                <span className="lab">Период</span>
                <span className="lab hidden text-right lg:block">Курс</span>
                <span className="lab hidden text-right lg:block">Оклад и процент</span>
                <span className="lab hidden text-right lg:block">Бонусы</span>
                <span className="lab hidden text-right lg:block">В рублях</span>
                <span className="lab text-right">К выплате</span>
              </div>
              {shown.map((s) => (
                <a
                  key={s.key}
                  href={`/payroll?p=${s.key}`}
                  className={`${GRID} items-center border-t border-line py-3 transition hover:bg-sub`}
                >
                  <span>
                    <span className="block text-[14px] font-semibold">{s.title}</span>
                    <span className="block text-[11.5px] text-mute">
                      {s.closedLabel ? `закрыт ${s.closedLabel}` : 'закрыт'}
                      {team ? ` · ${s.people} чел.` : ''}
                    </span>
                  </span>
                  <span className="n hidden text-right text-[13px] text-mute lg:block">
                    {(s.rate / 100).toFixed(0)} ₽/$
                  </span>
                  <span className="n hidden text-right text-[13.5px] text-soft lg:block">{usd(s.salaryCents)}</span>
                  <span
                    className="n hidden text-right text-[13.5px] lg:block"
                    style={{ color: s.bonusCents ? '#b4c68c' : '#8a8a8a' }}
                  >
                    {s.bonusCents ? `+${usd(s.bonusCents)}` : '—'}
                  </span>
                  <span className="n hidden text-right text-[13px] text-mute lg:block">{rub(s.payoutCents, s.rate)}</span>
                  <span className="n text-right text-[17px] font-semibold">{usd(s.payoutCents)}</span>
                </a>
              ))}
            </>
          )}
          <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
            Курс у каждого листа свой — тот, что стоял в момент закрытия. Поэтому рубли в архиве
            не пересчитываются задним числом.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}
