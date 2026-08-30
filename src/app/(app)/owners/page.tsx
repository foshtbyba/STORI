import { requireUser } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { currentPeriodKey, teamSummary } from '@/lib/queries';
import { usd, rub, sum, profitOf, grossUp, ceilDollars, DEFAULT_COMMISSION_BPS } from '@/lib/money';
import {
  titleOf, rangeOf, isWeekKey, shiftKey, switchMode, daysOfRange, dayKey,
} from '@/lib/period';
import PeriodNav from '@/components/PeriodNav';
import { Panel, PanelHead, Sub, Avatar, Empty, Big } from '@/components/ui';
import { ProfitBars } from '@/components/Charts';
import { IconUsers, IconChart, IconBox } from '@/components/icons';

/**
 * Лист овнеров — отдельный от команды и виден только админу. Овнеры в зарплате
 * и в командном отчёте не участвуют; здесь их статистика существует чисто для
 * понимания. Плюс строка «расходники на команду» — расход с Brocard-«общака».
 */
export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  if ((user.role as Role) !== 'ADMIN') {
    return <Empty>Лист овнеров виден только админу.</Empty>;
  }

  const now = await currentPeriodKey();
  const { p } = await searchParams;
  const view = p && (isWeekKey(p) || /^\d{4}-\d{2}$/.test(p)) ? p : now;
  const range = rangeOf(view);
  const label = titleOf(view);
  const key = isWeekKey(view) ? view : now;

  const summary = await teamSummary(key, range, { owners: true });
  const rate = summary.period.rubPerUsd;

  // Расходники на команду — сумма с «общака» за отрезок, с той же накруткой
  // комиссии за пополнение (4.5%), что и весь расход, округлённой вверх.
  const overhead = await prisma.overheadDay.aggregate({
    where: { date: { gte: range.from, lt: range.to } },
    _sum: { spendCents: true },
  });
  const overheadNet = overhead._sum.spendCents ?? 0;
  const overheadGross = ceilDollars(grossUp(overheadNet, DEFAULT_COMMISSION_BPS));

  const series = daysOfRange(range).map((date) => {
    const k = dayKey(date);
    const byDay = summary.days.filter((d) => dayKey(d.date) === k);
    return { date, profitCents: sum(byDay, (d) => profitOf(d)) };
  });

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconUsers color="#b4c68c" />}
          tint="bg-sage-t"
          title="Чистый профит"
          iconHref={view === now ? undefined : '/owners'}
          iconTitle="Вернуться к текущей неделе"
          aside={<span className="text-[15px] text-sage">{label}</span>}
          right={
            <PeriodNav
              base="/owners"
              label={label}
              isWeek={isWeekKey(view)}
              prev={shiftKey(view, -1)}
              next={shiftKey(view, 1)}
              week={switchMode(view, 'week')}
              month={switchMode(view, 'month')}
            />
          }
        />
        <p className="mt-3 text-[12px] text-mute">
          Отдельный лист: в зарплате и в командном отчёте овнеры не участвуют. Цифры
          здесь — чисто для понимания.
        </p>
        <Big cents={summary.totals.profitCents} size={64} className="mt-4" />
        <div className="n mt-2.5 text-[12.5px] text-mute">{rub(summary.totals.profitCents, rate)}</div>
        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 sm:gap-3">
          {[
            { label: 'Оборот', value: usd(summary.totals.revenueCents), color: 'text-text' },
            { label: 'Расход с комиссией', value: usd(summary.totals.spendGrossCents), color: 'text-text' },
            { label: 'Профит с рекламы', value: usd(summary.totals.profitCents), color: 'text-text' },
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
        <PanelHead icon={<IconUsers color="#b4c68c" />} tint="bg-sage-t" title="Овнеры" aside={<span className="text-[12.5px] text-mute">{summary.buyers.length} чел.</span>} />
        {summary.buyers.length === 0 ? (
          <Empty>Овнеры не помечены. Отметь их в разделе «Команда» на странице зарплаты.</Empty>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-[1.4fr_1fr_1fr] md:grid-cols-[1.5fr_repeat(4,1fr)] pb-2.5">
              <span className="lab">Овнер</span>
              <span className="lab hidden text-right md:block">Доход</span>
              <span className="lab hidden text-right md:block">Спенд</span>
              <span className="lab text-right">Профит</span>
              <span className="lab hidden text-right md:block">ROI</span>
            </div>
            {summary.buyers.map((row) => (
              <div
                key={row.buyer.id}
                className="grid grid-cols-[1.4fr_1fr_1fr] md:grid-cols-[1.5fr_repeat(4,1fr)] items-center border-t border-line py-3"
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

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.6fr_1fr] lg:gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconChart color="#b4c68c" />}
            tint="bg-sage-t"
            title="Профит по дням"
            aside={<span className="text-[12.5px] text-mute">овнеры · {label}</span>}
          />
          <div className="mt-5">
            <ProfitBars data={series} />
          </div>
        </Panel>

        <Panel className="flex flex-col p-4 sm:p-6">
          <PanelHead icon={<IconBox color="#ce6e58" />} tint="bg-rust-t" title="Расходники на команду" />
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Расход с команды «Общак» в Brocard — деньги идут не баеру, а на общие
            расходники команды. В профит никому не входит, показываем отдельно.
          </p>
          <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
            <span className="text-[13px] text-soft">За {label}</span>
            <span className="n text-[26px] font-semibold text-rust">{usd(overheadGross)}</span>
          </div>
          <div className="n mt-1 text-right text-[12px] text-mute">
            {rub(overheadGross, rate)}
            {overheadNet ? <span className="ml-2 text-dim">Сумма {usd(ceilDollars(overheadNet))} + 4,5%</span> : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}
