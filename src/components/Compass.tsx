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
   * Ближний край кольца к камере, дальний — от неё. Проекция у нас
   * изометрическая и сама этого не даёт, поэтому длину и толщину насечки
   * ведём по глубине руками: внизу длиннее и жирнее, вверху короче и тоньше.
   */
  const depth = (deg: number) => 1 + 0.55 * Math.sin((deg * Math.PI) / 180);

  const ticks = evenAngles(120, squash)
    .filter((d) => gapTo(d) > 11)
    .map((deg, i) => {
      const major = i % 5 === 0;
      const k = depth(deg);
      const [x1, y1] = P(deg, radius + 6);
      const [x2, y2] = P(deg, radius + 6 + (major ? 34 : 18) * k);
      return {
        key: `t${i}`,
        x1,
        y1,
        x2,
        y2,
        c: major ? '#c4c4c4' : '#7d7d7d',
        w: (major ? 2.3 : 1.5) * (0.75 + 0.35 * k),
      };
    });

  /**
   * Буква лежит на кольце в его плоскости и развёрнута макушкой к горе. На
   * дальней половине она из-за этого читается перевёрнутой — так и ведёт себя
   * надпись, нарисованная на земле; ровно это и просили.
   */
  const letters = CARDINALS.map(({ t, deg }) => {
    const a = (deg * Math.PI) / 180;
    const [x, y] = P(deg, radius);
    const m = [
      Math.sin(a),
      -squash * Math.cos(a),
      Math.cos(a),
      squash * Math.sin(a),
    ]
      .map((v) => v.toFixed(4))
      .join(' ');
    return { t, x, y, m };
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
          transform={`translate(${l.x} ${l.y}) matrix(${l.m} 0 0)`}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#dcdcdc"
          stroke="#1c1c1d"
          strokeWidth={8}
          paintOrder="stroke"
          fontFamily="var(--font-sans), sans-serif"
          fontSize={52}
          fontWeight={700}
        >
          {l.t}
        </text>
      ))}
    </g>
  );
}
