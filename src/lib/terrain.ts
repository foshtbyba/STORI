/**
 * The relief behind the ranking screen.
 *
 * A height field is built from a domain-warped ridged multifractal, contour
 * lines are traced out of it with marching squares, linked into polylines and
 * projected isometrically. Everything the shape depends on lives in
 * TerrainConfig below — change a number there and the whole mountain changes,
 * no other file needs touching.
 *
 * Tracing is deterministic and independent of the data, so a config is built
 * once and cached; only the pins and routes move as numbers change.
 */

export type TerrainConfig = {
  /**
   * Зерно шума. Меняешь — получаешь другую гору той же породы: те же пропорции
   * и та же плотность гребней, но иной рисунок склонов.
   */
  seed: number;
  /** Grid resolution. Higher = finer contours and a slower build. */
  grid: number;
  /**
   * Полуширина области, по которой считается высота, в тех же единицах, что и
   * radius. Должна быть заметно больше единицы: доменный варп сдвигает точки, и
   * у самой границы массив ещё может быть ненулевым — тогда горизонтали
   * обрезаются прямой линией по краю сетки.
   */
  extent: number;
  /** How many contour lines to trace between the foot and the summit. */
  levels: number;
  /** Every n-th contour is drawn heavier, as on a survey map. */
  indexEvery: number;
  /** Isometric squash of the ground plane: 1 is top-down, 0 is edge-on. */
  squash: number;
  /** Half-width of the massif and its height, in SVG units. */
  radius: number;
  height: number;
  centre: { x: number; y: number };
  /** Relative weight of each ridged-noise octave, coarse to fine. */
  octaves: number[];
  /** How far coordinates are pushed around before height is sampled. */
  warp: number;
  /** Width of the solid summit mass; larger reads as a broader peak. */
  domeSigma: number;
  /** Extra shoulders hung off the main cone: [x, y, sigma, amplitude]. */
  shoulders: [number, number, number, number][];
};

export const DEFAULT_TERRAIN: TerrainConfig = {
  seed: 0,
  grid: 184,
  extent: 1.22,
  levels: 46,
  indexEvery: 5,
  squash: 0.38,
  radius: 352,
  height: 404,
  centre: { x: 660, y: 700 },
  octaves: [0.78, 0.56, 0.38, 0.23, 0.13],
  warp: 0.62,
  domeSigma: 0.27,
  shoulders: [
    [-0.5, 0.2, 0.2, 0.34],
    [0.46, -0.24, 0.18, 0.3],
    [0.14, 0.5, 0.17, 0.26],
    [-0.28, -0.48, 0.15, 0.23],
    [0.54, 0.28, 0.14, 0.19],
    [-0.12, 0.26, 0.12, 0.15],
    [0.26, -0.52, 0.13, 0.17],
    [-0.56, -0.14, 0.12, 0.14],
    [0.3, 0.16, 0.1, 0.12],
    [-0.2, 0.44, 0.11, 0.13],
  ],
};

/**
 * Одна ступень рельефа: замкнутые петли этого уровня одним путём. Заливаем их
 * снизу вверх непрозрачным цветом — тогда дальний склон закрыт ближним и гора
 * перестаёт просвечивать насквозь.
 */
export type Band = { d: string; level: number; index: boolean };

/**
 * Тот же рельеф, но в координатах самой площадки, а не экрана: петли лежат
 * парами u,v в диапазоне примерно [-1, 1]. Проекцию делает уже клиент — так
 * гору можно разворачивать вокруг вертикальной оси, а не наклонять картинку.
 */
export type RawBand = { level: number; index: boolean; loops: number[][] };
export type RawTerrain = {
  bands: RawBand[];
  /** Вершина в тех же координатах: u, v. */
  summit: [number, number];
  radius: number;
  height: number;
  squash: number;
  centre: { x: number; y: number };
};
export type Terrain = {
  config: TerrainConfig;
  bands: Band[];
  raw: RawTerrain;
  /** Точка поверхности в координатах площадки — для проекции на клиенте. */
  surfaceUV: (angleDeg: number, level: number) => [number, number];
  /** Where the summit lands on screen. */
  summit: [number, number];
  /** Screen position of the outermost surface point on a ray, at a height. */
  surfacePoint: (angleDeg: number, level: number) => [number, number];
  /** How far right the terrain reaches at a height — used to start tier rules. */
  rightEdge: (level: number) => number;
};

