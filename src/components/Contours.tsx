import { getTerrain, DEFAULT_TERRAIN, type TerrainConfig } from '@/lib/terrain';

/**
 * Тот же рельеф, что и на «Вершине», но тонкой линией и почти в фон. Слой
 * специально шире своей панели: горизонтали уходят на соседние блоки и
 * связывают ряд в одну картинку, как на бумажной карте. Обёртка режет всё,
 * что вылезло за отведённую полосу, — иначе гора накрывает пол-экрана.
 */
export default function Contours({
  className = '',
  viewBox = '380 300 700 300',
  opacity = 0.9,
  color = '#b4c68c',
  config = DEFAULT_TERRAIN,
}: {
  className?: string;
  viewBox?: string;
  opacity?: number;
  color?: string;
  config?: TerrainConfig;
}) {
  const { contours } = getTerrain(config);

  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute overflow-hidden ${className}`}
      style={{ opacity }}
    >
      <svg viewBox={viewBox} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="contour-fade" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0.02" />
            <stop offset="0.3" stopColor={color} stopOpacity="0.16" />
            <stop offset="0.75" stopColor={color} stopOpacity="0.08" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {contours.map((c, i) => (
          <path
            key={i}
            d={c.d}
            fill="none"
            stroke="url(#contour-fade)"
            strokeWidth={c.index ? 2.4 : 1.2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </span>
  );
}
