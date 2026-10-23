import { requireTeamView } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { periodKeyOf, isEditable } from '@/lib/period';
import { DEFAULT_COMMISSION_BPS } from '@/lib/money';
import { GRID_CONSUMABLE_NOTE } from '@/lib/consumables';
import { AGENCY_SOURCE } from '@/lib/extra-spend';
import DayGrid, { type GridSeed } from '@/components/DayGrid';
import ExtraSpend, { type ExtraSeed } from '@/components/ExtraSpend';

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

  const [buyers, owners, types, saved, entries, period, agents] = await Promise.all([
    prisma.buyer.findMany({ where: { archived: false, owner: false }, orderBy: { handle: 'asc' } }),
    // Овнеры идут в ту же таблицу с пометкой «овнер»: их доход/расход тоже
    // заводят руками, но в командный итог они не попадают.
    prisma.buyer.findMany({ where: { archived: false, owner: true }, orderBy: { handle: 'asc' } }),
    prisma.consumableType.findMany({ orderBy: { name: 'asc' } }),
    prisma.dayReport.findMany({ where: { date: when } }),
    prisma.consumableEntry.findMany({ where: { date: when, note: GRID_CONSUMABLE_NOTE } }),
    prisma.period.findUnique({ where: { key: periodKeyOf(when) } }),
    prisma.agent.findMany({ where: { archived: false }, orderBy: [{ sort: 'asc' }, { name: 'asc' }] }),
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

  // Агентские идут отдельной строкой дня с источником «Агентка»: синхронизация
  // ходит только по «Facebook» и эту цифру не перепишет.
  const extraSeed: ExtraSeed[] = [...buyers, ...owners].map((b) => {
    const row = saved.find((d) => d.buyerId === b.id && d.source === AGENCY_SOURCE);
    return {
      buyerId: b.id,
      spend: row ? num(row.spendNetCents) : '',
      note: row?.note ?? '',
      agentId: row?.agentId ?? '',
    };
  });

  return (
    <div className="flex flex-col gap-3.5">
      <DayGrid
        // Пересобираем сетку при смене даты: её строки берутся из seed один
        // раз, и без remount при клиентском переходе цифры остались бы от
        // прошлого дня до перезагрузки.
        key={day}
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

      <ExtraSpend
        key={`extra-${day}`}
        date={day}
        buyers={[
          ...buyers.map((b) => ({ id: b.id, handle: b.handle, initials: b.initials, color: b.color })),
          ...owners.map((b) => ({ id: b.id, handle: b.handle, initials: b.initials, color: b.color, owner: true })),
        ]}
        agents={agents.map((a) => ({ id: a.id, name: a.name, commissionBps: a.commissionBps }))}
        seed={extraSeed}
        locked={period?.status === 'CLOSED' || !isEditable(when)}
      />

    </div>
  );
}
