'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { grossUp, usd } from '@/lib/money';
import { AGENCY_COMMISSION_BPS } from '@/lib/extra-spend';
import { saveExtraSpend } from '@/app/actions/days';
import { Panel, PanelHead, Avatar } from './ui';
import { IconTag } from './icons';

export type ExtraBuyer = { id: string; handle: string; initials: string; color: string; owner?: boolean };
export type ExtraSeed = { buyerId: string; spend: string; note: string };

const toCents = (v: string) => {
  const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const PCT = (AGENCY_COMMISSION_BPS / 100).toString().replace('.', ',');

/**
 * Доп. расходы за день — агентские кабинеты.
 *
 * Отдельная таблица, а не колонка в отчёте дня: этот расход не приезжает из
 * Brocard и считается по своей комиссии (6% и больше ничего). Смешивать его с
 * основной строкой нельзя — там комиссия платёжки, и одна цифра не может
 * жить сразу по двум ставкам.
 *
 * Пустые строки не сохраняются, а стёртая сумма удаляет прежнюю запись: иначе
 * ошибочно вбитая агентка осталась бы висеть в профите навсегда.
 */
export default function ExtraSpend({
  date,
  buyers,
  seed,
  locked,
}: {
  date: string;
  buyers: ExtraBuyer[];
  seed: ExtraSeed[];
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(seed.map((s) => [s.buyerId, s]));
  const ownerSet = new Set(buyers.filter((b) => b.owner).map((b) => b.id));
  const [rows, setRows] = useState<ExtraSeed[]>(() =>
    buyers.map((b) => byId.get(b.id) ?? { buyerId: b.id, spend: '', note: '' }),
  );

  function patch(buyerId: string, field: keyof ExtraSeed, value: string) {
    setRows((prev) => prev.map((r) => (r.buyerId === buyerId ? { ...r, [field]: value } : r)));
    setNote(null);
  }

  const calc = useMemo(
    () =>
      rows.map((r) => {
        const spendNetCents = toCents(r.spend);
        return {
          ...r,
          spendNetCents,
          spendGrossCents: grossUp(spendNetCents, AGENCY_COMMISSION_BPS),
          touched: spendNetCents > 0,
        };
      }),
    [rows],
  );

  // Овнеры считаются отдельным листом — в командное «Итого» их агентка не идёт.
  const totals = calc.reduce(
    (acc, r) => {
      if (ownerSet.has(r.buyerId)) return { ...acc, filled: acc.filled + (r.touched ? 1 : 0) };
      return {
        net: acc.net + r.spendNetCents,
        gross: acc.gross + r.spendGrossCents,
        filled: acc.filled + (r.touched ? 1 : 0),
      };
    },
    { net: 0, gross: 0, filled: 0 },
  );

  // Сохраняем и пустые строки тоже: так стёртая сумма доедет до сервера и
  // удалит прежнюю запись. Кнопка при этом гаснет, только если сохранять
  // действительно нечего и раньше ничего не было.
  const hadSaved = seed.some((s) => toCents(s.spend) > 0);

  function submit() {
    setError(null);
    setNote(null);
    start(async () => {
      const res = await saveExtraSpend(
        date,
        calc.map((r) => ({
          buyerId: r.buyerId,
          spendNetCents: r.spendNetCents,
          note: r.note.slice(0, 200),
        })),
      );
      if (!res.ok) return setError(res.error);
      setNote(`Записано строк: ${res.saved ?? 0}.`);
      router.refresh();
    });
  }

  const cell =
    'n h-10 w-full rounded-lg border border-line bg-sub px-3 text-right text-[13.5px] outline-none transition focus:border-sage';
  const cols = 'grid min-w-[620px] grid-cols-[1.4fr_1fr_1fr_1.8fr] items-center gap-2.5';

  return (
    <Panel className="flex flex-col p-4 sm:p-6">
      <PanelHead
        icon={<IconTag color="#d2a06a" />}
        tint="bg-amber-t"
        title="Доп. расходы"
        aside={
          <span className="text-[12.5px] text-mute">
            агентские · комиссия {PCT}%, других нет
          </span>
        }
        right={
          <button
            type="button"
            onClick={submit}
            disabled={pending || locked || (totals.filled === 0 && !hadSaved)}
            className="h-11 shrink-0 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
          >
            {pending ? 'Сохраняем…' : `Сохранить · ${totals.filled}`}
          </button>
        }
      />

      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
        Сюда вбиваем то, что не приезжает из Brocard: пополнения агентских кабинетов. Синхронизация
        эти строки не трогает — они целиком ручные. В профит, ROI и зарплату попадают наравне с
        обычным расходом, только комиссия у них своя: {PCT}%, и больше никаких сверху.
      </p>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className={`${cols} mt-4 pb-2.5`}>
          <span className="lab">Баер</span>
          <span className="lab text-right">Расход</span>
          <span className="lab text-right">С комиссией</span>
          <span className="lab">Комментарий</span>
        </div>

        {calc.map((r) => {
          const buyer = buyers.find((b) => b.id === r.buyerId)!;
          return (
            <div key={r.buyerId} className={`${cols} border-t border-line py-2.5`}>
              <span className="flex items-center gap-2.5">
                <Avatar initials={buyer.initials} color={buyer.color} size={28} />
                <span className="text-[13.5px] font-semibold">{buyer.handle}</span>
                {buyer.owner ? (
                  <span className="rounded-full bg-sage-t px-2 py-0.5 text-[10px] text-sage">овнер</span>
                ) : null}
              </span>
              <input
                value={r.spend}
                onChange={(e) => patch(r.buyerId, 'spend', e.target.value)}
                inputMode="decimal"
                placeholder="0"
                disabled={locked}
                className={cell}
              />
              <span className="n text-right text-[13.5px] text-amber">
                {r.touched ? usd(r.spendGrossCents) : '—'}
              </span>
              <input
                value={r.note}
                onChange={(e) => patch(r.buyerId, 'note', e.target.value)}
                placeholder="какой кабинет"
                disabled={locked}
                className={`${cell} text-left`}
              />
            </div>
          );
        })}

        <div className={`${cols} mt-2.5 rounded-[18px] bg-sub px-4 py-3.5`}>
          <span className="lab text-text">Итого</span>
          <span className="n text-right text-[13.5px] text-mid">{usd(totals.net)}</span>
          <span className="n text-right text-[16px] font-semibold text-amber">
            {usd(totals.gross)}
          </span>
          <span className="text-[11.5px] text-mute">
            комиссия {usd(totals.gross - totals.net)}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="text-[12px] text-mute">
          {locked
            ? 'Неделя закрыта для правок — только чтение.'
            : 'Стёртая сумма удаляет строку. В отчётах она видна источником «Агентка».'}
        </span>
        {note ? <span className="text-[12.5px] text-sage">{note}</span> : null}
        {error ? <span className="text-[12.5px] text-rust">{error}</span> : null}
      </div>
    </Panel>
  );
}
