import { requireTeamView } from '@/lib/auth';
import { currentPeriodKey, teamSummary, defaultTiers } from '@/lib/queries';
import { parseTiers } from '@/lib/salary';
import Mountain, { type Climber } from '@/components/Mountain';
import type { RingStyle } from '@/components/Compass';
import { Panel, Empty } from '@/components/ui';

const BEARINGS = [0, 141, 44, 168, 24, 108, 200, 76, 250, 12];
const STEMS = [96, 78, 74, 84, 70, 80, 72, 88, 76, 82];

const NAMES: Record<RingStyle, string> = {
  1: 'Кольцо у подошвы, гребёнка наружу, буквы прямые в разрывах',
  2: 'Две линии, гребёнка между ними, буквы лежат лицом к горе',
  3: 'Гребёнка внутрь, буквы снаружи в плоскости кольца',
  4: 'Минимал: кольцо и четыре засечки, крупные прямые буквы',
  5: 'Приборная шкала: плотная градуировка, буквы внутри кольца',
};

/** Временный экран для выбора кольца компаса. Уберём, когда вариант выбран. */
export default async function RingsPage() {
  await requireTeamView();
  const key = await currentPeriodKey();
  const summary = await teamSummary(key);
  const tiers = summary.buyers[0]
    ? parseTiers(summary.buyers[0].buyer.salaryRule?.tiersJson)
    : await defaultTiers();

  const ranked = summary.buyers.filter((b) => b.profitCents > 0);
  if (ranked.length === 0) return <Empty>Нет плюсовых баеров — гора пустая.</Empty>;

  const climbers: Climber[] = ranked.map((row, i) => ({
    id: row.buyer.id,
    initials: row.buyer.initials,
    handle: row.buyer.handle,
    profitCents: row.profitCents,
    color: row.buyer.color,
    angle: BEARINGS[i % BEARINGS.length],
    stem: STEMS[i % STEMS.length],
  }));

  const viewerId = ranked[Math.min(2, ranked.length - 1)].buyer.id;

  return (
    <div className="flex flex-col gap-3.5">
      {([1, 2, 3, 4, 5] as RingStyle[]).map((style) => (
        <Panel key={style} className="px-6 pb-2 pt-5">
          <div className="mb-1 flex items-baseline gap-3">
            <span className="n text-[24px] font-bold text-sage">{style}</span>
            <span className="text-[13.5px] text-soft">{NAMES[style]}</span>
          </div>
          <Mountain climbers={climbers} tiers={tiers} viewerId={viewerId} ringStyle={style} />
        </Panel>
      ))}
    </div>
  );
}
