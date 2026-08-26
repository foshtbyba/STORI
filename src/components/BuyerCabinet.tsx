import { usd, rub, profitOf } from '@/lib/money';
import { fmtDay, weekdayShort, periodLabel } from '@/lib/period';
import { Panel, PanelHead, Sub, Empty } from './ui';
import { Meter } from './Charts';
import { IconWallet, IconPeak, IconCalendar, IconBox, IconTag } from './icons';
import type { buyerSummary } from '@/lib/queries';

type Data = NonNullable<Awaited<ReturnType<typeof buyerSummary>>>;

export default function BuyerCabinet({ data }: { data: Data }) {
  const rate = data.period.rubPerUsd;
  const peakCents = data.tiers[data.tiers.length - 1]?.fromCents ?? data.baseCents;
  const scale = Math.max(peakCents, data.baseCents, 1);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-[1.4fr_1fr] gap-3.5">
        <Panel className="flex flex-col p-6">
          <PanelHead
            icon={<IconWallet color="#b4c68c" />}
            tint="bg-sage-t"
            title={`Зарплата за ${periodLabel(data.period.key)}`}
            aside={<span className="text-[15px] text-sage">ставка {data.ratePct}%</span>}
          />
          <div className="mt-4 text-[72px] font-bold leading-none tracking-[-0.035em]">
            <span className="text-[40px] text-mute">$</span>
            {usd(data.salaryCents).replace('$', '')}
          </div>
          <div className="n mt-2.5 text-[13px] text-mute">
            {rub(data.salaryCents, rate)} · {data.ratePct}% с {usd(data.baseCents)} — это профит за вычетом расходников
          </div>

          <div className="flex-1" />
          <div className="relative mt-6 h-2 rounded-full bg-sub">
            <div
              className="absolute left-0 top-0 h-2 rounded-full bg-sage"
              style={{ width: `${Math.min(100, (data.baseCents / scale) * 100)}%` }}
            />
            {data.tiers.map((t) => (
              <span
                key={t.fromCents}
                className="absolute -top-1.5 h-[18px] w-0.5 rounded-sm"
                style={{
                  left: `${Math.min(100, (t.fromCents / scale) * 100)}%`,
                  background: t.ratePct >= 50 ? '#b4c68c' : '#6a6a6a',
                }}
                title={`${usd(t.fromCents)} → ${t.ratePct}%`}
              />
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-mute">
            {data.tiers.map((t) => (
              <span key={t.fromCents} className="n">
                {usd(t.fromCents)} · {t.ratePct}%
              </span>
            ))}
          </div>
        </Panel>

        <Panel className="flex flex-col p-6">
          <PanelHead icon={<IconPeak color="#b4c68c" />} tint="bg-sage-t" title="До следующей ставки" />
          {data.next ? (
            <>
              <div className="mt-4 flex items-baseline gap-3.5">
                <span className="text-[52px] font-bold leading-none tracking-[-0.03em] text-sage">
                  <span className="text-[28px] text-mute">$</span>
                  {usd(data.next.needCents).replace('$', '')}
                </span>
                <span className="text-[14px] text-mute">до {usd(data.next.fromCents)}</span>
              </div>
              <div className="flex-1" />
              <Sub className="px-4.5 py-4 text-[13px] leading-relaxed">
                Ставка вырастет с <span className="n">{data.ratePct}%</span> до{' '}
                <span className="n text-sage">{data.next.ratePct}%</span> и посчитается со всей суммы, а не только с превышения — это{' '}
                <span className="n text-sage">+{usd(data.next.gainCents)}</span> к выплате.
              </Sub>
            </>
          ) : (
            <>
              <div className="mt-4 text-[32px] font-bold leading-tight text-sage">Верхняя ставка взята</div>
              <div className="flex-1" />
              <Sub className="px-4.5 py-4 text-[13px] leading-relaxed">
                Выше порогов нет — дальше растёт только сама сумма, с которой считается процент.
              </Sub>
            </>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-5 gap-3.5">
        {[
          { label: 'Доход', value: usd(data.revenueCents), color: 'text-text', note: periodLabel(data.period.key) },
          { label: 'Спенд с комиссией', value: usd(data.spendGrossCents), color: 'text-text', note: `комиссия ${usd(data.commissionCents)}` },
          { label: 'Профит', value: usd(data.profitCents), color: 'text-sage', note: `ROI ${data.roi.toFixed(1).replace('.', ',')}%` },
          { label: 'Расходники', value: `−${usd(data.consumableCents)}`, color: 'text-rust', note: data.buyer.consumablesAffectSalary ? 'списаны на меня' : 'на команде' },
          { label: 'Дней', value: String(data.days.length), color: 'text-text', note: 'с отчётом' },
        ].map((k) => (
          <Panel key={k.label} className="flex flex-col justify-between p-5">
            <span className="lab">{k.label}</span>
            <span className={`n text-[28px] font-semibold tracking-[-0.03em] ${k.color}`}>{k.value}</span>
            <span className="text-[11.5px] text-mute">{k.note}</span>
          </Panel>
        ))}
      </div>

      <div className="grid grid-cols-[1.9fr_1fr] gap-3.5">
        <Panel className="flex flex-col p-6">
          <PanelHead
            icon={<IconCalendar color="#b4c68c" />}
            tint="bg-sage-t"
            title="Мои дни"
            aside={<span className="n text-[12.5px] text-mute">{periodLabel(data.period.key)}</span>}
            right={
              <span className="rounded-full bg-sage-t px-4 py-1.5">
                <span className="n text-[15px] font-semibold text-sage">
                  {usd(data.profitCents, { sign: true })}
                </span>
              </span>
            }
          />
          <div className="mt-4 grid grid-cols-[0.85fr_1.7fr_repeat(4,1fr)] pb-2.5">
            <span className="lab">День</span>
            <span className="lab">Оффер</span>
            <span className="lab text-right">Доход</span>
            <span className="lab text-right">Спенд</span>
            <span className="lab text-right">Профит</span>
            <span className="lab text-right">ROI</span>
          </div>
          {data.days.length === 0 ? (
            <Empty>Пока ни одного отчёта за период.</Empty>
          ) : (
            data.days.map((d) => {
              const profit = profitOf(d);
              const roi = d.spendGrossCents ? (profit / d.spendGrossCents) * 100 : 0;
              return (
                <div
                  key={d.id}
                  className="grid grid-cols-[0.85fr_1.7fr_repeat(4,1fr)] items-center border-t border-line py-2.5"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="n text-[16px] font-semibold">{fmtDay(d.date)}</span>
                    <span className="text-[11px] text-mute">{weekdayShort(d.date)}</span>
                  </span>
                  <span className="truncate text-[13px] text-soft">{d.offer?.name ?? '—'}</span>
                  <span className="n text-right text-[13.5px] text-soft">{usd(d.revenueCents)}</span>
                  <span className="n text-right text-[13.5px] text-mute">{usd(d.spendGrossCents)}</span>
                  <span
                    className="n text-right text-[17px] font-semibold"
                    style={{ color: profit >= 0 ? '#b4c68c' : '#ce6e58' }}
                  >
                    {usd(profit, { sign: true })}
                  </span>
                  <span
                    className="n text-right text-[12.5px]"
                    style={{ color: roi >= 20 ? '#b4c68c' : '#ce6e58' }}
                  >
                    {roi.toFixed(0)}%
                  </span>
                </div>
              );
            })
          )}
        </Panel>

        <div className="flex flex-col gap-3.5">
          <Panel className="flex-1 p-5">
            <div className="mb-3.5 flex items-center justify-between">
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rust-t">
                  <IconBox color="#ce6e58" size={17} />
                </span>
                <span className="text-[15.5px] font-semibold">Мои расходники</span>
              </span>
              <span className="n text-[17px] font-semibold text-rust">{usd(data.consumableCents)}</span>
            </div>
            {data.consumables.length === 0 ? (
              <Empty>Ничего не списано.</Empty>
            ) : (
              data.consumables.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between border-t border-line py-2.5">
                  <span>
                    <span className="block text-[13px]">{c.type.name}</span>
                    <span className="block text-[11px] text-mute">
                      {fmtDay(c.date)} · {c.qty} шт{c.note ? ` · ${c.note}` : ''}
                    </span>
                  </span>
                  <span className="n text-[13.5px]">{usd(c.totalCents)}</span>
                </div>
              ))
            )}
          </Panel>

          <Panel className="p-5">
            <div className="mb-3 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage-t">
                <IconTag color="#b4c68c" size={17} />
              </span>
              <span className="text-[15.5px] font-semibold">Мои офферы</span>
            </div>
            {(() => {
              const byOffer = new Map<string, { name: string; cents: number }>();
              for (const d of data.days) {
                const name = d.offer?.name ?? 'Без оффера';
                const row = byOffer.get(name) ?? { name, cents: 0 };
                row.cents += profitOf(d);
                byOffer.set(name, row);
              }
              const rows = [...byOffer.values()].sort((a, b) => b.cents - a.cents);
              const max = Math.max(1, ...rows.map((r) => Math.abs(r.cents)));
              return rows.length === 0 ? (
                <Empty>Нет данных.</Empty>
              ) : (
                rows.map((r) => (
                  <div key={r.name} className="flex items-center gap-3 border-t border-line py-2.5">
                    <span className="w-[120px] shrink-0 truncate text-[13px]">{r.name}</span>
                    <Meter value={Math.abs(r.cents)} max={max} color={r.cents >= 0 ? '#b4c68c' : '#ce6e58'} />
                    <span
                      className="n w-16 text-right text-[13px]"
                      style={{ color: r.cents >= 0 ? '#b4c68c' : '#ce6e58' }}
                    >
                      {usd(r.cents, { sign: true })}
                    </span>
                  </div>
                ))
              );
            })()}
          </Panel>
        </div>
      </div>
    </div>
  );
}
