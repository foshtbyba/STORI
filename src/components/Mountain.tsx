import { getTerrain, DEFAULT_TERRAIN, type TerrainConfig } from '@/lib/terrain';
import { usd } from '@/lib/money';
import type { Tier } from '@/lib/salary';

export type Climber = {
  id: string;
  initials: string;
  handle: string;
  profitCents: number;
  color: string;
  /** Bearing in degrees the pin is planted on; keeps markers off each other. */
  angle: number;
  stem: number;
};

const RING = 472;
const VIEW = { x: 0, y: 60, w: 1400, h: 790 };

/**
 * Altitude is profit. Everything else on this drawing — the tier rules, the
 * climber pins, the route — is placed by asking the terrain where its surface
 * is at a given height, so a marker can never float off the slope it reports.
 */
export default function Mountain({
  climbers,
  tiers,
  viewerId,
  config = DEFAULT_TERRAIN,
}: {
  climbers: Climber[];
  tiers: Tier[];
  viewerId?: string | null;
  config?: TerrainConfig;
}) {
  const terrain = getTerrain(config);
  const { centre, squash, height: HMAX } = config;
  // Вершина — не «лучший из присутствующих», а верхний порог лесенки. Иначе
  // человек с сотней долларов стоял бы на пике только потому, что он один, и
  // пороги ставок уезжали бы за пределы горы.
  const summitCents = Math.max(1, tiers[tiers.length - 1]?.fromCents ?? 1_000_000);

  // Взявших верхний порог может быть несколько; на сам пик ставим лучшего,
  // остальные держатся чуть ниже на своих азимутах, иначе метки слипаются.
  const leader = climbers.reduce((a, b) => (b.profitCents > a.profitCents ? b : a), climbers[0]);

  const pins = climbers.map((c) => {
    const level = Math.max(0.02, Math.min(1, c.profitCents / summitCents));
    // На пик встаёт только тот, кто действительно взял верхний порог.
    const isTop = c.profitCents >= summitCents;
    const atSummit = isTop && c.id === leader?.id;
    const [sx, sy] = atSummit
      ? terrain.summit
      : terrain.surfacePoint(c.angle, Math.min(level, 0.92));
    // Чем выше метка, тем короче ножка: у вершины длинная выносила подпись
    // прямо на чужую метку.
    const stem = atSummit ? c.stem : c.stem * (0.38 + 0.62 * (1 - level));
    const py = sy - stem;
    const me = c.id === viewerId;
    return {
      ...c, sx, sy, py, me, isTop,
      left: (sx / VIEW.w) * 100,
      top: ((py - VIEW.y) / VIEW.h) * 100,
    };
  });

  const viewer = pins.find((p) => p.me) ?? null;
  const viewerOnTop = viewer?.isTop ?? false;
  const viewerLevel = viewer
    ? Math.min(0.985, Math.max(0.09, viewer.profitCents / summitCents))
    : null;

  const ray = (from: number, to: number, fromAng: number, toAng: number, wobble: number, steps: number) => {
    let d = '';
    const marks: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const [x, y] = terrain.surfacePoint(
        fromAng + f * (toAng - fromAng) + Math.sin(f * Math.PI * 2.6) * wobble,
        from + f * (to - from),
      );
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      if (i % Math.round(steps / 3) === 0) marks.push({ x, y });
    }
    return { d, marks };
  };

  const covered = viewer
    ? ray(0.09, viewerOnTop ? 0.985 : viewerLevel!, 52, viewerOnTop ? 178 : viewer.angle, 14, 48)
    : null;
  const remaining =
    viewer && !viewerOnTop
      ? ray(viewerLevel!, 0.975, viewer.angle, viewer.angle + 46, 12, 32).d +
        `L${terrain.summit[0].toFixed(1)} ${terrain.summit[1].toFixed(1)}`
      : '';

  const ticks = Array.from({ length: 240 }, (_, i) => {
    const a = (i * 1.5 * Math.PI) / 180;
    const big = i % 20 === 0;
    const major = i % 4 === 0;
    const inner = big ? 434 : major ? 446 : 456;
    return {
      x1: centre.x + inner * Math.cos(a), y1: centre.y + inner * squash * Math.sin(a),
      x2: centre.x + RING * Math.cos(a), y2: centre.y + RING * squash * Math.sin(a),
      c: big ? '#9c9c9c' : major ? '#6e6e6e' : '#454545',
      w: big ? 1.5 : 1,
    };
  });

  const rules = tiers
    .filter((t, i, all) => all.findIndex((o) => o.ratePct === t.ratePct) === i)
    .map((tier) => {
      const level = tier.fromCents / summitCents;
      return {
        y: centre.y - level * HMAX,
        x1: level <= 1 ? terrain.rightEdge(Math.min(level, 0.99)) + 16 : centre.x,
        label: usd(tier.fromCents, { round: true }),
        rate: `ставка ${tier.ratePct}%`,
        color: tier.ratePct >= 50 ? '#b4c68c' : '#a8a8a8',
        visible: level <= 1,
      };
    })
    .filter((r) => r.visible);

  // Стороны света лежат в плоскости пола: сначала точка на кольце, потом тот же
  // изометрический сплющ, что и у самой площадки. Никаких поворотов — от них
  // буквы и висели криво, каждая под своим углом.
  const cardinals = [
    { t: 'W', deg: 225 },
    { t: 'N', deg: 315 },
    { t: 'E', deg: 45 },
    { t: 'S', deg: 135 },
  ].map(({ t, deg }) => {
    const a = (deg * Math.PI) / 180;
    const out = RING + 46;
    return {
      t,
      x: centre.x + out * Math.cos(a),
      y: centre.y + out * squash * Math.sin(a),
    };
  });

  return (
    <div className="relative mt-0.5">
      <svg viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`} className="block h-auto w-full">
        <defs>
          <radialGradient id="peak-glow" cx="0.5" cy="0.63" r="0.56">
            <stop offset="0%" stopColor="#2e2e2f" stopOpacity="0.72" />
            <stop offset="100%" stopColor="#2e2e2f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <ellipse cx={centre.x} cy={centre.y} rx={520} ry={204} fill="url(#peak-glow)" />

        {ticks.map((t, i) => (
          <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.c} strokeWidth={t.w} />
        ))}
        <ellipse cx={centre.x} cy={centre.y} rx={RING} ry={RING * squash} fill="none"
          stroke="#5e9a93" strokeWidth={1.4} opacity={0.85} />

        {cardinals.map((c) => (
          <text key={c.t} transform={`translate(${c.x} ${c.y}) scale(1 ${squash})`}
            textAnchor="middle" dominantBaseline="middle"
            fill="#e4e4e4" stroke="#1c1c1d" strokeWidth={14} paintOrder="stroke"
            fontFamily="var(--font-sans), sans-serif" fontSize={76} fontWeight={700} opacity={0.8}>
            {c.t}
          </text>
        ))}

        <path d={terrain.fills.base} fill="#1f1f20" />
        <path d={terrain.fills.mid} fill="#232324" />
        <path d={terrain.fills.snow} fill="#292929" />
        {terrain.contours.map((c, i) => (
          <path key={i} d={c.d} fill="none" strokeLinejoin="round"
            stroke={c.index ? '#a6a6a6' : '#5c5c5c'} strokeWidth={c.index ? 1.15 : 0.75} />
        ))}

        {covered ? (
          <path d={covered.d} fill="none" stroke="#e4e4e4" strokeWidth={2.6} strokeDasharray="9 7"
            strokeLinecap="round" opacity={0.92} />
        ) : null}
        {remaining ? (
          <path d={remaining} fill="none" stroke="#8a8a8a" strokeWidth={2} strokeDasharray="3 8"
            strokeLinecap="round" opacity={0.7} />
        ) : null}
        {covered?.marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={3.4} fill="#e4e4e4" opacity={0.85} />
        ))}

        <line x1={1300} y1={centre.y - HMAX} x2={1300} y2={centre.y} stroke="#2e2e2f" strokeWidth={1} />
        {rules.map((r) => (
          <g key={r.label}>
            <line x1={r.x1} y1={r.y} x2={1290} y2={r.y} stroke={r.color} strokeWidth={1.1}
              strokeDasharray="3 8" opacity={0.7} />
            <line x1={1294} y1={r.y} x2={1306} y2={r.y} stroke={r.color} strokeWidth={1.8} />
            <text x={1316} y={r.y + 4} fill={r.color} fontFamily="var(--font-mono), monospace" fontSize={13}>
              {r.label}
            </text>
            <text x={1316} y={r.y + 21} fill="#767676" fontFamily="var(--font-sans), sans-serif"
              fontSize={11.5} fontWeight={600}>
              {r.rate}
            </text>
          </g>
        ))}

        {pins.map((p) => (
          <g key={p.id}>
            <ellipse cx={p.sx} cy={p.sy} rx={10} ry={3.6} fill="#141414" opacity={0.7} />
            <line x1={p.sx} y1={p.sy} x2={p.sx} y2={p.py + 17} stroke={p.color} strokeWidth={1.7} />
            <circle cx={p.sx} cy={p.sy} r={3.2} fill={p.color} />
          </g>
        ))}
      </svg>

      {pins.map((p) => (
        <div key={p.id}>
          <div
            className="n absolute flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11.5px] font-bold"
            style={{
              left: `${p.left}%`, top: `${p.top}%`,
              background: p.me ? p.color : '#1f1f20',
              color: p.me ? '#1c1c1d' : p.color,
              border: `2px solid ${p.color}`,
              boxShadow: '0 0 0 4px #1c1c1d',
            }}
            title={p.handle}
          >
            {p.initials}
          </div>
          <div
            className="n absolute whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
            style={{
              left: `${p.left}%`, top: `${p.top}%`,
              transform: 'translate(-50%, calc(-50% - 35px))',
              background: '#232324',
              border: `1px solid ${p.me ? p.color : '#2e2e2f'}`,
              color: p.me ? p.color : '#a8a8a8',
            }}
          >
            {p.me ? 'ты · ' : ''}
            {usd(p.profitCents, { round: true })}
          </div>
        </div>
      ))}

    </div>
  );
}
