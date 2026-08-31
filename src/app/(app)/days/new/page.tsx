import { requireTeamView } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { periodKeyOf, isEditable } from '@/lib/period';
import { DEFAULT_COMMISSION_BPS } from '@/lib/money';
import { GRID_CONSUMABLE_NOTE } from '@/lib/consumables';
import DayGrid, { type GridSeed } from '@/components/DayGrid';
import TopUps, { type TopUpRow } from '@/components/TopUps';

// Отчёты заводит только команда: баер видит свои дни, но не редактирует их.
// Баера сюда не пускаем — requireTeamView отправит его в кабинет.
export default async function NewDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireTeamView();
  const { date } = await searchParams;

  const today = new Date().toISOString().slice(0, 10);
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const when = new Date(`${day}T00:00:00.000Z`);

  const [buyers, owners, types, saved, entries, period, owed] = await Promise.all([
    prisma.buyer.findMany({ where: { archived: false, owner: false }, orderBy: { handle: 'asc' } }),
    // Овнеры идут в ту же таблицу с пометкой «овнер»: их доход/расход тоже
    // заводят руками, но в командный итог они не попадают.
    prisma.buyer.findMany({ where: { archived: false, owner: true }, orderBy: { handle: 'asc' } }),
    prisma.consumableType.findMany({ orderBy: { name: 'asc' } }),
    prisma.dayReport.findMany({ where: { date: when } }),
    prisma.consumableEntry.findMany({ where: { date: when, note: GRID_CONSUMABLE_NOTE } }),
    prisma.period.findUnique({ where: { key: periodKeyOf(when) } }),
    // Всё, что до этой даты включительно и ещё не закинуто, плюс уже закрытое
    // за этот день — из этого складывается «сколько нужно закинуть».
    // Закидываем доход, который был: именно его реинвестируют в кабинеты.
    prisma.dayReport.findMany({
      where: { date: { lte: when } },
      select: { buyerId: true, date: true, revenueCents: true, toppedUpAt: true },
    }),
  ]);

  const defaultBps = DEFAULT_COMMISSION_BPS;
  const num = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));

  // Таблица открывается уже заполненной тем, что записано на эту дату, — так
  // правка дня не превращается в повторный ввод всех цифр.
  const seed: GridSeed[] = [...buyers, ...owners].map((b) => {
    const row = saved.find((d) => d.buyerId === b.id && d.source === b.source);
    const entry = entries.find((e) => e.buyerId === b.id);
    return {
      buyerId: b.id,
      revenue: row ? num(row.revenueCents) : '',
      spend: row ? num(row.spendNetCents) : '',
      pct: ((row?.commissionBps ?? defaultBps) / 100).toString(),
      consumable: entry ? num(entry.totalCents) : '',
    };
  });

  const dayMs = when.getTime();
  const topUps: TopUpRow[] = buyers
    .map((b) => {
      const mine = owed.filter((d) => d.buyerId === b.id);
      const add = (rows: typeof mine) => rows.reduce((a, d) => a + d.revenueCents, 0);
      return {
        buyerId: b.id,
        handle: b.handle,
        initials: b.initials,
        color: b.color,
        todayCents: add(mine.filter((d) => !d.toppedUpAt && d.date.getTime() === dayMs)),
        debtCents: add(mine.filter((d) => !d.toppedUpAt && d.date.getTime() < dayMs)),
        settledCents: add(mine.filter((d) => d.toppedUpAt)),
      };
    })
    .filter((r) => r.todayCents + r.debtCents + r.settledCents > 0);

  return (
    <div className="flex flex-col gap-3.5">
      <DayGrid
        date={day}
        buyers={[
          ...buyers.map((b) => ({ id: b.id, handle: b.handle, initials: b.initials, color: b.color })),
          ...owners.map((b) => ({ id: b.id, handle: b.handle, initials: b.initials, color: b.color, owner: true })),
        ]}
        types={types.map((t) => ({ id: t.id, name: t.name }))}
        seed={seed}
        seedTypeId={entries[0]?.typeId ?? types[0]?.id ?? ''}
        defaultPct={(defaultBps / 100).toString()}
        locked={period?.status === 'CLOSED' || !isEditable(when)}
      />

      {topUps.length > 0 ? <TopUps date={day} rows={topUps} /> : null}
    </div>
  );
}
