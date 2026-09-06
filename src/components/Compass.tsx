/**
 * Кольцо компаса вокруг горы. Всё, что оно рисует, лежит в плоскости площадки:
 * точка берётся по азимуту, вертикаль сплющивается тем же коэффициентом.
 */

/** Буквы делят круг ровно на четыре части — по ним и режется гребёнка. */
const CARDINALS = [
  { t: 'E', deg: 45 },
  { t: 'S', deg: 135 },
  { t: 'W', deg: 225 },
  { t: 'N', deg: 315 },
];

/** Высота буквы в единицах плоскости. */
const MARK = 40;
/** Насечка заметно ниже буквы: толщину держим, высоту убираем. */
const TICK = 17;

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

  /**
   * Насечки лежат в плоскости кольца: идут по радиусу этой плоскости и ростом
   * ровно с букву. В каждой четверти их поровну — буквы делят круг на четыре
   * равные части, и гребёнка повторяет это деление.
   */
  const PER_QUARTER = 11;
  const ticks: { key: string; x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let q = 0; q < 4; q++) {
    const from = CARDINALS[q].deg;
    const step = 90 / (PER_QUARTER + 1);
    for (let k = 1; k <= PER_QUARTER; k++) {
      const deg = from + step * k;
      const [x1, y1] = P(deg, radius + 7);
      const [x2, y2] = P(deg, radius + 7 + TICK);
      ticks.push({ key: `t${q}-${k}`, x1, y1, x2, y2 });
    }
  }

  /**
   * Буква лежит в той же плоскости и стоит снаружи кольца, макушкой к горе.
   * Матрица — поворот в плоскости, помноженный на её сплющивание.
   */
  const letters = CARDINALS.map(({ t, deg }) => {
    const a = (deg * Math.PI) / 180;
    const [x, y] = P(deg, radius + 7 + MARK / 2);
    const m = [Math.sin(a), -squash * Math.cos(a), Math.cos(a), squash * Math.sin(a)]
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
        strokeWidth={2.6}
        opacity={0.95}
      />
      {ticks.map((t) => (
        <line
          key={t.key}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          stroke="#b4b4b4"
          strokeWidth={2.4}
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
          strokeWidth={7}
          paintOrder="stroke"
          fontFamily="var(--font-sans), sans-serif"
          fontSize={MARK}
          fontWeight={700}
        >
          {l.t}
        </text>
      ))}
    </g>
  );
}
