'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usd } from '@/lib/money';
import { markToppedUp, undoTopUp } from '@/app/actions/days';
import { Panel, PanelHead, Avatar, Empty } from './ui';
import { IconWallet } from './icons';

export type TopUpRow = {
  buyerId: string;
  handle: string;
  initials: string;
  color: string;
  /** Расход с комиссией за выбранный день, ещё не закинутый. */
  todayCents: number;
  /** Незакинутое с прошлых дней. */
  debtCents: number;
  /** Дни до этой даты включительно, уже отмеченные закинутыми. */
  settledCents: number;
};

/**
 * Сколько нужно закинуть на кабинеты. «Закинул» гасит долг по эту дату и
 * следующий отчёт начнётся с чистого листа; «закину потом» — ничего не
 * трогаем, и завтрашняя сумма приедет вместе с сегодняшней.
 */
export default function TopUps({ date, rows }: { date: string; rows: TopUpRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const due = rows.filter((r) => r.todayCents + r.debtCents > 0);
  const total = due.reduce((a, r) => a + r.todayCents + r.debtCents, 0);
  const debtTotal = due.reduce((a, r) => a + r.debtCents, 0);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, key: string) {
    setError(null);
    setBusy(key);
    start(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) return setError(res.error ?? 'Не вышло.');
      router.refresh();
    });
  }

  return (
    <Panel className="p-4 sm:p-6">
      <PanelHead
        icon={<IconWallet color="#d2a06a" />}
        tint="bg-amber-t"
        title="К закиду на кабинеты"
        aside={
          <span className="text-[12.5px] text-mute">
            расход с комиссией — столько ушло с балансов
          </span>
        }
        right={
          <span className="n text-[17px] font-semibold" style={{ color: total ? '#d2a06a' : '#8a8a8a' }}>
            {usd(total)}
          </span>
        }
      />

      {debtTotal > 0 ? (
        <p className="mt-3 text-[12px] text-rust">
          Из них {usd(debtTotal)} — долг с прошлых дней.
        </p>
      ) : null}

      {/* Шире телефона — прокручиваем таблицу, а не страницу. */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
      <div className="mt-4 grid min-w-[600px] grid-cols-[1.4fr_1fr_1fr_1fr_190px] gap-3 pb-2.5">
        <span className="lab">Баер</span>
        <span className="lab text-right">За день</span>
        <span className="lab text-right">Долг</span>
        <span className="lab text-right">Итого</span>
        <span className="lab text-right">Решение</span>
      </div>

      {rows.length === 0 ? (
        <Empty>За этот день расходов нет.</Empty>
      ) : (
        rows.map((r) => {
          const owed = r.todayCents + r.debtCents;
          return (
            <div
              key={r.buyerId}
              className="grid min-w-[600px] grid-cols-[1.4fr_1fr_1fr_1fr_190px] items-center gap-3 border-t border-line py-2.5"
            >
              <span className="flex items-center gap-2.5">
                <Avatar initials={r.initials} color={r.color} size={28} />
                <span className="text-[13.5px] font-semibold">{r.handle}</span>
              </span>
              <span className="n text-right text-[13.5px] text-soft">
                {r.todayCents ? usd(r.todayCents) : '—'}
              </span>
              <span className="n text-right text-[13.5px]" style={{ color: r.debtCents ? '#ce6e58' : '#5b5b5d' }}>
                {r.debtCents ? usd(r.debtCents) : '—'}
              </span>
              <span
                className="n text-right text-[17px] font-semibold"
                style={{ color: owed ? '#d2a06a' : '#8a8a8a' }}
              >
                {owed ? usd(owed) : usd(0)}
              </span>
              <span className="flex items-center justify-end gap-2.5">
                {owed > 0 ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => markToppedUp(r.buyerId, date), r.buyerId)}
                    className="rounded-full bg-sage px-4 py-1.5 text-[12px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
                  >
                    {busy === r.buyerId ? 'Отмечаю…' : 'Закинул'}
                  </button>
                ) : (
                  <>
                    <span className="text-[12px] text-sage">закинуто</span>
                    {r.settledCents > 0 ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => undoTopUp(r.buyerId, date), `u-${r.buyerId}`)}
                        className="rounded-full bg-sub px-3.5 py-1.5 text-[11.5px] text-mute transition hover:text-soft disabled:opacity-40"
                      >
                        отменить
                      </button>
                    ) : null}
                  </>
                )}
              </span>
            </div>
          );
        })
      )}
      </div>

      <p className="mt-4 text-[11.5px] leading-relaxed text-mute">
        Нажал «закинул» — долг закрыт, и завтрашний отчёт покажет только новую сумму. Оставил как
        есть — незакинутое приплюсуется к следующему дню.
        {error ? <span className="ml-2 text-rust">{error}</span> : null}
      </p>
    </Panel>
  );
}
