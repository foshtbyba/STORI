import { requireUser } from '@/lib/auth';
import { currentPeriodKey, teamSummary, defaultTiers } from '@/lib/queries';
import { periodLabel } from '@/lib/period';
import { usd } from '@/lib/money';
import { parseTiers } from '@/lib/salary';
import { DEFAULT_TERRAIN, weekSeed } from '@/lib/terrain';
import Mountain, { type Climber } from '@/components/Mountain';
import Tilt from '@/components/Tilt';
import { Panel, PanelHead, Sub, Avatar, Empty } from '@/components/ui';
import { IconRoute, IconPeak } from '@/components/icons';

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

  const viewerId = user.buyer?.id ?? null;
  // Вершина привязана к верхнему порогу лесенки, а не к лидеру: на пик встаёт
  // тот, кто его взял, а не тот, кто просто оказался первым среди своих.
  const summitCents = tiers[tiers.length - 1]?.fromCents ?? 1_000_000;
  const leadCents = Math.max(ranked[0].profitCents, 1);
  const viewer = ranked.find((r) => r.buyer.id === viewerId) ?? null;
  const viewerPlace = viewer ? ranked.findIndex((r) => r.buyer.id === viewerId) + 1 : 0;
  const onTop = Boolean(viewer) && viewer!.profitCents >= summitCents;
  const toPeak = viewer ? Math.max(0, summitCents - viewer.profitCents) : 0;

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-3.5">
        {viewer ? (
          <Panel className="p-6" >
            <span
              className="flex h-[42px] w-[42px] items-center justify-center rounded-full"
              style={{ background: onTop ? '#252e1e' : '#232324' }}
            >
              <svg
                width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke={onTop ? '#b4c68c' : '#e4e4e4'} strokeWidth={2.2} strokeLinejoin="round" aria-hidden
              >
                <path d={onTop ? 'M6 12l4 4 8-8' : 'M6 20V5l11 3.5L6 12'} />
              </svg>
            </span>
            <p
              className="mt-4 text-[19px] font-bold leading-snug tracking-[-0.015em]"
              style={{ color: onTop ? '#b4c68c' : '#e4e4e4' }}
            >
              {onTop ? 'Ты на вершине. Не падай, чемпион )' : 'Твой путь наверх'}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Sub className="px-4 py-3">
                <div className="lab">Пройдено</div>
                <div className="n mt-1.5 text-[20px] font-semibold">
                  {usd(viewer.profitCents, { round: true })}
                </div>
              </Sub>
              <Sub className="px-4 py-3">
                <div className="lab">{onTop ? 'Сверх вершины' : 'До вершины'}</div>
                <div
                  className="n mt-1.5 text-[20px] font-semibold"
                  style={{ color: onTop ? '#b4c68c' : '#ce6e58' }}
                >
                  {onTop
                    ? usd(viewer.profitCents - summitCents, { round: true })
                    : usd(toPeak, { round: true })}
                </div>
              </Sub>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="lab">Место в команде</span>
              <span className="n text-[13.5px]">
                {viewerPlace} из {ranked.length}
              </span>
            </div>
            {viewer.next ? (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
                До ставки {viewer.next.ratePct}% не хватает{' '}
                <span className="n text-soft">{usd(viewer.next.needCents, { round: true })}</span> — это
                плюс <span className="n text-sage">{usd(viewer.next.gainCents, { round: true })}</span> к
                выплате.
              </p>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
                Верхняя ставка взята — не упади!
              </p>
            )}
          </Panel>
        ) : null}

        <Panel className="p-6">
          <PanelHead
            icon={<IconPeak color="#6fa9a0" size={18} />}
            tint="bg-teal-t"
            title="Восхождение"
            aside={
              <span className="text-[12.5px] text-mute">
                вершина — {usd(summitCents, { round: true })}
              </span>
            }
          />
          <div className="mt-4">
            {ranked.map((row, i) => {
              const me = row.buyer.id === viewerId;
              return (
                <div key={row.buyer.id} className="border-t border-line py-3 first:border-t-0 first:pt-0">
                  <div className="flex items-center gap-3">
                    <span className="n w-5 shrink-0 text-[11px] text-mute">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <Avatar initials={row.buyer.initials} color={row.buyer.color} size={28} />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">
                      {row.buyer.handle}
                      {me ? <span className="ml-2 text-[11px] text-sage">ты</span> : null}
                    </span>
                    <span
                      className="n shrink-0 text-[15px] font-semibold"
                      style={{ color: row.buyer.color }}
                    >
                      {usd(row.profitCents, { round: true })}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 pl-8">
                    <span className="h-1.5 min-w-0 flex-1 rounded-full bg-sub">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{
                          width: `${Math.max(3, (row.profitCents / leadCents) * 100)}%`,
                          background: row.buyer.color,
                        }}
                      />
                    </span>
                    <span
                      className="n w-9 shrink-0 text-right text-[11.5px]"
                      style={{ color: row.ratePct ? '#b4c68c' : '#ce6e58' }}
                    >
                      {row.ratePct ? `${row.ratePct}%` : '—'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

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
        <Tilt>
          <Mountain
            climbers={climbers}
            tiers={tiers}
            viewerId={viewerId}
            config={{ ...DEFAULT_TERRAIN, seed: weekSeed() }}
          />
        </Tilt>
      </Panel>
    </div>
  );
}