function makeNoise(seed: number) {
  // Зерно уводит решётку шума в сторону: рисунок другой, статистика та же.
  const sx = 1 + ((seed * 0.6180339887) % 1) * 3.7;
  const sy = 1 + ((seed * 0.7548776662) % 1) * 3.7;
  const hash = (i: number, j: number) => {
    const t = Math.sin((i + sx) * 127.1 + (j + sy) * 311.7 + seed * 57.13) * 43758.5453;
    return t - Math.floor(t);
  };
  const value = (x: number, y: number, freq: number) => {
    const fx = x * freq;
    const fy = y * freq;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    let u = fx - i;
    let v = fy - j;
    u = u * u * (3 - 2 * u);
    v = v * v * (3 - 2 * v);
    return (
      hash(i, j) * (1 - u) * (1 - v) +
      hash(i + 1, j) * u * (1 - v) +
      hash(i, j + 1) * (1 - u) * v +
      hash(i + 1, j + 1) * u * v
    );
  };
  const ridged = (x: number, y: number, freq: number) => 1 - Math.abs(2 * value(x, y, freq) - 1);
  return { value, ridged };
}

export function buildTerrain(config: TerrainConfig = DEFAULT_TERRAIN): Terrain {
  const { value: noise, ridged } = makeNoise(config.seed ?? 0);
  const { grid: GN, squash: SQ, radius: RX, height: HMAX, centre } = config;
  const EXT = config.extent ?? 1.22;

  const height = (x: number, y: number) => {
    const wx =
      x + config.warp * (noise(x + 3.1, y + 1.7, 1.5) - 0.5) + 0.12 * (noise(x + 9.3, y + 4.1, 3.4) - 0.5);
    const wy =
      y + config.warp * (noise(x + 6.7, y + 8.9, 1.5) - 0.5) + 0.12 * (noise(x + 2.5, y + 7.3, 3.4) - 0.5);
    const r = Math.hypot(wx, wy);
    if (r >= 1.02) return 0;

    const cone = 1 - r / 1.02;
    const dome = Math.exp(-(wx * wx + wy * wy) / (2 * config.domeSigma * config.domeSigma));
    const freqs = [1.9, 3.9, 7.8, 15.5, 30];
    let rn = 0;
    config.octaves.forEach((weight, i) => {
      rn += weight * ridged(wx + 1.3 + i * 4, wy + 2.9 + i * 3, freqs[i] ?? 60);
    });

    const body = 0.42 * Math.pow(cone, 1.35) + 0.62 * dome * Math.pow(cone, 0.3);
    // Гребни весят больше гладкой основы — иначе выходит купол, а не рельеф.
    // Но у самой макушки их приглушаем: иначе пик расползается на несколько
    // бугров и метке некуда встать.
    const crest = Math.pow(dome, 1.6);
    let h = body * (0.34 + 1.15 * rn * (1 - 0.72 * crest));
    for (const [sx, sy, sigma, amp] of config.shoulders) {
      const dx = x - sx;
      const dy = y - sy;
      h += amp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)) * Math.pow(cone, 0.7);
    }

    // Жёсткая граница подошвы по НЕискажённому радиусу. Без неё доменный варп
    // вытягивает край массива далеко за radius, и подошва наползает на кольцо
    // компаса: у горы должен быть свой круг, у компаса свой.
    const rr = Math.hypot(x, y);
    if (rr >= 1) return 0;
    const edge = Math.min(1, (1 - rr) / 0.16);
    return h * edge * edge;
  };

  const cells = new Float64Array(GN * GN);
  let maxH = 0;
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const h = height(((i / (GN - 1)) * 2 - 1) * EXT, ((j / (GN - 1)) * 2 - 1) * EXT);
      cells[j * GN + i] = h;
      if (h > maxH) maxH = h;
    }
  }
  for (let i = 0; i < cells.length; i++) cells[i] /= maxH;

  const project = (u: number, v: number, level: number): [number, number] => [
    centre.x + u * RX,
    centre.y + v * RX * SQ - level * HMAX,
  ];
  const projectCell = (p: [number, number], level: number) =>
    project(((p[0] / (GN - 1)) * 2 - 1) * EXT, ((p[1] / (GN - 1)) * 2 - 1) * EXT, level);

  type Pt = [number, number];
  const key = (p: Pt) => `${p[0].toFixed(3)}_${p[1].toFixed(3)}`;

  function trace(level: number): Pt[][] {
    const segs: [Pt, Pt][] = [];
    const cut = (xa: number, ya: number, va: number, xb: number, yb: number, vb: number): Pt => {
      const t = (level - va) / (vb - va);
      return [xa + (xb - xa) * t, ya + (yb - ya) * t];
    };

    for (let j = 0; j < GN - 1; j++) {
      for (let i = 0; i < GN - 1; i++) {
        const v0 = cells[j * GN + i];
        const v1 = cells[j * GN + i + 1];
        const v2 = cells[(j + 1) * GN + i + 1];
        const v3 = cells[(j + 1) * GN + i];
        const code =
          (v0 > level ? 1 : 0) | (v1 > level ? 2 : 0) | (v2 > level ? 4 : 0) | (v3 > level ? 8 : 0);
        if (code === 0 || code === 15) continue;

        const top = (v0 > level) !== (v1 > level) ? cut(i, j, v0, i + 1, j, v1) : null;
        const right = (v1 > level) !== (v2 > level) ? cut(i + 1, j, v1, i + 1, j + 1, v2) : null;
        const bottom = (v3 > level) !== (v2 > level) ? cut(i, j + 1, v3, i + 1, j + 1, v2) : null;
        const left = (v0 > level) !== (v3 > level) ? cut(i, j, v0, i, j + 1, v3) : null;

        if (code === 1 || code === 14) segs.push([left!, top!]);
        else if (code === 2 || code === 13) segs.push([top!, right!]);
        else if (code === 3 || code === 12) segs.push([left!, right!]);
        else if (code === 4 || code === 11) segs.push([right!, bottom!]);
        else if (code === 6 || code === 9) segs.push([top!, bottom!]);
        else if (code === 7 || code === 8) segs.push([left!, bottom!]);
        else if (code === 5) segs.push([left!, top!], [right!, bottom!]);
        else if (code === 10) segs.push([top!, right!], [left!, bottom!]);
      }
    }

    const index = new Map<string, number[]>();
    segs.forEach((seg, i) => {
      for (const end of seg) {
        const k = key(end);
        const bucket = index.get(k);
        if (bucket) bucket.push(i);
        else index.set(k, [i]);
      }
    });

    const used = new Uint8Array(segs.length);
    const lines: Pt[][] = [];
    const walk = (line: Pt[], forward: boolean) => {
      for (let guard = 0; guard < 20_000; guard++) {
        const endKey = key(forward ? line[line.length - 1] : line[0]);
        const next = (index.get(endKey) ?? []).find((s) => !used[s]);
        if (next === undefined) return;
        used[next] = 1;
        const seg = segs[next];
        const other = key(seg[0]) === endKey ? seg[1] : seg[0];
        if (forward) line.push(other);
        else line.unshift(other);
      }
    };

    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      used[s] = 1;
      const line: Pt[] = [segs[s][0], segs[s][1]];
      walk(line, true);
      walk(line, false);
      if (line.length > 7) lines.push(line);
    }
    return lines;
  }

  function smooth(line: Pt[]): Pt[] {
    let current = line;
    for (let pass = 0; pass < 2; pass++) {
      const next = current.slice();
      for (let i = 1; i < current.length - 1; i++) {
        next[i] = [
          (current[i - 1][0] + current[i][0] * 2 + current[i + 1][0]) / 4,
          (current[i - 1][1] + current[i][1] * 2 + current[i + 1][1]) / 4,
        ];
      }
      current = next;
    }
    return current;
  }

  function path(line: Pt[], level: number, close = false) {
    const step = line.length > 170 ? 2 : 1;
    let d = '';
    for (let i = 0; i < line.length; i += step) {
      const [x, y] = projectCell(line[i], level);
      d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return close ? `${d} Z` : d;
  }

  const bands: Band[] = [];
  for (let i = 0; i < config.levels; i++) {
    const level = 0.016 + Math.pow(i / (config.levels - 1), 1.08) * 0.958;
    const loops = trace(level);
    if (loops.length === 0) continue;
    bands.push({
      level,
      index: i % config.indexEvery === 0,
      d: loops.map((line) => path(smooth(line), level, true)).join(' '),
    });
  }

  /** Точки петли в координатах площадки — для клиентской проекции. */
  function rawLoop(line: Pt[]): number[] {
    const step = line.length > 170 ? 2 : 1;
    const out: number[] = [];
    for (let i = 0; i < line.length; i += step) {
      out.push(
        Number(((((line[i][0] / (GN - 1)) * 2 - 1) * EXT)).toFixed(4)),
        Number(((((line[i][1] / (GN - 1)) * 2 - 1) * EXT)).toFixed(4)),
      );
    }
    return out;
  }

  const rawBands: RawBand[] = [];
  for (let i = 0; i < config.levels; i++) {
    const level = 0.016 + Math.pow(i / (config.levels - 1), 1.08) * 0.958;
    const loops = trace(level);
    if (loops.length === 0) continue;
    rawBands.push({
      level: Number(level.toFixed(4)),
      index: i % config.indexEvery === 0,
      loops: loops.map((line) => rawLoop(smooth(line))),
    });
  }

  /**
   * Точка поверхности в координатах площадки: u, v на заданной высоте.
   *
   * Высоту сначала прижимаем к тому, что на этом луче вообще достижимо. Без
   * этого дихотомия на слишком высокой отметке схлопывалась в ноль, точка
   * уезжала на центральную ось, и тропа отрывалась от склона, повисая в
   * воздухе вертикальной ниткой.
   */
  const surfaceUV = (angleDeg: number, level: number): [number, number] => {
    const a = (angleDeg * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    let peak = 0;
    for (let i = 0; i <= 64; i++) {
      const r = (i / 64) * 1.02;
      const h = height(r * cos, r * sin) / maxH;
      if (h > peak) peak = h;
    }
    const target = Math.min(level, peak * 0.995);

    let lo = 0;
    let hi = 1.05;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (height(mid * cos, mid * sin) / maxH > target) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) / 2;
    return [r * cos, r * sin];
  };

  const surfacePoint = (angleDeg: number, level: number): [number, number] => {
    const a = (angleDeg * Math.PI) / 180;
    let lo = 0;
    let hi = 1.05;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (height(mid * Math.cos(a), mid * Math.sin(a)) / maxH > level) lo = mid;
      else hi = mid;
    }
    const r = (lo + hi) / 2;
    return project(r * Math.cos(a), r * Math.sin(a), level);
  };

  let peakIndex = 0;
  for (let i = 1; i < cells.length; i++) if (cells[i] > cells[peakIndex]) peakIndex = i;

  const summitCell: [number, number] = [peakIndex % GN, Math.floor(peakIndex / GN)];
  const summitUV: [number, number] = [
    ((summitCell[0] / (GN - 1)) * 2 - 1) * EXT,
    ((summitCell[1] / (GN - 1)) * 2 - 1) * EXT,
  ];

  return {
    config,
    bands,
    raw: {
      bands: rawBands,
      summit: summitUV,
      radius: RX,
      height: HMAX,
      squash: SQ,
      centre,
    } as RawTerrain,
    surfaceUV,
    summit: projectCell(summitCell, 1),
    surfacePoint,
    rightEdge: (level) => {
      let max = 0;
      for (let a = 0; a < 360; a += 3) max = Math.max(max, surfacePoint(a, level)[0]);
      return max;
    },
  };
}

// Кэш ограничен: зерно меняется каждую неделю, и без предела карта росла бы
// вместе с аптаймом процесса.
const CACHE_LIMIT = 4;
const cache = new Map<string, Terrain>();

/** Build once per config; the shape never depends on the data drawn on it. */
export function getTerrain(config: TerrainConfig = DEFAULT_TERRAIN): Terrain {
  const k = JSON.stringify(config);
  const hit = cache.get(k);
  if (hit) {
    // Освежаем позицию, чтобы вытеснялась самая давняя запись.
    cache.delete(k);
    cache.set(k, hit);
    return hit;
  }
  const terrain = buildTerrain(config);
  cache.set(k, terrain);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  return terrain;
}

/**
 * Номер недели по ISO. Гора живёт неделю: в понедельник рисунок склонов
 * меняется, пропорции и пороги остаются прежними.
 */
export function weekSeed(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Четверг той же недели однозначно задаёт год по ISO.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return d.getUTCFullYear() * 100 + week;
}
