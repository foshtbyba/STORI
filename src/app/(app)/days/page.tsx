import Link from 'next/link';
import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { weekBounds, weekKey, weekLabel, fmtDay, weekdayShort, isEditable } from '@/lib/period';
import { Panel, PanelHead, Empty } from '@/components/ui';
import DayRow, { type DayRowData } from '@/components/DayRow';
import DayBuyerFilter from '@/components/DayBuyerFilter';
import WeekNav from '@/components/WeekNav';
import { IconCalendar, IconPlus } from '@/components/icons';
import { AGENCY_SOURCE } from '@/lib/extra-spend';
import { usd } from '@/lib/money';

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
  searchParams: Promise<{ week?: string; owners?: string; buyer?: string }>;
}) {
  const user = await requireUser();
  const { week, owners, buyer } = await searchParams;
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
  // Овнеры в списке дней по умолчанию скрыты — их цифры отдельные. Кнопка их
  // показывает (только админу).
  const showOwners = isAdmin && owners === '1';
  // Фильтр по баеру: баер видит только себя (buyerId), админ может выбрать
  // одного через селектор (?buyer=id).
  const selBuyer = buyerId ?? (isAdmin && buyer ? buyer : undefined);

  const days = await prisma.dayReport.findMany({
    where: {
      date: { gte: from, lt: to },
      ...(selBuyer ? { buyerId: selBuyer } : showOwners ? {} : { buyer: { owner: false } }),
    },
    include: { buyer: true, paymentMethod: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });

  // Список баеров для фильтра (только админу). Овнеров добавляем, когда они
  // показаны.
  const filterBuyers = isAdmin
    ? await prisma.buyer.findMany({
        where: { archived: false, ...(showOwners ? {} : { owner: false }) },
        select: { id: true, handle: true },
        orderBy: { handle: 'asc' },
      })
    : [];

  /*
    Агентка — не отдельный день, а приписка к дню баера: тот же человек, та же
    дата, просто часть денег ушла мимо карт и со своей комиссией. Двумя
    строками это читалось как два разных дня, где у одного «профит −$165» без
    дохода, — и человек в отчёте видел минус там, где день закрыт в плюс.
    Поэтому склеиваем: одна строка на день, агентка приписана к расходу.
  */
  const agency = days.filter((d) => d.source === AGENCY_SOURCE);
  const taken = new Set<string>();
  const merged = days
    .filter((d) => d.source !== AGENCY_SOURCE)
    .map((d) => {
      // К одной основной строке цепляем одну агентку: если у баера за день
      // несколько строк (разные офферы), вторая её уже не заберёт.
      const extra = agency.find(
        (a) => a.buyerId === d.buyerId && a.date.getTime() === d.date.getTime() && !taken.has(a.id),
      );
      if (extra) taken.add(extra.id);
      return { main: d, extra };
    });

  // Агентка без основной строки — день, где кроме неё ничего не заводили.
  // Такую показываем сама по себе, иначе расход просто пропал бы из отчёта.
  const rows = [
    ...merged,
    ...agency.filter((a) => !taken.has(a.id)).map((a) => ({ main: a, extra: undefined })),
  ].sort((x, y) => y.main.date.getTime() - x.main.date.getTime());

  // Итог за неделю (по показанным строкам): доход, спенд, с комиссией, профит,
  // и разбивка плюс/минус. Профит дня = доход − расход-с-комиссией (ФБ+агентка).
  let tRev = 0, tNet = 0, tGross = 0, tPlus = 0, tMinus = 0;
  for (const { main: d, extra } of rows) {
    const rev = d.revenueCents;
    const net = d.spendNetCents + (extra?.spendNetCents ?? 0);
    const gross = d.spendGrossCents + (extra?.spendGrossCents ?? 0);
    const profit = rev - gross;
    tRev += rev; tNet += net; tGross += gross;
    if (profit >= 0) tPlus += profit; else tMinus += profit;
  }
  const tProfit = tRev - tGross;

  const ownersHref = (on: boolean) => {
    const p = new URLSearchParams();
    if (week) p.set('week', week);
    if (on) p.set('owners', '1');
    const q = p.toString();
    return q ? `/days?${q}` : '/days';
  };

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
            {isAdmin ? (
              <Link
                href={ownersHref(!showOwners)}
                prefetch={false}
                className={`rounded-full px-3.5 py-2 text-[12.5px] transition ${
                  showOwners ? 'bg-raise font-semibold text-text' : 'bg-sub text-mute hover:text-soft'
                }`}
              >
                {showOwners ? 'овнеры: видны' : 'овнеры'}
              </Link>
            ) : null}
            {isAdmin ? (
              <DayBuyerFilter buyers={filterBuyers} selected={buyer ?? ''} week={week} owners={showOwners} />
            ) : null}
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

      {rows.length === 0 ? (
        <Empty>
          {isCurrent
            ? 'За текущую неделю отчётов пока нет.'
            : `За ${weekLabel(key)} отчётов нет.`}
        </Empty>
      ) : (
        rows.map(({ main: d, extra }) => {
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
            extra: extra
              ? {
                  id: extra.id,
                  spendNetCents: extra.spendNetCents,
                  spendGrossCents: extra.spendGrossCents,
                  commissionBps: extra.commissionBps,
                  note: extra.note,
                }
              : undefined,
          };
          return <DayRow key={d.id} row={row} canEdit={canEdit} />;
        })
      )}

      {rows.length > 0 ? (
        <>
          {/* Итоговая строка — суммы колонок, выровнены под шапку. */}
          <div className="mt-1 grid grid-cols-[0.8fr_1.1fr_1fr_auto] border-t border-line pt-3 text-[13px] font-semibold md:grid-cols-[0.7fr_1.2fr_1.5fr_repeat(4,1fr)_auto]">
            <span>Итого</span>
            <span />
            <span className="hidden md:block" />
            <span className="hidden text-right md:block">{usd(tRev)}</span>
            <span className="hidden text-right md:block">{usd(tNet)}</span>
            <span className="hidden text-right md:block">{usd(tGross)}</span>
            <span className={`text-right ${tProfit >= 0 ? 'text-sage' : 'text-rust'}`}>{usd(tProfit, { sign: true })}</span>
            <span className="pl-2 md:pl-3" />
          </div>

          {/* Плюс / минус / итог — общий результат за неделю. */}
          <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-mute">
            <span>в плюсе <span className="font-semibold text-sage">{usd(tPlus, { sign: true })}</span></span>
            <span>в минусе <span className="font-semibold text-rust">{usd(tMinus, { sign: true })}</span></span>
            <span>итог <span className={`font-semibold ${tProfit >= 0 ? 'text-sage' : 'text-rust'}`}>{usd(tProfit, { sign: true })}</span></span>
          </div>
        </>
      ) : null}
    </Panel>
  );
}
