import Link from 'next/link';
import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { weekBounds, weekKey, weekLabel, fmtDay, weekdayShort, isEditable } from '@/lib/period';
import { Panel, PanelHead, Empty } from '@/components/ui';
import DayRow, { type DayRowData } from '@/components/DayRow';
import WeekNav from '@/components/WeekNav';
import { IconCalendar, IconPlus } from '@/components/icons';

/**
 * Отчёты по дням.
 *
 * На виду всегда одна неделя — та, что идёт прямо сейчас. Прошлые недели и
 * месяцы никуда не деваются, но живут в архиве: открываются календарём в
 * шапке или стрелками. Так на странице ровно семь строк дел, а не история
 * с начала месяца.
 */
export default async function DaysPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const user = await requireUser();
  const { week } = await searchParams;
  const today = weekKey(new Date());
  const key = week ? weekKey(new Date(`${week}T00:00:00.000Z`)) : today;
  const isCurrent = key === today;
  const { from, to } = weekBounds(key);
  const buyerId = scopeBuyerId(user);
  // Правка закрывается по времени: текущую и прошлую неделю править можно,
  // позапрошлую и глубже — только чтение. Вся неделя разом попадает под одно
  // правило, поэтому решаем по её понедельнику.
  const weekEditable = isEditable(from);
  const isAdmin = canSeeTeam(user.role as Role);
  const canEdit = isAdmin && weekEditable;

  const days = await prisma.dayReport.findMany({
    // Овнеры в командный отчёт по дням не попадают — их цифры живут отдельным
    // листом и видны только админу.
    where: {
      date: { gte: from, lt: to },
      ...(buyerId ? { buyerId } : { buyer: { owner: false } }),
    },
    include: { buyer: true, paymentMethod: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  return (
    <Panel className="flex flex-col p-4 sm:p-6">
      <PanelHead
        icon={<IconCalendar color="#b4c68c" />}
        tint="bg-sage-t"
        title="Отчёты по дням"
        iconHref={isCurrent ? undefined : '/days'}
        iconTitle="Вернуться к текущей неделе"
        aside={
          <span className="hidden text-[12.5px] text-mute sm:inline">
            {isCurrent ? 'текущая неделя' : 'архив'}
          </span>
        }
        right={
          <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
            <WeekNav week={key} label={weekLabel(key)} isCurrent={isCurrent} />
            {canEdit ? (
              <Link
                href="/days/new"
                className="flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-[13px] font-semibold text-bg transition hover:opacity-90"
              >
                <IconPlus color="#141414" size={14} width={2.6} />
                <span className="sm:hidden">День</span>
                <span className="hidden sm:inline">Добавить день</span>
              </Link>
            ) : isAdmin ? (
              <span className="text-[12.5px] text-mute">архив — только чтение</span>
            ) : (
              <span className="text-[12.5px] text-mute">отчёты заводит админ</span>
            )}
          </div>
        }
      />

      <div className="mt-4 grid grid-cols-[0.8fr_1.1fr_1fr_auto] pb-2.5 md:grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)_auto]">
        <span className="lab">День</span>
        <span className="lab">Баер</span>
        <span className="lab hidden md:block">Источник</span>
        <span className="lab hidden text-right md:block">Доход</span>
        <span className="lab hidden text-right md:block">Спенд</span>
        <span className="lab hidden text-right md:block">С комиссией</span>
        <span className="lab text-right">Профит</span>
        <span className="lab pl-2 text-right md:pl-3">{canEdit ? 'Правка' : ''}</span>
      </div>

      {days.length === 0 ? (
        <Empty>
          {isCurrent
            ? 'За текущую неделю отчётов пока нет.'
            : `За ${weekLabel(key)} отчётов нет.`}
        </Empty>
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
