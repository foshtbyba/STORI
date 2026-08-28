import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary, buyerSummary, allTimeProfit } from '@/lib/queries';
import { usd, rub, sum, profitOf } from '@/lib/money';
import { periodRange, periodTitle, daysOfRange, dayKey } from '@/lib/period';
import { Panel, PanelHead, Sub, Avatar, Empty } from '@/components/ui';
import { ProfitBars, Meter } from '@/components/Charts';
import { IconChart, IconWallet, IconBox, IconWarn, IconUsers } from '@/components/icons';
import BuyerCabinet from '@/components/BuyerCabinet';

export default async function HomePage() {
  const user = await requireUser();
  // Расчётный период — неделя: и статистика, и зарплата считаются за неё.
  const key = await currentPeriodKey();
  const week = periodRange(key);
  const label = periodTitle(key);

  if (!canSeeTeam(user.role as Role)) {
    if (!user.buyer) return <Empty>У аккаунта нет профиля баера — попроси админа его создать.</Empty>;
    const data = await buyerSummary(user.buyer.id, key, week);
    if (!data) return <Empty>Нет данных за {label}.</Empty>;
    return <BuyerCabinet data={data} label={label} />;
  }

  const summary = await teamSummary(key, week);
  const allTime = await allTimeProfit();
  const allTimeTotal = [...allTime.values()].reduce((a, b) => a + b, 0);
  const series = daysOfRange(week).map((date) => {
    const byDay = summary.days.filter((d) => dayKey(d.date) === dayKey(date));
    return { date, profitCents: sum(byDay, (d) => profitOf(d)) };
  });
  const rate = summary.period.rubPerUsd;
  const best = series.reduce((a, b) => (b.profitCents > a.profitCents ? b : a), series[0]);
  const positiveDays = series.filter((d) => d.profitCents > 0).length;

  const byType = new Map<string, { name: string; color: string; cents: number }>();
  for (const c of summary.consumables) {
    const row = byType.get(c.typeId) ?? { name: c.type.name, color: c.type.color, cents: 0 };
    row.cents += c.totalCents;
    byType.set(c.typeId, row);
  }
  const consumables = [...byType.values()].sort((a, b) => b.cents - a.cents);
  const worstConsumable = consumables[0]?.cents ?? 1;

  const alerts: { color: string; text: string }[] = [];
  for (const row of summary.buyers) {
    if (row.days === 0) alerts.push({ color: '#ce6e58', text: `${row.buyer.handle} — ни одного отчёта за период` });
    else if (row.profitCents < 0) alerts.push({ color: '#ce6e58', text: `${row.buyer.handle} — период в минусе` });
  }
  const leader = summary.buyers[0];
  if (leader && leader.ratePct >= 50) {
    alerts.push({ color: '#b4c68c', text: `${leader.buyer.handle} закрыл верхний порог ставки` });
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.55fr_1fr] lg:gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconChart color="#b4c68c" />}
            tint="bg-sage-t"
            title="Чистый профит"
            aside={<span className="text-[15px] text-sage">{label}</span>}
          />
          {/* Чистый — уже за вычетом расходников: они списываются с профита,
              и показывать их отдельной строкой значит вводить в заблуждение. */}
          <div className="mt-4 text-[76px] font-bold leading-none tracking-[-0.035em]">
            <span className="text-[42px] text-mute">$</span>
            {usd(summary.totals.netCents).replace('$', '')}
          </div>
          <div className="n mt-2.5 text-[12.5px] text-mute">
            {rub(summary.totals.netCents, rate)} ·{' '}
            <span title="Рыночный курс минус 2 ₽ — закладываем комиссию за перевод">
              курс {(rate / 100).toFixed(0)} ₽/$
            </span>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
            {[
              { label: 'Оборот', value: usd(summary.totals.revenueCents), color: 'text-text' },
              { label: 'Расход с комиссией', value: usd(summary.totals.spendGrossCents), color: 'text-text' },
              { label: 'Профит с рекламы', value: usd(summary.totals.profitCents), color: 'text-text' },
              { label: 'Расходники', value: `−${usd(summary.totals.consumableCents)}`, color: 'text-rust' },
              { label: 'ROI', value: `${summary.totals.roi.toFixed(1).replace('.', ',')}%`, color: 'text-sage' },
            ].map((s) => (
              <Sub key={s.label} className="px-4 py-3.5">
                <div className="text-[11.5px] text-mute">{s.label}</div>
                <div className={`n mt-2 text-[19px] font-semibold ${s.color}`}>{s.value}</div>
              </Sub>
            ))}
          </div>
        </Panel>

        <Panel className="flex flex-col p-4 sm:p-6">
          <PanelHead icon={<IconWallet color="#b4c68c" />} tint="bg-sage-t" title="Остаётся команде" />
          <div className="mt-4 text-[46px] font-bold leading-none tracking-[-0.03em]">
            <span className="text-[26px] text-mute">$</span>
            {usd(summary.totals.teamNetCents).replace('$', '')}
          </div>
          <div className="flex-1" />
          {[
            { name: 'Расходники', cents: summary.totals.consumableCents },
            { name: 'Зарплата баеров', cents: summary.totals.payoutCents },
            { name: 'Комиссия за пополнения', cents: summary.totals.commissionCents },
          ].map((row) => (
            <div key={row.name} className="flex items-center justify-between border-t border-line py-2.5">
              <span className="text-[13px] text-soft">{row.name}</span>
              <span className="n text-[13.5px] text-rust">− {usd(row.cents)}</span>
            </div>
          ))}
        </Panel>
      </div>

      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Профит по дням"
          aside={
            <span className="text-[12.5px] text-mute">
              {label} · в плюсе {positiveDays} из {series.length}
            </span>
          }
          right={
            <span className="rounded-full bg-sub px-3.5 py-1.5">
              <span className="n text-[12.5px] text-soft">
                пик {String(best.date.getUTCDate()).padStart(2, '0')}.
                {String(best.date.getUTCMonth() + 1).padStart(2, '0')} · {usd(best.profitCents)}
              </span>
            </span>
          }
        />
        <div className="mt-5">
          <ProfitBars data={series} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.85fr_1fr] lg:gap-3.5">
        <Panel className="flex flex-col p-4 sm:p-6">
          <PanelHead
            icon={<IconUsers color="#b4c68c" />}
            tint="bg-sage-t"
            title="Баеры"
            aside={<span className="text-[12.5px] text-mute">{summary.buyers.length} человек</span>}
          />
          <div className="mt-4 grid grid-cols-[1.3fr_1fr_1fr] md:grid-cols-[1.6fr_repeat(5,1fr)_1.05fr] pb-2.5">
            <span className="lab">Баер</span>
            <span className="lab hidden text-right md:block">Доход</span>
            <span className="lab hidden text-right md:block">Спенд</span>
            <span className="lab hidden text-right md:block">С комиссией</span>
            <span className="lab text-right">Профит</span>
            <span className="lab pl-5 text-right" title="Чистый профит по всем отчётам, за все периоды">
              За всё время
            </span>
            <span className="lab hidden text-right md:block">ROI · доля</span>
          </div>
          {summary.buyers.map((row) => (
            <div
              key={row.buyer.id}
              className="grid grid-cols-[1.3fr_1fr_1fr] md:grid-cols-[1.6fr_repeat(5,1fr)_1.05fr] items-center border-t border-line py-3"
            >
              <span className="flex items-center gap-3">
                <Avatar initials={row.buyer.initials} color={row.buyer.color} />
                <span>
                  <span className="block text-[14.5px] font-semibold">{row.buyer.handle}</span>
                  <span className="block text-[11.5px] text-mute">
                    {row.buyer.source} · {row.days} дн.
                  </span>
                </span>
              </span>
              <span className="n hidden text-right text-[13.5px] text-soft md:block">{usd(row.revenueCents)}</span>
              <span className="n hidden text-right text-[13.5px] text-mute md:block">{usd(row.spendNetCents)}</span>
              <span className="n hidden text-right text-[13.5px] text-mute md:block">{usd(row.spendGrossCents)}</span>
              <span
                className="n text-right text-[18px] font-semibold"
                style={{ color: row.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
              >
                {usd(row.profitCents)}
              </span>
              {/* Итог за всё время: месяц показывает форму, эта цифра — вклад. */}
              <span
                className="n pl-5 text-right text-[14px] font-semibold"
                style={{ color: (allTime.get(row.buyer.id) ?? 0) >= 0 ? '#c4c4c4' : '#ce6e58' }}
              >
                {usd(allTime.get(row.buyer.id) ?? 0, { sign: true })}
              </span>
              <span className="hidden items-center justify-end gap-3 md:flex">
                <span className="n text-[12.5px]" style={{ color: row.roi >= 25 ? '#b4c68c' : '#ce6e58' }}>
                  {row.roi.toFixed(1).replace('.', ',')}%
                </span>
                <span className="h-1.5 w-14 rounded-full bg-sub">
                  <span
                    className="block h-1.5 rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, (row.profitCents / Math.max(1, summary.buyers[0].profitCents)) * 100))}%`,
                      background: row.profitCents >= 0 ? '#b4c68c' : '#ce6e58',
                    }}
                  />
                </span>
              </span>
            </div>
          ))}
          <div className="flex-1" />
          <Sub className="mt-2.5 grid grid-cols-[1.3fr_1fr_1fr] md:grid-cols-[1.6fr_repeat(5,1fr)_1.05fr] items-center px-4 py-3.5">
            <span className="lab text-text">Итого</span>
            <span className="n hidden text-right text-[13.5px] md:block">{usd(summary.totals.revenueCents)}</span>
            <span className="n hidden text-right text-[13.5px] md:block">{usd(summary.totals.spendNetCents)}</span>
            <span className="n hidden text-right text-[13.5px] md:block">{usd(summary.totals.spendGrossCents)}</span>
            <span className="n text-right text-[18px] font-semibold text-sage">
              {usd(summary.totals.profitCents)}
            </span>
            <span
              className="n pl-5 text-right text-[14px] font-semibold"
              style={{ color: allTimeTotal >= 0 ? '#c4c4c4' : '#ce6e58' }}
            >
              {usd(allTimeTotal, { sign: true })}
            </span>
            <span className="n hidden text-right text-[12.5px] text-sage md:block">
              {summary.totals.roi.toFixed(1).replace('.', ',')}%
            </span>
          </Sub>
        </Panel>

        <div className="flex flex-col gap-3.5">
          <Panel className="flex-1 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rust-t">
                  <IconBox color="#ce6e58" size={17} />
                </span>
                <span className="text-[15.5px] font-semibold">Расходники</span>
              </span>
              <span className="n text-[17px] font-semibold text-rust">
                {usd(summary.totals.consumableCents)}
              </span>
            </div>
            {consumables.length === 0 ? (
              <Empty>За период ничего не списано.</Empty>
            ) : (
              consumables.map((c) => (
                <div key={c.name} className="mb-3 flex items-center gap-3">
                  <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: c.color }} />
                  <span className="w-[122px] shrink-0 text-[12.5px] text-soft">{c.name}</span>
                  <Meter value={c.cents} max={worstConsumable} color={c.color} />
                  <span className="n w-12 text-right text-[12px] text-mid">{usd(c.cents)}</span>
                </div>
              ))
            )}
          </Panel>

          <Panel className="flex-1 p-4 sm:p-5">
            <div className="mb-3.5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rust-t">
                <IconWarn color="#ce6e58" size={17} />
              </span>
              <span className="text-[15.5px] font-semibold">Требует внимания</span>
            </div>
            {alerts.length === 0 ? (
              <Empty>Всё спокойно.</Empty>
            ) : (
              alerts.slice(0, 5).map((a, i) => (
                <Sub key={i} className="mb-2.5 flex gap-3 px-3.5 py-3">
                  <span className="w-[3px] shrink-0 rounded-sm" style={{ background: a.color }} />
                  <span className="text-[12.5px] leading-relaxed">{a.text}</span>
                </Sub>
              ))
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
