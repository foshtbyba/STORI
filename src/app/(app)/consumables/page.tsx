import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import { periodRange, periodTitle, weekKey, fmtDay, isWeekKey, shiftKey, isWeekEditable } from '@/lib/period';
import { usd, sum } from '@/lib/money';
import { addConsumable, deleteConsumable } from '@/app/actions/catalog';
import PeriodNav from '@/components/PeriodNav';
import { Panel, PanelHead, Avatar, Empty } from '@/components/ui';
import Select from '@/components/Select';
import DateField from '@/components/DateField';
import { Meter } from '@/components/Charts';
import { IconBox } from '@/components/icons';

export default async function ConsumablesPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; week?: string }>;
}) {
  const user = await requireUser();
  const { p, week } = await searchParams;
  // Списания недельные, как и вся статистика. Прошлые недели не пропадают —
  // листаются стрелками (?p=ключ понедельника). `week` оставлен для старых ссылок.
  const wanted = p ?? (week ? weekKey(new Date(`${week}T00:00:00.000Z`)) : '');
  const key = wanted && isWeekKey(wanted) ? wanted : await currentPeriodKey();
  const { from, to } = periodRange(key);
  const label = periodTitle(key);
  const scoped = scopeBuyerId(user);
  const canEdit = canSeeTeam(user.role as Role);
  // Удалять списания можно только за текущую и прошлую неделю; позапрошлая и
  // раньше — закрыто (по дате начала показанной недели).
  const weekEditable = isWeekEditable(from);

  const [entries, types, buyers] = await Promise.all([
    prisma.consumableEntry.findMany({
      where: { date: { gte: from, lt: to }, ...(scoped ? { buyerId: scoped } : {}) },
      include: { type: true, buyer: true },
      orderBy: { date: 'desc' },
    }),
    prisma.consumableType.findMany({ orderBy: { name: 'asc' } }),
    prisma.buyer.findMany({ where: { archived: false }, orderBy: { handle: 'asc' } }),
  ]);

  const byType = new Map<string, { name: string; color: string; cents: number }>();
  for (const e of entries) {
    const row = byType.get(e.typeId) ?? { name: e.type.name, color: e.type.color, cents: 0 };
    row.cents += e.totalCents;
    byType.set(e.typeId, row);
  }
  const grouped = [...byType.values()].sort((a, b) => b.cents - a.cents);
  const worst = grouped[0]?.cents ?? 1;

  // Списание всегда именное, поэтому разрез «по баерам» — это ровно то, что
  // уйдёт из профита каждого при расчёте зарплаты.
  const byBuyer = new Map<string, { handle: string; initials: string; color: string; cents: number }>();
  for (const e of entries) {
    if (!e.buyer) continue;
    const row = byBuyer.get(e.buyer.id) ?? {
      handle: e.buyer.handle,
      initials: e.buyer.initials,
      color: e.buyer.color,
      cents: 0,
    };
    row.cents += e.totalCents;
    byBuyer.set(e.buyer.id, row);
  }
  const perBuyer = [...byBuyer.values()].sort((a, b) => b.cents - a.cents);
  const heaviest = perBuyer[0]?.cents ?? 1;
  const today = new Date().toISOString().slice(0, 10);
  const field = 'h-11 rounded-xl border border-line bg-sub px-3.5 text-[14px] outline-none';

  return (
    <div className="flex flex-col gap-3.5">
      {canEdit ? (
      <form action={addConsumable} className="grid grid-cols-2 items-end gap-2.5 rounded-[26px] border border-line bg-panel p-4 sm:grid-cols-3 sm:gap-3 sm:p-5 lg:grid-cols-[repeat(5,1fr)_auto]">
        <DateField name="date" defaultValue={today} />
        <Select
          name="typeId"
          defaultValue={types[0]?.id ?? ''}
          placeholder={types.length ? 'Тип' : 'Типы не заведены'}
          options={types.map((t) => ({ value: t.id, label: t.name }))}
        />
        <Select
          name="buyerId"
          defaultValue={buyers[0]?.id ?? ''}
          placeholder={buyers.length ? 'Баер' : 'Баеры не заведены'}
          options={buyers.map((b) => ({ value: b.id, label: b.handle }))}
        />
        <input name="qty" type="number" min={1} defaultValue={1} className={`n ${field}`} placeholder="шт" />
        <input name="total" inputMode="decimal" className={`n ${field}`} placeholder="сумма, $" required />
        <button type="submit" className="col-span-2 h-11 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg sm:col-span-1">
          Списать
        </button>
      </form>
      ) : null}

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.7fr_1fr] lg:gap-3.5">
        {/* Обёртка: на десктопе панель «Списания» позиционируется абсолютно
            (lg:inset-0), поэтому её содержимое не участвует в расчёте высоты —
            обёртка растягивается по высоте строки грида, которую задаёт правая
            колонка. Так низ «Списаний» ровно совпадает с низом правой колонки,
            а длинный список листается внутри. Никакой фикс-высоты: жёсткие 600px
            вылезали за правую колонку, когда данных мало. */}
        <div className="relative min-h-0">
        <Panel className="flex flex-col overflow-hidden p-4 sm:p-6 lg:absolute lg:inset-0">
          <PanelHead
            icon={<IconBox color="#ce6e58" />}
            tint="bg-rust-t"
            title="Списания"
            aside={<span className="text-[12.5px] text-mute">{label}</span>}
            right={
              <div className="flex items-center gap-3">
                <span className="n text-[17px] font-semibold text-rust">
                  {usd(sum(entries, (e) => e.totalCents))}
                </span>
                <PeriodNav base="/consumables" label={label} isWeek prev={shiftKey(key, -1)} next={shiftKey(key, 1)} week={key} month={key} weeksOnly />
              </div>
            }
          />
          <div className="scroll-slim mt-4 min-h-0 flex-1 overflow-y-auto">
          <div className="grid grid-cols-[0.7fr_1.2fr_1fr_0.8fr] md:grid-cols-[0.6fr_1.2fr_1.2fr_1.6fr_0.7fr] pb-2.5">
            <span className="lab">Дата</span>
            <span className="lab">Тип</span>
            <span className="lab">На кого</span>
            <span className="lab hidden md:block">Комментарий</span>
            <span className="lab text-right">Сумма</span>
          </div>
          {entries.length === 0 ? (
            <Empty>За {label} списаний нет.</Empty>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="grid grid-cols-[0.7fr_1.2fr_1fr_0.8fr] md:grid-cols-[0.6fr_1.2fr_1.2fr_1.6fr_0.7fr] items-center border-t border-line py-2.5">
                <span className="n text-[13px]">{fmtDay(e.date)}</span>
                <span className="flex items-center gap-2 text-[13px]">
                  <span className="h-2 w-2 rounded-sm" style={{ background: e.type.color }} />
                  {e.type.name}
                </span>
                <span className="flex items-center gap-2 text-[13px] text-soft">
                  {e.buyer ? (
                    <>
                      <Avatar initials={e.buyer.initials} color={e.buyer.color} size={24} />
                      {e.buyer.handle}
                    </>
                  ) : (
                    <span className="text-mute">—</span>
                  )}
                </span>
                <span className="hidden truncate text-[12.5px] text-mute md:block">
                  {e.qty > 1 ? `${e.qty} шт · ` : ''}
                  {e.note || '—'}
                </span>
                <span className="flex items-center justify-end gap-3">
                  <span className="n text-[13.5px]">{usd(e.totalCents)}</span>
                  {canEdit && weekEditable ? (
                    <form action={deleteConsumable}>
                      <input type="hidden" name="id" value={e.id} />
                      <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                    </form>
                  ) : null}
                </span>
              </div>
            ))
          )}
          </div>
        </Panel>
        </div>

        {/* Правая колонка задаёт высоту строки грида, а левый бокс «Списания»
            (lg:absolute) к ней привязан. min-h держит обе колонки повыше, чтобы
            в «Списаниях» было видно больше строк — тонкими они смотрелись бедно. */}
        <div className="flex flex-col gap-3.5 lg:min-h-[440px]">
          <Panel className="p-4 sm:p-6">
            <PanelHead icon={<IconBox color="#ce6e58" />} tint="bg-rust-t" title="По типам" />
            <div className="mt-4">
              {grouped.length === 0 ? (
                <Empty>Нет данных.</Empty>
              ) : (
                grouped.map((g) => (
                  <div key={g.name} className="mb-3.5 flex items-center gap-3">
                    <span className="w-[110px] shrink-0 text-[12.5px] text-soft">{g.name}</span>
                    <Meter value={g.cents} max={worst} color={g.color} />
                    <span className="n w-14 text-right text-[12px] text-mid">{usd(g.cents)}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>

          {canEdit ? (
          <Panel className="p-4 sm:p-6">
            <PanelHead
              icon={<IconBox color="#ce6e58" />}
              tint="bg-rust-t"
              title="По баерам"
              aside={<span className="text-[12.5px] text-mute">уйдёт из профита</span>}
            />
            <div className="mt-4">
              {perBuyer.length === 0 ? (
                <Empty>Нет данных.</Empty>
              ) : (
                perBuyer.map((b) => (
                  <div key={b.handle} className="mb-3.5 flex items-center gap-3">
                    <span className="flex w-[110px] shrink-0 items-center gap-2 text-[12.5px] text-soft">
                      <Avatar initials={b.initials} color={b.color} size={24} />
                      {b.handle}
                    </span>
                    <Meter value={b.cents} max={heaviest} color="#ce6e58" />
                    <span className="n w-14 text-right text-[12px] text-mid">{usd(b.cents)}</span>
                  </div>
                ))
              )}
            </div>
          </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
