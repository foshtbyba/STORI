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

/** Кольцо у самой подошвы и полоса с насечками снаружи от него. */
const BASE = 378;
const RING = BASE + 46;
const VIEW = { x: 0, y: 148, w: 1400, h: 778 };

/** Ступени рельефа снизу вверх: чем выше, тем светлее. Только сплошные цвета. */
function bandFill(level: number) {
  const t = Math.max(0, Math.min(1, level));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * Math.pow(t, 0.85));
  return `rgb(${mix(30, 58)} ${mix(30, 58)} ${mix(31, 60)})`;
}

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

  // Тропа не идёт по прямой: к дуге добавлены две гармоники и лёгкая
  // неровность по высоте — получается серпантин, а не подъём по линейке.
  const ray = (from: number, to: number, fromAng: number, toAng: number, wobble: number, steps: number) => {
    let d = '';
    const marks: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      const swing =
        Math.sin(f * Math.PI * 2.6) * wobble +
        Math.sin(f * Math.PI * 6.3 + 1.2) * wobble * 0.42 +
        Math.sin(f * Math.PI * 11.7 + 0.4) * wobble * 0.16;
      const lift = Math.sin(f * Math.PI * 4.1 + 0.7) * 0.012;
      const [x, y] = terrain.surfacePoint(
        fromAng + f * (toAng - fromAng) + swing,
        Math.max(0.02, Math.min(0.99, from + f * (to - from) + lift)),
      );
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      if (i % Math.round(steps / 3) === 0) marks.push({ x, y });
    }
    return { d, marks };
  };

  const covered = viewer
    ? ray(0.09, viewerOnTop ? 0.985 : viewerLevel!, 52, viewerOnTop ? 178 : viewer.angle, 22, 64)
    : null;
  const remaining =
    viewer && !viewerOnTop
      ? ray(viewerLevel!, 0.975, viewer.angle, viewer.angle + 58, 20, 44).d +
        `L${terrain.summit[0].toFixed(1)} ${terrain.summit[1].toFixed(1)}`
      : '';

  /**
   * Компас собран как на карте: у подошвы горы идёт тонкое кольцо, а снаружи по
   * его периметру — полоса насечек. В полосе оставлены разрывы, и в них сидят
   * стороны света.
   */
  const CARDINAL_DEGS = [208, 332, 28, 152];

  /** Кратчайшее угловое расстояние до ближайшей буквы, в градусах. */
  const gapTo = (deg: number) =>
    Math.min(...CARDINAL_DEGS.map((c) => Math.abs(((((deg - c) % 360) + 540) % 360) - 180)));

  /**
   * Внешняя нормаль к эллипсу. Радиус тут не годится: у сплющенного круга
   * насечка по радиусу выходит длинной сбоку и коротышкой сверху.
   */
  const normal = (a: number): [number, number] => {
    const nx = Math.cos(a);
    const ny = Math.sin(a) / squash;
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len, ny / len];
  };
  const onRing = (a: number): [number, number] => [
    centre.x + BASE * Math.cos(a),
    centre.y + BASE * squash * Math.sin(a),
  ];

  const ticks = Array.from({ length: 180 }, (_, i) => i * 2)
    .filter((deg) => gapTo(deg) > 13)
    .map((deg) => {
      const a = (deg * Math.PI) / 180;
      const major = Math.round(deg) % 10 === 0;
      const [nx, ny] = normal(a);
      const [px, py] = onRing(a);
      const from = 7;
      const to = from + (major ? 26 : 13);
      return {
        deg,
        x1: px + nx * from,
        y1: py + ny * from,
        x2: px + nx * to,
        y2: py + ny * to,
        c: major ? '#c0c0c0' : '#787878',
        w: major ? 2.6 : 1.7,
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

  /**
   * Стороны света — обычные прямые буквы в разрывах насечек, как на карте.
   * Никаких поворотов и сплющиваний: любой наклон на этом ракурсе кладёт букву
   * набок, а читаться она должна с первого взгляда.
   */
  const cardinals = CARDINAL_DEGS.map((deg, i) => {
    const a = (deg * Math.PI) / 180;
    const [nx, ny] = normal(a);
    const [px, py] = onRing(a);
    return {
      t: ['W', 'N', 'E', 'S'][i],
      x: px + nx * 26,
      y: py + ny * 26,
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
        {/* Кольцо у подошвы; полоса насечек идёт снаружи от него. */}
        <ellipse cx={centre.x} cy={centre.y} rx={BASE} ry={BASE * squash} fill="none"
          stroke="#5e9a93" strokeWidth={1.7} opacity={0.95} />

        {cardinals.map((c) => (
          <text key={c.t} transform={`translate(${c.x} ${c.y}) skewX(-10)`}
            textAnchor="middle" dominantBaseline="middle"
            fill="#e4e4e4" stroke="#1c1c1d" strokeWidth={9} paintOrder="stroke"
            fontFamily="var(--font-sans), sans-serif" fontSize={42} fontWeight={700} opacity={0.9}>
            {c.t}
          </text>
        ))}

        {terrain.bands.map((b, i) => (
          <path
            key={i}
            d={b.d}
            fillRule="evenodd"
            fill={bandFill(b.level)}
            stroke={b.index ? '#b4b4b4' : '#6b6b6b'}
            strokeWidth={b.index ? 1.25 : 0.8}
            strokeLinejoin="round"
          />
        ))}

        {/* Пройденное — сплошной серой нитью, оставшееся до вершины — белым
            пунктиром: видно, где ты уже был и сколько ещё идти. */}
        {covered ? (
          <path d={covered.d} fill="none" stroke="#7a7a7a" strokeWidth={2.4}
            strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
        ) : null}
        {remaining ? (
          <path d={remaining} fill="none" stroke="#f0f0f0" strokeWidth={2.8} strokeDasharray="10 8"
            strokeLinecap="round" strokeLinejoin="round" opacity={0.95} />
        ) : null}
        {covered?.marks.map((m, i) => (
          <circle key={i} cx={m.x} cy={m.y} r={3.2} fill="#8a8a8a" opacity={0.9} />
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
