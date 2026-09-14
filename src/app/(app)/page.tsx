import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary, buyerSummary, allTimeProfit, payoutAcross, overheadMonths } from '@/lib/queries';
import { usd, rub } from '@/lib/money';
import {
  periodRange, periodTitle,
  isWeekKey, rangeOf, titleOf, shiftKey, switchMode,
} from '@/lib/period';
import PeriodNav from '@/components/PeriodNav';
import { Panel, PanelHead, Sub, Avatar, Empty, Big } from '@/components/ui';
import { Meter } from '@/components/Charts';
import { IconChart, IconWallet, IconBox, IconWarn, IconUsers } from '@/components/icons';
import BuyerCabinet from '@/components/BuyerCabinet';

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  // Расчётный период — неделя: и статистика, и зарплата считаются за неё.
  // Но посмотреть можно любой отрезок — хоть прошлую неделю, хоть месяц.
  const now = await currentPeriodKey();
  const { p } = await searchParams;
  const view = p && (isWeekKey(p) || /^\d{4}-\d{2}$/.test(p)) ? p : now;
  const week = rangeOf(view);
  const label = titleOf(view);
  // Курс и бонусы берём у недели: у месяца своего расчётного периода нет.
  const key = isWeekKey(view) ? view : now;

  if (!canSeeTeam(user.role as Role)) {
    if (!user.buyer) return <Empty>У аккаунта нет профиля баера — попроси админа его создать.</Empty>;
    const data = await buyerSummary(user.buyer.id, key, week);
    if (!data) return <Empty>Нет данных за {label}.</Empty>;
    return <BuyerCabinet data={data} label={label} />;
  }

  const summary = await teamSummary(key, week);
  /*
    Зарплата живёт неделями. Пока смотрим неделю, лист один и берём его как
    есть; на месяце складываем недельные листы — процент считается от
    недельной базы, и месячная сумма дала бы ставку, которой ни у кого не
    было, а вместе с ней и заниженный остаток команде.
  */
  const payroll = isWeekKey(view)
    ? {
        weeks: 1,
        salaryCents: summary.totals.salaryCents,
        bonusCents: summary.totals.bonusCents,
        payoutCents: summary.totals.payoutCents,
      }
    : await payoutAcross(week);
  // Касса команды после всего: профит − расходники − зарплата.
  const teamNetCents =
    summary.totals.profitCents - summary.totals.consumableCents - payroll.payoutCents;
  const allTime = await allTimeProfit();
  const allTimeTotal = [...allTime.values()].reduce((a, b) => a + b, 0);

  // Овнеры и расходники на команду — только под админом, и они НЕ входят в
  // командную стату выше: это отдельные окна для понимания.
  const isAdmin = user.role === 'ADMIN';
  const [ownerRows, overhead, ownerAllTime] = isAdmin
    ? await Promise.all([
        teamSummary(key, week, { owners: true }).then((s) => s.buyers),
        overheadMonths(),
        allTimeProfit({ owners: true }),
      ])
    : [[], [], new Map<string, number>()];
  const rate = summary.period.rubPerUsd;

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
    else if (row.netCents < 0) alerts.push({ color: '#ce6e58', text: `${row.buyer.handle} — отрезок в минусе` });
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
            iconHref={view === now ? undefined : '/'}
            iconTitle="Вернуться к текущей неделе"
            aside={<span className="text-[15px] text-sage">{label}</span>}
            right={
              <PeriodNav
                base="/"
                label={label}
                isWeek={isWeekKey(view)}
                prev={shiftKey(view, -1)}
                next={shiftKey(view, 1)}
                week={switchMode(view, 'week')}
                month={switchMode(view, 'month')}
              />
            }
          />
          {/* Чистый — уже за вычетом расходников: они списываются с профита,
              и показывать их отдельной строкой значит вводить в заблуждение. */}
          <Big cents={summary.totals.netCents} size={76} className="mt-4" />
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
              {
                label: 'Расходники',
                // Ноль без минуса: «−$0» читается как ошибка, а не как «ничего
                // не списали».
                value: summary.totals.consumableCents
                  ? `−${usd(summary.totals.consumableCents)}`
                  : usd(0),
                color: summary.totals.consumableCents ? 'text-rust' : 'text-mute',
              },
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
          <Big cents={teamNetCents} size={46} className="mt-4" />
          <div className="flex-1" />
          {/*
            Читается как расчёт сверху вниз: профит с рекламы — база, из неё
            вычитаются расходники и зарплата. Комиссия за пополнения уже сидит
            внутри рекламного расхода — показываем справочно, второй раз не
            списываем.
          */}
          {[
            { name: 'Профит с рекламы', cents: summary.totals.profitCents, base: true, note: 'из него и считаем' },
            { name: 'Расходники', cents: summary.totals.consumableCents, taken: true },
            {
              name: 'Зарплата баеров',
              cents: payroll.payoutCents,
              taken: true,
              note: payroll.weeks > 1 ? `по ${payroll.weeks} недельным листам` : undefined,
            },
            {
              name: 'Комиссия за пополнения',
              cents: summary.totals.commissionCents,
              taken: false,
              note: 'уже внутри расхода',
            },
          ].map((row) => (
            <div key={row.name} className="flex items-center justify-between border-t border-line py-2.5">
              <span className="text-[13px] text-soft">
                {row.name}
                {row.note ? (
                  <span className="ml-1.5 text-[11px] text-mute">· {row.note}</span>
                ) : null}
              </span>
              <span
                className={`n text-[13.5px] ${
                  row.base ? 'text-soft' : row.taken && row.cents ? 'text-rust' : 'text-mute'
                }`}
              >
                {row.taken && row.cents ? '− ' : ''}
                {usd(row.cents)}
              </span>
            </div>
          ))}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.85fr_1fr] lg:gap-3.5">
        <Panel className="flex flex-col p-4 sm:p-6">
          <PanelHead
            icon={<IconUsers color="#b4c68c" />}
            tint="bg-sage-t"
            title="Баеры"
            aside={<span className="text-[12.5px] text-mute">{summary.buyers.length} человек</span>}
          />
          <div className="mt-4 grid grid-cols-[1.3fr_1fr_1fr] gap-x-3 md:grid-cols-[1.5fr_repeat(5,1fr)_1fr] pb-2.5">
            <span className="lab whitespace-nowrap">Баер</span>
            <span className="lab hidden whitespace-nowrap text-right md:block">Доход</span>
            <span className="lab hidden whitespace-nowrap text-right md:block">С комиссией</span>
            <span className="lab hidden whitespace-nowrap text-right md:block">Расходники</span>
            <span className="lab whitespace-nowrap text-right" title="За вычетом расходников">Профит</span>
            <span className="lab whitespace-nowrap text-right" title="Чистый профит по всем отчётам, за все периоды">
              За всё время
            </span>
            <span className="lab hidden whitespace-nowrap text-right md:block">ROI · доля</span>
          </div>
          {summary.buyers.map((row) => (
            <div
              key={row.buyer.id}
              className="grid grid-cols-[1.3fr_1fr_1fr] gap-x-3 md:grid-cols-[1.5fr_repeat(5,1fr)_1fr] items-center border-t border-line py-3"
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
              <span className="n hidden text-right text-[13.5px] text-mute md:block">{usd(row.spendGrossCents)}</span>
              <span className="n hidden text-right text-[13.5px] text-rust md:block">
                {row.consumableCents ? `−${usd(row.consumableCents)}` : '—'}
              </span>
              {/* Профит показываем чистыми: расходники уже вычтены, и именно
                  эта сумма идёт в зарплатную базу. */}
              <span
                className="n text-right text-[18px] font-semibold"
                style={{ color: row.netCents >= 0 ? '#b4c68c' : '#ce6e58' }}
              >
                {usd(row.netCents)}
              </span>
              {/* Итог за всё время: месяц показывает форму, эта цифра — вклад. */}
              <span
                className="n text-right text-[14px] font-semibold"
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
                      width: `${Math.max(0, Math.min(100, (row.netCents / Math.max(1, summary.buyers[0].netCents)) * 100))}%`,
                      background: row.netCents >= 0 ? '#b4c68c' : '#ce6e58',
                    }}
                  />
                </span>
              </span>
            </div>
          ))}
          <div className="flex-1" />
          {/* Полоса «Итого» тянется во всю ширину панели, а её внутренний паддинг
              РАВЕН паддингу панели — так колонки совпадают со строками выше, а
              текст не липнет к краям. */}
          <Sub className="mt-2.5 grid grid-cols-[1.3fr_1fr_1fr] gap-x-3 md:grid-cols-[1.5fr_repeat(5,1fr)_1fr] items-center py-3.5 -mx-4 w-[calc(100%+2rem)] px-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6">
            <span className="lab text-text">Итого</span>
            <span className="n hidden text-right text-[13.5px] md:block">{usd(summary.totals.revenueCents)}</span>
            <span className="n hidden text-right text-[13.5px] md:block">{usd(summary.totals.spendGrossCents)}</span>
            <span className="n hidden text-right text-[13.5px] text-rust md:block">
              {summary.totals.consumableCents ? `−${usd(summary.totals.consumableCents)}` : '—'}
            </span>
            <span className="n text-right text-[18px] font-semibold text-sage">
              {usd(summary.totals.netCents)}
            </span>
            <span
              className="n text-right text-[14px] font-semibold"
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

      {isAdmin && (ownerRows.length > 0 || overhead.length > 0) ? (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.85fr_1fr] lg:gap-3.5">
          <Panel className="flex flex-col p-4 sm:p-6">
            <PanelHead
              icon={<IconUsers color="#b4c68c" />}
              tint="bg-sage-t"
              title="Овнеры"
              aside={<span className="text-[12.5px] text-mute">{ownerRows.length} чел. · в командную стату не входят</span>}
            />
            {ownerRows.length === 0 ? (
              <Empty>Овнеры не помечены. Отметь их в настройках (ADMIN).</Empty>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-[1.4fr_1fr_1fr] gap-x-3 md:grid-cols-[1.6fr_repeat(4,1fr)_0.8fr] pb-2.5">
                  <span className="lab">Овнер</span>
                  <span className="lab hidden text-right md:block">Доход</span>
                  <span className="lab hidden text-right md:block">С комиссией</span>
                  <span className="lab text-right">Профит</span>
                  <span className="lab hidden text-right md:block">За всё время</span>
                  <span className="lab hidden text-right md:block">ROI</span>
                </div>
                {ownerRows.map((row) => (
                  <div
                    key={row.buyer.id}
                    className="grid grid-cols-[1.4fr_1fr_1fr] gap-x-3 md:grid-cols-[1.6fr_repeat(4,1fr)_0.8fr] items-center border-t border-line py-3"
                  >
                    <span className="flex items-center gap-3">
                      <Avatar initials={row.buyer.initials} color={row.buyer.color} />
                      <span>
                        <span className="block text-[14.5px] font-semibold">{row.buyer.handle}</span>
                        <span className="block text-[11.5px] text-mute">{row.buyer.source} · {row.days} дн.</span>
                      </span>
                    </span>
                    <span className="n hidden text-right text-[13.5px] text-soft md:block">{usd(row.revenueCents)}</span>
                    <span className="n hidden text-right text-[13.5px] text-mute md:block">{usd(row.spendGrossCents)}</span>
                    <span
                      className="n text-right text-[18px] font-semibold"
                      style={{ color: row.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
                    >
                      {usd(row.profitCents)}
                    </span>
                    <span
                      className="n hidden text-right text-[14px] font-semibold md:block"
                      style={{ color: (ownerAllTime.get(row.buyer.id) ?? 0) >= 0 ? '#c4c4c4' : '#ce6e58' }}
                    >
                      {usd(ownerAllTime.get(row.buyer.id) ?? 0, { sign: true })}
                    </span>
                    <span
                      className="n hidden text-right text-[12.5px] md:block"
                      style={{ color: row.roi >= 25 ? '#b4c68c' : '#ce6e58' }}
                    >
                      {row.roi.toFixed(1).replace('.', ',')}%
                    </span>
                  </div>
                ))}
              </>
            )}
          </Panel>

          <Panel className="flex flex-col p-4 sm:p-5">
            <div className="mb-3.5 flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-rust-t">
                <IconBox color="#ce6e58" size={17} />
              </span>
              <span className="text-[15.5px] font-semibold">Расходники на команду</span>
            </div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-mute">
              Расход с «общака» в Brocard — по месяцам, с комиссией за пополнение. В профит никому не входит.
            </p>
            {overhead.length === 0 ? (
              <Empty>Пока пусто. Отметь команду «Общак» в Источниках.</Empty>
            ) : (
              overhead.map((m) => (
                <div key={m.month} className="flex items-center justify-between border-t border-line py-2.5">
                  <span className="text-[13px] text-soft">{m.title}</span>
                  <span className="n text-[15px] font-semibold text-rust">{usd(m.grossCents)}</span>
                </div>
              ))
            )}
          </Panel>
        </div>
      ) : null}

    </div>
  );
}
