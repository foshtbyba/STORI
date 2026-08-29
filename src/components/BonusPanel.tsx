'use client';

import { useState } from 'react';
import SubmitButton from './SubmitButton';
import { usd, rub } from '@/lib/money';
import { addBonus, deleteBonus } from '@/app/actions/bonus';
import { Panel, PanelHead, Avatar, Empty } from './ui';
import Select from './Select';
import { IconWallet } from './icons';

export type BonusRow = {
  id: string;
  buyer: { initials: string; color: string; handle: string };
  amountCents: number;
  note: string;
  day: string;
};

/** Кандидат на разовый бонус «за первые $5 000». */
export type FirstHit = { handle: string; day: string; awarded: boolean } | null;

const PRESET_RUB = 200_000;

/**
 * Разовые бонусы за период: начисление и список. Суммы вводятся в рублях —
 * так о них и договариваются, — а хранятся в долларах по курсу периода.
 */
export default function BonusPanel({
  periodKey,
  rate,
  buyers,
  bonuses,
  firstHit,
  threshold,
  closed,
}: {
  periodKey: string;
  rate: number;
  buyers: { id: string; handle: string }[];
  bonuses: BonusRow[];
  firstHit: FirstHit;
  threshold: number;
  closed: boolean;
}) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [currency, setCurrency] = useState('RUB');
  const [buyerId, setBuyerId] = useState(buyers[0]?.id ?? '');

  const field = 'h-11 w-full rounded-xl border border-line bg-sub px-3.5 text-[14px] outline-none';
  const typed = Number.parseFloat(amount.replace(/\s/g, '').replace(',', '.')) || 0;
  const preview =
    currency === 'RUB'
      ? `≈ ${usd(Math.round((typed * 100 * 100) / rate))}`
      : rub(Math.round(typed * 100), rate);

  function fillPreset() {
    const winner = buyers.find((b) => b.handle === firstHit?.handle);
    if (winner) setBuyerId(winner.id);
    setCurrency('RUB');
    setAmount(String(PRESET_RUB));
    setNote(`первые ${usd(threshold)}`);
  }

  return (
    <Panel className="p-4 sm:p-6">
      <PanelHead
        icon={<IconWallet color="#b4c68c" />}
        tint="bg-sage-t"
        title="Разовые бонусы"
        aside={<span className="text-[12.5px] text-mute">сверх процента и оклада</span>}
        right={
          <span className="n text-[15px] font-semibold text-sage">
            {usd(bonuses.reduce((a, b) => a + b.amountCents, 0))}
          </span>
        }
      />

      {firstHit ? (
        <div className="mt-4 flex items-center gap-3 rounded-[18px] bg-sub px-4 py-3">
          <span className="text-[12.5px] text-soft">
            Первым закрыл {usd(threshold)} — <span className="font-semibold">{firstHit.handle}</span>,{' '}
            {firstHit.day}.
          </span>
          {firstHit.awarded ? (
            <span className="ml-auto text-[12px] text-sage">бонус уже начислен</span>
          ) : (
            <button
              type="button"
              onClick={fillPreset}
              disabled={closed}
              className="ml-auto rounded-full bg-sage px-4 py-1.5 text-[12px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
            >
              Начислить {PRESET_RUB.toLocaleString('ru-RU')} ₽
            </button>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-mute">
          Отметку {usd(threshold)} в этом периоде ещё никто не закрыл.
        </p>
      )}

      {closed ? (
        <p className="mt-4 text-[12px] text-mute">Период закрыт — начисления заблокированы.</p>
      ) : (
        <form action={addBonus} className="mt-4 grid grid-cols-2 items-end gap-2.5 sm:gap-3 lg:grid-cols-[1.1fr_1fr_0.8fr_1.6fr_auto]">
          <input type="hidden" name="periodKey" value={periodKey} />
          <Select
            name="buyerId"
            value={buyerId}
            onChange={setBuyerId}
            options={buyers.map((b) => ({ value: b.id, label: b.handle }))}
          />
          <input
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="сумма"
            required
            className={`n ${field}`}
          />
          <Select
            name="currency"
            value={currency}
            onChange={setCurrency}
            options={[
              { value: 'RUB', label: '₽' },
              { value: 'USD', label: '$' },
            ]}
          />
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="за что"
            className={field}
          />
          {/* Гаснет на время отправки: иначе второй клик начисляет бонус дважды. */}
          <SubmitButton
            pendingLabel="Начисляю…"
            className="h-11 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg transition hover:opacity-90"
          >
            Начислить
          </SubmitButton>
        </form>
      )}

      {typed > 0 && !closed ? (
        <p className="n mt-2 text-[11.5px] text-mute">{preview} по курсу периода</p>
      ) : null}

      <div className="mt-4">
        {bonuses.length === 0 ? (
          <Empty>В этом периоде бонусов нет.</Empty>
        ) : (
          bonuses.map((b) => (
            <div
              key={b.id}
              className="grid grid-cols-[1.2fr_1fr_1fr_auto] items-center gap-2.5 border-t border-line py-2.5 md:grid-cols-[1.2fr_1fr_1fr_2fr_auto] md:gap-3"
            >
              <span className="flex items-center gap-2.5">
                <Avatar initials={b.buyer.initials} color={b.buyer.color} size={26} />
                <span className="text-[13px]">{b.buyer.handle}</span>
              </span>
              <span className="n text-[14px] font-semibold text-sage">+{usd(b.amountCents)}</span>
              <span className="n text-[12.5px] text-mute">{rub(b.amountCents, rate)}</span>
              <span className="hidden truncate text-[12.5px] text-mute md:block">{b.note || '—'}</span>
              {closed ? (
                <span />
              ) : (
                <form action={deleteBonus}>
                  <input type="hidden" name="id" value={b.id} />
                  <button type="submit" className="text-[11px] text-dim transition hover:text-rust">
                    ✕
                  </button>
                </form>
              )}
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
