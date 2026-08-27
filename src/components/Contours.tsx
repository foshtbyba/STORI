/**
 * Плоские горизонтали фоном. Не проекция горы, а ровные линии в 2D: они идут
 * поперёк всего ряда от края до края и связывают соседние блоки в одну
 * картинку. Каждая пятая толще — как на бумажной карте.
 *
 * Держим их почти на грани видимости и нейтрально-серыми: это фон, поверх
 * которого читают цифры, а не самостоятельный рисунок.
 */

const W = 1200;
const H = 760;
const LINES = 54;
const STEP = H / (LINES - 1);

/** Детерминированный шум по индексу: рисунок одинаков при каждом рендере. */
function jitter(i: number, k: number) {
  const t = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

/**
 * Форма гребня. Одна на все линии — поэтому они не пересекаются между собой,
 * сколько бы гармоник в неё ни намешать.
 */
function ridge(t: number) {
  return (
    Math.sin(t * 3.1 - 0.6) * 0.5 +
    Math.sin(t * 1.4 + 1.9) * 0.3 +
    Math.sin(t * 6.7 + 0.3) * 0.16 +
    Math.sin(t * 11.3 + 2.4) * 0.09 +
    Math.sin(t * 19.7 + 1.1) * 0.05 +
    Math.sin(t * 2.3 - 2.7) * 0.22
  );
}

function line(i: number) {
  const base = i * STEP;
  // Чем дальше от середины полосы, тем спокойнее линия: в центре гребень,
  // к краям рельеф сходит на нет.
  const centre = 1 - Math.abs(i - (LINES - 1) / 2) / ((LINES - 1) / 2);
  // Немного разного роста у каждой линии — рисунок перестаёт быть слоёным.
  const amp = STEP * (0.5 + centre * 2.6) * (0.72 + jitter(i, 3) * 0.7);
  const skew = (jitter(i, 4) - 0.5) * 1.6;

  const points: string[] = [];
  for (let x = 0; x <= W; x += 12) {
    const t = x / W;
    // Края притягиваем к базовой линии, чтобы полоса уходила в край ровно,
    // а не обрывалась на середине волны.
    const ease = Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.6;
    points.push(`${x},${(base + ridge(t + skew) * amp * ease).toFixed(1)}`);
  }
  return { d: `M${points.join(' L')}`, index: i % 5 === 0 };
}

const PATHS = Array.from({ length: LINES }, (_, i) => line(i));

export default function Contours({
  className = '',
  opacity = 1,
  color = '#c9c9cd',
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
      {/*
        Слой ровно по экрану, а внутри него — чуть увеличенный рисунок. Раньше
        запас делался размером самого слоя (108% и отрицательные отступы), но на
        телефоне фиксированный блок меряется от ширины документа: стоило
        странице чуть вылезти вбок, как слой становился ещё шире и разгонял
        прокрутку дальше. Теперь наружу ничего не торчит — лишнее обрезается.
      */}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="contour-drift h-full w-full scale-[1.08]"
      >
        <defs>
          {/* Линии доходят до самого края: гасим только последние проценты,
              чтобы срез не читался прямой вертикалью. */}
          <linearGradient id="contour-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0.12" />
            <stop offset="0.35" stopColor={color} stopOpacity="0.32" />
            <stop offset="0.8" stopColor={color} stopOpacity="0.22" />
            <stop offset="1" stopColor={color} stopOpacity="0.1" />
          </linearGradient>
        </defs>
        {PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke="url(#contour-fade)"
            strokeWidth={p.index ? 1.4 : 0.8}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}
