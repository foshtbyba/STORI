import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { scopeBuyerId } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import { periodBounds, periodLabel, fmtDay, weekdayShort } from '@/lib/period';
import { usd, profitOf } from '@/lib/money';
import { Panel, PanelHead, Avatar, Empty } from '@/components/ui';
import { IconCalendar, IconPlus } from '@/components/icons';

export default async function DaysPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const { period } = await searchParams;
  const key = period ?? (await currentPeriodKey());
  const { from, to } = periodBounds(key);
  const buyerId = scopeBuyerId(user);

  const days = await prisma.dayReport.findMany({
    where: { date: { gte: from, lt: to }, ...(buyerId ? { buyerId } : {}) },
    include: { offer: true, buyer: true, paymentMethod: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return (
    <Panel className="flex flex-col p-6">
      <PanelHead
        icon={<IconCalendar color="#b4c68c" />}
        tint="bg-sage-t"
        title="Отчёты по дням"
        aside={<span className="text-[12.5px] text-mute">{periodLabel(key)}</span>}
        right={
          <Link
            href="/days/new"
            className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-[13px] font-semibold text-bg transition hover:opacity-90"
          >
            <IconPlus color="#141414" size={14} width={2.6} />
            Добавить день
          </Link>
        }
      />

      <div className="mt-4 grid grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)] pb-2.5">
        <span className="lab">День</span>
        <span className="lab">Баер</span>
        <span className="lab">Оффер</span>
        <span className="lab text-right">Доход</span>
        <span className="lab text-right">Спенд</span>
        <span className="lab text-right">С комиссией</span>
        <span className="lab text-right">Профит</span>
      </div>

      {days.length === 0 ? (
        <Empty>За {periodLabel(key)} отчётов нет.</Empty>
      ) : (
        days.map((d) => (
          <div
            key={d.id}
            className="grid grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)] items-center border-t border-line py-3"
          >
            <span className="flex items-baseline gap-2">
              <span className="n text-[15px] font-semibold">{fmtDay(d.date)}</span>
              <span className="text-[11px] text-mute">{weekdayShort(d.date)}</span>
            </span>
            <span className="flex items-center gap-2.5">
              <Avatar initials={d.buyer.initials} color={d.buyer.color} size={28} />
              <span className="text-[13px]">{d.buyer.handle}</span>
            </span>
            <span className="truncate text-[13px] text-soft">
              {d.offer?.name ?? '—'}
              <span className="ml-2 text-[11px] text-mute">{d.source}</span>
            </span>
            <span className="n text-right text-[13.5px] text-soft">{usd(d.revenueCents)}</span>
            <span className="n text-right text-[13.5px] text-mute">{usd(d.spendNetCents)}</span>
            <span className="n text-right text-[13.5px] text-mute">
              {usd(d.spendGrossCents)}
              <span className="ml-1.5 text-[11px] text-dim">{(d.commissionBps / 100).toFixed(2)}%</span>
            </span>
            <span
              className="n text-right text-[17px] font-semibold"
              style={{ color: profitOf(d) >= 0 ? '#b4c68c' : '#ce6e58' }}
            >
              {usd(profitOf(d), { sign: true })}
            </span>
          </div>
        ))
      )}
    </Panel>
  );
}
