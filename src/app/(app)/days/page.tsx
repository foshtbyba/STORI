import Link from 'next/link';
import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import { periodBounds, periodLabel, fmtDay, weekdayShort } from '@/lib/period';
import { Panel, PanelHead, Empty } from '@/components/ui';
import DayRow, { type DayRowData } from '@/components/DayRow';
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
  const canEdit = canSeeTeam(user.role as Role);

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
          canEdit ? (
            <Link
              href="/days/new"
              className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-[13px] font-semibold text-bg transition hover:opacity-90"
            >
              <IconPlus color="#141414" size={14} width={2.6} />
              Добавить день
            </Link>
          ) : (
            <span className="text-[12.5px] text-mute">отчёты заводит админ</span>
          )
        }
      />

      <div className="mt-4 grid grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)_auto] pb-2.5">
        <span className="lab">День</span>
        <span className="lab">Баер</span>
        <span className="lab">Источник</span>
        <span className="lab text-right">Доход</span>
        <span className="lab text-right">Спенд</span>
        <span className="lab text-right">С комиссией</span>
        <span className="lab text-right">Профит</span>
        <span className="lab pl-3 text-right">{canEdit ? 'Правка' : ''}</span>
      </div>

      {days.length === 0 ? (
        <Empty>За {periodLabel(key)} отчётов нет.</Empty>
      ) : (
        days.map((d) => {
          const row: DayRowData = {
            id: d.id,
            day: fmtDay(d.date),
            weekday: weekdayShort(d.date),
            buyer: { initials: d.buyer.initials, color: d.buyer.color, handle: d.buyer.handle },
            source: d.source,
            revenueCents: d.revenueCents,
            spendNetCents: d.spendNetCents,
            spendGrossCents: d.spendGrossCents,
            commissionBps: d.commissionBps,
            note: d.note,
          };
          return <DayRow key={d.id} row={row} canEdit={canEdit} />;
        })
      )}
    </Panel>
  );
}
