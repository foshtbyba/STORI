/**
 * Плоские горизонтали фоном. Не проекция горы, а ровные линии в 2D: они просто
 * бегут поперёк ряда и уходят на соседние блоки, связывая их в одну картинку.
 * Каждая пятая — толще, как на бумажной карте.
 */

const W = 1000;
const H = 300;
const LINES = 30;
const STEP = 14;

/** Детерминированный шум по индексу: одинаковый рисунок при каждом рендере. */
function jitter(i: number, k: number) {
  const t = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

function line(i: number) {
  const base = H / 2 + (i - (LINES - 1) / 2) * STEP;
  // Ближе к середине полосы амплитуда больше — линии расходятся, как вокруг
  // гребня, но остаются плоскими.
  const centre = 1 - Math.abs(i - (LINES - 1) / 2) / ((LINES - 1) / 2);
  const amp = 6 + centre * 26;
  const phase = jitter(i, 1) * Math.PI * 2;
  const drift = (jitter(i, 2) - 0.5) * 6;

  const points: string[] = [];
  for (let x = 0; x <= W; x += 20) {
    const t = x / W;
    const y =
      base +
      drift +
      amp * Math.sin(t * 5.2 + phase) * 0.6 +
      amp * Math.sin(t * 2.1 + phase * 1.7) * 0.4 +
      amp * 0.18 * Math.sin(t * 11.3 + phase * 0.4);
    points.push(`${x},${y.toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
}

const PATHS = Array.from({ length: LINES }, (_, i) => ({ d: line(i), index: i % 5 === 0 }));

export default function Contours({
  className = '',
  opacity = 0.9,
  color = '#b4c68c',
}: {
  className?: string;
  opacity?: number;
  color?: string;
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute overflow-hidden ${className}`}
      style={{ opacity }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="contour-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0.02" />
            <stop offset="0.3" stopColor={color} stopOpacity="0.17" />
            <stop offset="0.75" stopColor={color} stopOpacity="0.09" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke="url(#contour-fade)"
            strokeWidth={p.index ? 1.9 : 1}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}
