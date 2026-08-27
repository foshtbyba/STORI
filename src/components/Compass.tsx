/**
 * Кольцо компаса вокруг горы. Всё, что оно рисует, лежит в той же плоскости,
 * что и площадка: точка берётся по азимуту, а вертикаль сплющивается тем же
 * коэффициентом. Насечки идут по радиусу этой плоскости, а не по нормали к
 * эллипсу на экране, — поэтому у краёв они длиннее, а сверху и снизу короче:
 * так и выглядит лежащее кольцо.
 */

export type RingStyle = 1 | 2 | 3 | 4 | 5;

/**
 * Буквы стоят по диагоналям, а не строго по осям: у самой дальней точки кольца
 * буква пряталась бы за горой.
 */
const CARDINALS = [
  { t: 'W', deg: 202 },
  { t: 'N', deg: 338 },
  { t: 'E', deg: 22 },
  { t: 'S', deg: 158 },
];

/**
 * Азимуты, равномерные не по углу, а по длине дуги. У сплющенного круга
 * равный шаг угла сгущает точки у левого и правого краёв — там гребёнка
 * слипается в веер.
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
  style,
  centre,
  squash,
  radius,
}: {
  style: RingStyle;
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

  const ring = (r: number, stroke: string, w: number, opacity = 1) => (
    <ellipse
      cx={centre.x}
      cy={centre.y}
      rx={r}
      ry={r * squash}
      fill="none"
      stroke={stroke}
      strokeWidth={w}
      opacity={opacity}
    />
  );

  /** Насечка по радиусу плоскости: от r1 до r2 на своём азимуте. */
  const tick = (deg: number, r1: number, r2: number, c: string, w: number, key: string) => {
    const [x1, y1] = P(deg, r1);
    const [x2, y2] = P(deg, r2);
    return <line key={key} x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={w} strokeLinecap="round" />;
  };

  /**
   * Буква, положенная в плоскость кольца: прямая, но сплющенная по вертикали
   * тем же коэффициентом, что и площадка. Разворачивать её «лицом к горе»
   * нельзя — на дальней стороне кольца она встала бы вверх ногами.
   */
  const flatLetter = (deg: number, r: number, t: string, size: number, key: string) => {
    const [x, y] = P(deg, r);
    return (
      <text
        key={key}
        transform={`translate(${x} ${y}) scale(1 ${(squash * 1.55).toFixed(3)})`}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#e4e4e4"
        stroke="#1c1c1d"
        strokeWidth={14}
        paintOrder="stroke"
        fontFamily="var(--font-sans), sans-serif"
        fontSize={size}
        fontWeight={700}
      >
        {t}
      </text>
    );
  };

  const uprightLetter = (deg: number, r: number, t: string, size: number, key: string) => {
    const [x, y] = P(deg, r);
    return (
      <text
        key={key}
        x={x}
        y={y}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="#e4e4e4"
        stroke="#1c1c1d"
        strokeWidth={9}
        paintOrder="stroke"
        fontFamily="var(--font-sans), sans-serif"
        fontSize={size}
        fontWeight={700}
      >
        {t}
      </text>
    );
  };

  // ---- 1. Карта: кольцо у подошвы, гребёнка наружу, буквы в разрывах -------
  if (style === 1) {
    const degs = evenAngles(120, squash).filter((d) => gapTo(d) > 12);
    return (
      <g>
        {ring(radius, '#5e9a93', 1.7, 0.95)}
        {degs.map((d, i) => {
          const major = i % 5 === 0;
          return tick(d, radius + 6, radius + (major ? 34 : 18), major ? '#c0c0c0' : '#7a7a7a', major ? 2.4 : 1.6, `t${i}`);
        })}
        {CARDINALS.map((c) => uprightLetter(c.deg, radius + 26, c.t, 40, c.t))}
      </g>
    );
  }

  // ---- 2. Две линии, гребёнка между ними, буквы лежат лицом к горе ---------
  if (style === 2) {
    const outer = radius + 44;
    const degs = evenAngles(144, squash).filter((d) => gapTo(d) > 13);
    return (
      <g>
        {ring(radius, '#5e9a93', 1.6, 0.9)}
        {ring(outer, '#3c5f5b', 1.2, 0.8)}
        {degs.map((d, i) => {
          const major = i % 6 === 0;
          return tick(d, radius, major ? outer : radius + 20, major ? '#b8b8b8' : '#6e6e6e', major ? 2.2 : 1.4, `t${i}`);
        })}
        {CARDINALS.map((c) => flatLetter(c.deg, radius + 22, c.t, 68, c.t))}
      </g>
    );
  }

  // ---- 3. Гребёнка внутрь, буквы снаружи, лежат в плоскости ----------------
  if (style === 3) {
    const degs = evenAngles(160, squash).filter((d) => gapTo(d) > 10);
    return (
      <g>
        {ring(radius, '#5e9a93', 1.8, 0.95)}
        {degs.map((d, i) => {
          const major = i % 8 === 0;
          return tick(d, radius - (major ? 30 : 14), radius, major ? '#bdbdbd' : '#6a6a6a', major ? 2.2 : 1.4, `t${i}`);
        })}
        {CARDINALS.map((c) => flatLetter(c.deg, radius + 40, c.t, 74, c.t))}
      </g>
    );
  }

  // ---- 4. Минимал: кольцо и четыре засечки, крупные прямые буквы -----------
  if (style === 4) {
    return (
      <g>
        {ring(radius, '#5e9a93', 2, 0.95)}
        {ring(radius - 12, '#2f4a47', 1, 0.7)}
        {CARDINALS.map((c) => (
          <g key={c.t}>
            {tick(c.deg, radius - 22, radius + 22, '#cfcfcf', 3, `k${c.t}`)}
            {uprightLetter(c.deg, radius + 48, c.t, 46, c.t)}
          </g>
        ))}
        {evenAngles(24, squash)
          .filter((d) => gapTo(d) > 16)
          .map((d, i) => tick(d, radius, radius + 14, '#5c5c5c', 1.6, `m${i}`))}
      </g>
    );
  }

  // ---- 5. Приборная шкала: плотная градуировка и буквы внутри кольца -------
  const degs = evenAngles(240, squash);
  return (
    <g>
      {ring(radius + 40, '#3c5f5b', 1.1, 0.75)}
      {degs.map((d, i) => {
        const major = i % 20 === 0;
        const mid = i % 5 === 0;
        return tick(
          d,
          radius + 40 - (major ? 30 : mid ? 18 : 9),
          radius + 40,
          major ? '#cccccc' : mid ? '#8a8a8a' : '#565656',
          major ? 2.4 : mid ? 1.6 : 1.1,
          `t${i}`,
        );
      })}
      {ring(radius, '#5e9a93', 1.6, 0.95)}
      {CARDINALS.map((c) => flatLetter(c.deg, radius + 20, c.t, 64, c.t))}
    </g>
  );
}
