import { requireUser } from '@/lib/auth';
import { currentPeriodKey, teamSummary, defaultTiers } from '@/lib/queries';
import { canSeeTeam, type Role } from '@/lib/roles';
import { periodLabel } from '@/lib/period';
import { usd } from '@/lib/money';
import { parseTiers } from '@/lib/salary';
import Mountain, { type Climber } from '@/components/Mountain';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { IconRoute } from '@/components/icons';

/** Bearings are spread so pins never stack; the leader always takes the summit. */
const BEARINGS = [0, 141, 44, 168, 24, 108, 200, 76, 250, 12];
const STEMS = [96, 78, 74, 84, 70, 80, 72, 88, 76, 82];

export default async function PeakPage() {
  const user = await requireUser();
  const key = await currentPeriodKey();
  const summary = await teamSummary(key);
  const tiers = summary.buyers[0]
    ? parseTiers(summary.buyers[0].buyer.salaryRule?.tiersJson)
    : await defaultTiers();

  const ranked = summary.buyers.filter((b) => b.profitCents > 0);
  if (ranked.length === 0) {
    return <Empty>За {periodLabel(key)} ещё нет ни одного плюсового баера — гора пустая.</Empty>;
  }

  const climbers: Climber[] = ranked.map((row, i) => ({
    id: row.buyer.id,
    initials: row.buyer.initials,
    handle: row.buyer.handle,
    profitCents: row.profitCents,
    color: row.buyer.color,
    angle: BEARINGS[i % BEARINGS.length],
    stem: STEMS[i % STEMS.length],
  }));

  const viewerId = canSeeTeam(user.role as Role) ? (user.buyer?.id ?? null) : (user.buyer?.id ?? null);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="px-6 pb-2 pt-5">
        <PanelHead
          icon={<IconRoute color="#6fa9a0" />}
          tint="bg-teal-t"
          title="Вершина"
          aside={<span className="text-[15px] text-sage">{periodLabel(key)}</span>}
          right={
            <span className="text-[12.5px] text-mute">
              высота склона = чистый профит · пунктир справа — пороги ставки
            </span>
          }
        />
        <Mountain climbers={climbers} tiers={tiers} viewerId={viewerId} />
      </Panel>

      <div className="grid gap-3.5" style={{ gridTemplateColumns: `repeat(${Math.min(5, ranked.length)}, minmax(0, 1fr))` }}>
        {ranked.slice(0, 5).map((row, i) => {
          const leadCents = ranked[0].profitCents;
          return (
            <Panel key={row.buyer.id} className="p-5">
              <div className="flex items-baseline gap-3">
                <span className="n text-[11px] text-mute">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-[20px] font-bold tracking-[-0.01em]">{row.buyer.handle}</span>
              </div>
              <div
                className="n mt-3 text-[28px] font-bold tracking-[-0.03em]"
                style={{ color: row.buyer.color }}
              >
                {usd(row.profitCents, { round: true })}
              </div>
              <div className="mt-2.5 h-1.5 rounded-full bg-sub">
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.max(2, (row.profitCents / leadCents) * 100)}%`,
                    background: row.buyer.color,
                  }}
                />
              </div>
              <div className="mt-3 flex items-baseline justify-between">
                <span className="lab">Ставка</span>
                <span className="n text-[13px]" style={{ color: row.ratePct ? '#b4c68c' : '#ce6e58' }}>
                  {row.ratePct ? `${row.ratePct}%` : '—'}
                </span>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-mute">
                {i === 0
                  ? 'вершина периода'
                  : row.next
                    ? `до ${usd(row.next.fromCents, { round: true })} не хватает ${usd(row.next.needCents, { round: true })} — это +${usd(row.next.gainCents, { round: true })}`
                    : 'верхняя ставка взята'}
              </p>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
