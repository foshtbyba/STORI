/**
 * Кольцо компаса вокруг горы. Всё, что оно рисует, лежит в плоскости площадки:
 * точка берётся по азимуту, вертикаль сплющивается тем же коэффициентом.
 */

const CARDINALS = [
  { t: 'W', deg: 202 },
  { t: 'N', deg: 338 },
  { t: 'E', deg: 22 },
  { t: 'S', deg: 158 },
];

/**
 * Азимуты, равномерные по длине дуги, а не по углу. У сплющенного круга равный
 * шаг угла сгущает точки у левого и правого краёв — там гребёнка слипается.
 */
function evenAngles(count: number, squash: number) {
  const N = 3000;
  const cum = [0];
  for (let i = 1; i <= N; i++) {
    const a0 = ((i - 1) / N) * 2 * Math.PI;
    const a1 = (i / N) * 2 * Math.PI;
    cum.push(
      cum[i - 1] +
        Math.hypot(Math.cos(a1) - Math.cos(a0), squash * (Math.sin(a1) - Math.sin(a0))),
    );
  }
  const total = cum[N];
  const out: number[] = [];
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    let lo = 0;
    let hi = N;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    out.push((lo / N) * 360);
  }
  return out;
}

export default function Compass({
  centre,
  squash,
  radius,
}: {
  centre: { x: number; y: number };
  squash: number;
  /** Радиус кольца в плоскости площадки. */
  radius: number;
}) {
  const P = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [centre.x + r * Math.cos(a), centre.y + r * squash * Math.sin(a)];
  };

  const gapTo = (deg: number) =>
    Math.min(...CARDINALS.map((c) => Math.abs(((((deg - c.deg) % 360) + 540) % 360) - 180)));

  /**
   * Экранная нормаль к эллипсу. Насечки строим по ней и одной длины: на
   * плоскости они бы сокращались к дальнему краю, а тут нужна ровная гребёнка.
   */
  const normal = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    const nx = Math.cos(a);
    const ny = Math.sin(a) / squash;
    const len = Math.hypot(nx, ny) || 1;
    return [nx / len, ny / len];
  };

  const ticks = evenAngles(120, squash)
    .filter((d) => gapTo(d) > 11)
    .map((deg, i) => {
      const major = i % 5 === 0;
      const [nx, ny] = normal(deg);
      const [px, py] = P(deg, radius);
      const from = 5;
      const to = from + (major ? 26 : 14);
      return {
        key: `t${i}`,
        x1: px + nx * from,
        y1: py + ny * from,
        x2: px + nx * to,
        y2: py + ny * to,
        c: major ? '#c4c4c4' : '#7d7d7d',
        w: major ? 2.3 : 1.5,
      };
    });

  /**
   * Буква стоит прямо и начинается от самой бирюзовой линии, уходя наружу:
   * поэтому смещаем её по нормали на половину собственной высоты.
   */
  const SIZE = 34;
  const letters = CARDINALS.map(({ t, deg }) => {
    const [nx, ny] = normal(deg);
    const [px, py] = P(deg, radius);
    const out = SIZE * 0.5 + 6;
    return { t, x: px + nx * out, y: py + ny * out };
  });

  return (
    <g>
      <ellipse
        cx={centre.x}
        cy={centre.y}
        rx={radius}
        ry={radius * squash}
        fill="none"
        stroke="#5e9a93"
        strokeWidth={1.7}
        opacity={0.95}
      />
      {ticks.map((t) => (
        <line
          key={t.key}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke={t.c}
          strokeWidth={t.w}
          strokeLinecap="round"
        />
      ))}
      {letters.map((l) => (
        <text
          key={l.t}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#dcdcdc"
          stroke="#1c1c1d"
          strokeWidth={8}
          paintOrder="stroke"
          fontFamily="var(--font-sans), sans-serif"
          fontSize={SIZE}
          fontWeight={700}
          letterSpacing="0.04em"
        >
          {l.t}
        </text>
      ))}
    </g>
  );
}
