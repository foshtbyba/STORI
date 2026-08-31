import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary, defaultTiers, allTimeProfit } from '@/lib/queries';
import { periodRange, periodTitle } from '@/lib/period';
import { usd } from '@/lib/money';
import { parseTiers } from '@/lib/salary';
import { DEFAULT_TERRAIN, weekSeed, getTerrain } from '@/lib/terrain';
import Peak3D, { type Pin3D, type Rule3D, type Route3D } from '@/components/Peak3D';
import type { Grounded } from '@/components/Mountain';
import { Panel, PanelHead, Sub, Avatar, Empty } from '@/components/ui';
import { IconRoute, IconPeak } from '@/components/icons';

/** Bearings are spread so pins never stack; the leader always takes the summit. */
const BEARINGS = [0, 141, 44, 168, 24, 108, 200, 76, 250, 12];
const STEMS = [96, 78, 74, 84, 70, 80, 72, 88, 76, 82];

export default async function PeakPage() {
  const user = await requireUser();
  // Гора недельная: в понедельник склон обнуляется и все стартуют заново.
  const key = await currentPeriodKey();
  const week = periodRange(key);
  const label = periodTitle(key);
  const summary = await teamSummary(key, week);
  // Овнеров тоже рисуем на горе — но без суммы: видно, где они, не видно
  // сколько принесли.
  const ownerSummary = await teamSummary(key, week, { owners: true });
  // Неделя показывает форму, а общий минус — сколько человек должен вообще.
  const allTime = await allTimeProfit();
  const tiers = summary.buyers[0]
    ? parseTiers(summary.buyers[0].buyer.salaryRule?.tiersJson)
    : await defaultTiers();

  const team = canSeeTeam(user.role as Role);
  const ranked = summary.buyers.filter((b) => b.netCents > 0);
  // Ноль и минус на гору не выходят. В общем виде — без сумм: видно, что человек
  // не пошёл наверх, но не видно, насколько он в яме.
  const grounded: Grounded[] = summary.buyers
    .filter((b) => b.netCents <= 0)
    .map((b) => ({
      id: b.buyer.id,
      initials: b.buyer.initials,
      handle: b.buyer.handle,
      color: b.buyer.color,
      profitCents: team ? b.netCents : null,
      allTimeCents: team ? (allTime.get(b.buyer.id) ?? 0) : null,
    }));

  if (ranked.length === 0 && grounded.length === 0 && ownerSummary.buyers.length === 0) {
    return <Empty>За {label} отчётов ещё нет — гора пустая.</Empty>;
  }

  // Рельеф считаем здесь, а на клиент отдаём его в координатах площадки: там
  // он и проецируется, поэтому гору можно обойти вокруг.
  const terrain = getTerrain({ ...DEFAULT_TERRAIN, seed: weekSeed() });
  const viewerId = user.buyer?.id ?? null;
  /**
   * Вершина — ближайшая невзятая веха, а не всегда верх лесенки.
   *
   * Пока команда не дошла до верхнего порога, гора масштабируется под лидера:
   * пиком становится первый порог, который никто ещё не взял. Иначе в начале
   * месяца при $115 профита все стоят на одном проценте высоты у самой
   * подошвы — гора выглядит мёртвой, хотя цифры свежие. Отметки ставок при
   * этом остаются на своих настоящих суммах, просто те, что выше вершины,
   * пока не рисуем: дойдут до них — гора подрастёт сама.
   *
   * Взять свою же вершину так нельзя: порог выбирается строго выше лидера,
   * поэтому «ты на вершине» по-прежнему означает взятый верх лесенки.
   */
  const topCents = tiers[tiers.length - 1]?.fromCents ?? 1_000_000;
  const bestCents = ranked.reduce((max, r) => Math.max(max, r.netCents), 0);
  const summitCents = tiers.find((t) => t.fromCents > bestCents)?.fromCents ?? topCents;
  const scaled = summitCents < topCents;
  const leader = ranked[0];

  const pins: Pin3D[] = ranked.map((row, i) => {
    const level = Math.max(0.02, Math.min(1, row.netCents / summitCents));
    const onTop = row.netCents >= summitCents;
    const atSummit = onTop && row.buyer.id === leader.buyer.id;
    const angle = BEARINGS[i % BEARINGS.length];
    const [u, v, at] = atSummit
      ? [terrain.raw.summit[0], terrain.raw.summit[1], 0.975]
      : terrain.surfaceUV(angle, Math.min(level, 0.92));
    const stem = STEMS[i % STEMS.length];
    return {
      id: row.buyer.id,
      initials: row.buyer.initials,
      handle: row.buyer.handle,
      color: row.buyer.color,
      profitCents: row.netCents,
      u,
      v,
      level: at,
      stem: atSummit ? stem * 0.6 : stem * (0.38 + 0.62 * (1 - level)),
      me: row.buyer.id === viewerId,
      strong: viewerId === null || row.buyer.id === viewerId,
      onTop,
    };
  });

  // Овнеры на склоне — на своей реальной высоте (профит / вершина), как баеры,
  // тоже поднимаются, но сумму на метке не показываем.
  const OWNER_BEARINGS = [58, 206, 128, 292, 96, 244];
  const ownerPins: Pin3D[] = ownerSummary.buyers.map((row, i) => {
    const level = row.netCents > 0 ? Math.max(0.05, Math.min(1, row.netCents / summitCents)) : 0.06;
    const angle = OWNER_BEARINGS[i % OWNER_BEARINGS.length];
    const [u, v, at] = terrain.surfaceUV(angle, Math.min(level, 0.92));
    const stem = STEMS[(i + 3) % STEMS.length];
    return {
      id: `owner-${row.buyer.id}`,
      initials: row.buyer.initials,
      handle: row.buyer.handle,
      color: row.buyer.color,
      profitCents: row.netCents,
      u,
      v,
      level: at,
      stem: stem * (0.38 + 0.62 * (1 - level)),
      me: false,
      strong: true,
      onTop: false,
      hideProfit: true,
    };
  });
  const allPins = [...pins, ...ownerPins];

  const leadCents = Math.max(ranked[0]?.netCents ?? 1, 1);
  const viewer = summary.buyers.find((r) => r.buyer.id === viewerId) ?? null;
  const climbing = Boolean(viewer && viewer.netCents > 0);
  const viewerPlace = climbing ? ranked.findIndex((r) => r.buyer.id === viewerId) + 1 : 0;
  const onTop = Boolean(viewer) && viewer!.netCents >= summitCents;
  const toPeak = viewer ? Math.max(0, summitCents - viewer.netCents) : 0;

  const RING = terrain.config.radius + 26;

  /**
   * Тропа по склону: серпантин из троек u, v, level.
   *
   * `switchback` включает разворот в начале: тропа уходит вверх, возвращается
   * почти к точке старта и только потом идёт наверх — как настоящая петля на
   * подъёме. `toUV` притягивает хвост к заданной точке, чтобы маршрут не
   * заканчивался отрезком по воздуху мимо макушки.
   */
  function trail(
    fromLevel: number,
    toLevel: number,
    fromAng: number,
    toAng: number,
    wobble: number,
    steps: number,
    opts: {
      switchback?: boolean;
      fromUV?: [number, number, number];
      toUV?: [number, number, number];
    } = {},
  ) {
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;

      // Возврат к старту: один раз, в первой трети подъёма.
      const loop = opts.switchback ? 0.26 * Math.sin(Math.PI * Math.min(1, f / 0.36)) : 0;
      const prog = Math.max(0, f - loop);

      // Виляние к концам приглушаем, но не в ноль: совсем прямые хвосты
      // выглядят мёртво. В начале, наоборот, добавляем размах.
      const taper = 0.38 + 0.62 * Math.sin(Math.PI * f) ** 0.7;
      const early = 1 + 1.6 * Math.exp(-((f / 0.3) ** 2));
      const swing =
        (Math.sin(f * Math.PI * 2.6) * wobble +
          Math.sin(f * Math.PI * 6.3 + 1.2) * wobble * 0.42 +
          Math.sin(f * Math.PI * 11.7 + 0.4) * wobble * 0.16) *
        taper *
        early;
      const lift = Math.sin(f * Math.PI * 4.1 + 0.7) * 0.012 * taper;

      const want = Math.max(0.02, Math.min(0.99, fromLevel + prog * (toLevel - fromLevel) + lift));
      // Берём высоту, на которой точка реально легла на склон, а не ту, что
      // просили: иначе на пологом направлении линия уходит в воздух.
      let [u, v, level] = terrain.surfaceUV(fromAng + prog * (toAng - fromAng) + swing, want);

      // Хвост сходится к нужной точке у самого конца — и по координатам, и по
      // высоте. Тянуть только координаты бесполезно: точка встаёт над пиком
      // горизонтально, но остаётся на высоте своего луча, то есть на уступе.
      let z = level;
      if (opts.toUV && f > 0.86) {
        const w = (f - 0.86) / 0.14;
        const k = w * w * (3 - 2 * w);
        u += (opts.toUV[0] - u) * k;
        v += (opts.toUV[1] - v) * k;
        z += (opts.toUV[2] - z) * k;
      }
      // То же самое с головой тропы. Виляние на старте не гаснет в ноль, и
      // пунктир начинался в стороне от метки — получалось, что человек стоит
      // рядом со своим маршрутом, а не на нём.
      if (opts.fromUV && f < 0.14) {
        const w = 1 - f / 0.14;
        const k = w * w * (3 - 2 * w);
        u += (opts.fromUV[0] - u) * k;
        v += (opts.fromUV[1] - v) * k;
        z += (opts.fromUV[2] - z) * k;
      }
      out.push(u, v, z);
    }
    return out;
  }

  const myPin = pins.find((p) => p.me) ?? null;
  // Тропа кончается ровно там, где стоит метка, а не на условной отметке:
  // иначе у того, кто только начал, путь обрывался выше его собственного пина.
  const myLevel = myPin ? Math.min(0.985, myPin.level) : null;
  // Подъём всегда идёт снизу вверх — старт берём ниже метки, даже если она
  // сама почти у подножия.
  const footLevel = myPin ? Math.min(0.09, Math.max(0.02, myPin.level * 0.55)) : 0.09;
  const myAngle = myPin ? BEARINGS[pins.indexOf(myPin) % BEARINGS.length] : 0;
  // Азимут самой вершины: к ней и ведём хвост, иначе тропа лезет по гребню,
  // который до пика не дотягивается, и упирается в уступ.
  const summitAngle =
    (Math.atan2(terrain.raw.summit[1], terrain.raw.summit[0]) * 180) / Math.PI;
  // Идём к вершине по короткой дуге, а не через полкруга.
  const sweep = ((summitAngle - myAngle + 540) % 360) - 180;
  const route: Route3D | null = myPin
    ? {
        covered: trail(
          footLevel,
          myPin.onTop ? 0.985 : myLevel!,
          52,
          myPin.onTop ? 178 : myAngle,
          22,
          80,
          { switchback: true, toUV: [myPin.u, myPin.v, myPin.level] },
        ),
        remaining: myPin.onTop
          ? []
          : trail(myPin.level, 0.975, myAngle, myAngle + sweep, 16, 90, {
              fromUV: [myPin.u, myPin.v, myPin.level],
              toUV: [terrain.raw.summit[0], terrain.raw.summit[1], 0.975],
            }),
      }
    : null;

  const ruleMarks: Rule3D[] = tiers
    .filter((t, i, all) => all.findIndex((o) => o.ratePct === t.ratePct) === i)
    .map((tier) => ({
      level: tier.fromCents / summitCents,
      label: usd(tier.fromCents, { round: true }),
      rate: `ставка ${tier.ratePct}%`,
      color: '#8a8a8a',
      // Порог, который смотрящий уже взял, светится зелёным и на склоне.
      passed: Boolean(viewer && viewer.netCents >= tier.fromCents),
    }))
    .filter((r) => r.level <= 1);

  return (
    <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-3.5">
        {viewer ? (
          <Panel className="p-4 sm:p-6" >
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
              style={{ color: onTop ? '#b4c68c' : climbing ? '#e4e4e4' : '#ce6e58' }}
            >
              {onTop
                ? 'Ты на вершине. Не падай, чемпион )'
                : climbing
                  ? 'Твой путь наверх'
                  : 'Ты ещё у подножия'}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Sub className="px-4 py-3">
                <div className="lab">{climbing ? 'Пройдено' : 'Профит за период'}</div>
                <div
                  className="n mt-1.5 text-[20px] font-semibold"
                  style={{ color: climbing ? undefined : '#ce6e58' }}
                >
                  {usd(viewer.netCents, { sign: true })}
                </div>
              </Sub>
              <Sub className="px-4 py-3">
                <div className="lab">{onTop ? 'Сверх вершины' : 'До вершины'}</div>
                <div
                  className="n mt-1.5 text-[20px] font-semibold"
                  style={{ color: onTop ? '#b4c68c' : '#ce6e58' }}
                >
                  {onTop
                    ? usd(viewer.netCents - summitCents)
                    : usd(toPeak)}
                </div>
              </Sub>
            </div>
            <div className="mt-3 flex items-baseline justify-between">
              <span className="lab">Место в команде</span>
              <span className="n text-[13.5px]">
                {climbing ? `${viewerPlace} из ${ranked.length}` : 'вне зачёта'}
              </span>
            </div>
            {!climbing ? (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
                На склон выходят с первого плюса. В команде видно только то, что ты ещё внизу, —
                ни суммы, ни минуса там нет, это видишь один ты.
              </p>
            ) : viewer.next ? (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
                До ставки {viewer.next.ratePct}% не хватает{' '}
                <span className="n text-soft">{usd(viewer.next.needCents)}</span> —
                тогда выплата{' '}
                <span className="n text-sage">{usd(viewer.next.payoutThenCents)}</span>
                {viewer.next.fromOklad ? ' вместо оклада' : ` вместо ${usd(viewer.next.payoutNowCents)}`}.
              </p>
            ) : (
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
                Верхняя ставка взята — не упади!
              </p>
            )}
          </Panel>
        ) : null}

        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconPeak color="#6fa9a0" size={18} />}
            tint="bg-teal-t"
            title="Восхождение"
            aside={
              <span className="text-[12.5px] text-mute">
                вершина — {usd(summitCents, { round: true })}
                {scaled ? ` из ${usd(topCents, { round: true })}` : ''}
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
                      {usd(row.netCents)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 pl-8">
                    <span className="h-1.5 min-w-0 flex-1 rounded-full bg-sub">
                      <span
                        className="block h-1.5 rounded-full"
                        style={{
                          width: `${Math.max(3, (row.netCents / leadCents) * 100)}%`,
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

      <Panel className="px-4 pb-2 pt-4 sm:px-6 sm:pt-5">
        <PanelHead
          icon={<IconRoute color="#6fa9a0" />}
          tint="bg-teal-t"
          title="Вершина"
          aside={<span className="text-[15px] text-sage">{label}</span>}
          right={
            <span className="text-[12.5px] text-mute">
              высота склона = профит за вычетом расходников · пунктир справа — пороги ставки
            </span>
          }
        />
        <Peak3D
          terrain={terrain.raw}
          pins={allPins}
          route={route}
          rules={ruleMarks}
          ringRadius={RING}
        />
        {grounded.length > 0 ? (
          <div className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
            <span className="lab mr-1">У подножия</span>
            {grounded.map((g) => (
              <span key={g.id} className="flex items-center gap-2 rounded-full bg-sub py-1 pl-1 pr-3">
                <Avatar initials={g.initials} color={g.color} size={22} />
                <span className="text-[11.5px] text-dim">{g.handle}</span>
                {g.profitCents != null ? (
                  <span
                    className="n text-[11.5px]"
                    style={{ color: g.profitCents < 0 ? '#ce6e58' : '#8a8a8a' }}
                    title="За эту неделю"
                  >
                    {usd(g.profitCents, { sign: true })}
                  </span>
                ) : null}
                {g.allTimeCents != null && g.allTimeCents !== g.profitCents ? (
                  <span className="n text-[11px] text-dim" title="За всё время">
                    всего {usd(g.allTimeCents, { sign: true })}
                  </span>
                ) : null}
              </span>
            ))}
            <span className="text-[11px] text-dim">— ещё не вышли на маршрут</span>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
