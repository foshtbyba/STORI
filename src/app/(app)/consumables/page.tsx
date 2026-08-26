import { requireUser, scopeBuyerId } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import { periodBounds, periodLabel, fmtDay } from '@/lib/period';
import { usd, sum } from '@/lib/money';
import { addConsumable, deleteConsumable } from '@/app/actions/catalog';
import { Panel, PanelHead, Avatar, Empty } from '@/components/ui';
import { Meter } from '@/components/Charts';
import { IconBox } from '@/components/icons';

export default async function ConsumablesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const { period } = await searchParams;
  const key = period ?? (await currentPeriodKey());
  const { from, to } = periodBounds(key);
  const scoped = scopeBuyerId(user);

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
  const today = new Date().toISOString().slice(0, 10);
  const field = 'rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none';

  return (
    <div className="flex flex-col gap-3.5">
      <form action={addConsumable} className="grid grid-cols-[repeat(5,1fr)_auto] gap-3 rounded-[26px] border border-line bg-panel p-5">
        <input type="date" name="date" defaultValue={today} className={`n ${field}`} />
        <select name="typeId" required className={field}>
          {types.map((t) => (
            <option key={t.id} value={t.id} className="bg-panel">{t.name}</option>
          ))}
        </select>
        {scoped ? null : (
          <select name="buyerId" className={field}>
            <option value="" className="bg-panel">на команду</option>
            {buyers.map((b) => (
              <option key={b.id} value={b.id} className="bg-panel">{b.handle}</option>
            ))}
          </select>
        )}
        <input name="qty" type="number" min={1} defaultValue={1} className={`n ${field}`} placeholder="шт" />
        <input name="total" inputMode="decimal" className={`n ${field}`} placeholder="сумма, $" required />
        <button type="submit" className="rounded-full bg-sage px-6 text-[13px] font-semibold text-bg">
          Списать
        </button>
      </form>

      <div className="grid grid-cols-[1.7fr_1fr] gap-3.5">
        <Panel className="p-6">
          <PanelHead
            icon={<IconBox color="#ce6e58" />}
            tint="bg-rust-t"
            title="Списания"
            aside={<span className="text-[12.5px] text-mute">{periodLabel(key)}</span>}
            right={
              <span className="n text-[17px] font-semibold text-rust">
                {usd(sum(entries, (e) => e.totalCents))}
              </span>
            }
          />
          <div className="mt-4 grid grid-cols-[0.6fr_1.2fr_1.2fr_1.6fr_0.7fr] pb-2.5">
            <span className="lab">Дата</span>
            <span className="lab">Тип</span>
            <span className="lab">На кого</span>
            <span className="lab">Комментарий</span>
            <span className="lab text-right">Сумма</span>
          </div>
          {entries.length === 0 ? (
            <Empty>За {periodLabel(key)} списаний нет.</Empty>
          ) : (
            entries.map((e) => (
              <div key={e.id} className="grid grid-cols-[0.6fr_1.2fr_1.2fr_1.6fr_0.7fr] items-center border-t border-line py-2.5">
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
                    <span className="text-mute">команда</span>
                  )}
                </span>
                <span className="truncate text-[12.5px] text-mute">
                  {e.qty > 1 ? `${e.qty} шт · ` : ''}
                  {e.note || '—'}
                </span>
                <span className="flex items-center justify-end gap-3">
                  <span className="n text-[13.5px]">{usd(e.totalCents)}</span>
                  <form action={deleteConsumable}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                  </form>
                </span>
              </div>
            ))
          )}
        </Panel>

        <Panel className="p-6">
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
      </div>
    </div>
  );
}
