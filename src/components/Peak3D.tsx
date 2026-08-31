'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RawTerrain } from '@/lib/terrain';
import { usd } from '@/lib/money';

export type Pin3D = {
  id: string;
  initials: string;
  handle: string;
  color: string;
  profitCents: number;
  /** Точка на склоне в координатах площадки. */
  u: number;
  v: number;
  level: number;
  /** Высота ножки метки над поверхностью, в единицах экрана. */
  stem: number;
  me: boolean;
  /**
   * Метку показываем в полную силу. Своя — всегда; чужие приглушены, чтобы
   * баер сразу находил себя. У админа своей метки нет, приглушать не от чего:
   * тогда в полную силу горят все.
   */
  strong: boolean;
  onTop: boolean;
  /** Прячем сумму (овнеры): видно, что человек на горе, но не сколько принёс. */
  hideProfit?: boolean;
};

export type Route3D = {
  /** Тройки u, v, level. */
  covered: number[];
  remaining: number[];
};

export type Rule3D = {
  level: number;
  label: string;
  rate: string;
  color: string;
  /** Порог уже взят смотрящим — подсвечиваем его и на склоне. */
  passed: boolean;
};

const VIEW = { w: 1400, h: 778, y: 148 };
const CARDINALS = [
  { t: 'E', deg: 45 },
  { t: 'S', deg: 135 },
  { t: 'W', deg: 225 },
  { t: 'N', deg: 315 },
];
const RING_GAP = 26;
const MARK = 40;
const TICK = 17;
const PER_QUARTER = 11;

/**
 * Гора в объёме. Рельеф приходит с сервера в координатах площадки, а проекция
 * считается здесь на каждый кадр — поэтому её можно поворачивать вокруг
 * вертикальной оси и видеть склон с другой стороны, а не наклонять картинку.
 *
 * Рисуем в canvas: тридцать с лишним тысяч точек контуров пересчитывать в DOM
 * на каждое движение мыши было бы не по силам. Метки остаются обычным HTML —
 * им нужны наведение и подсказки.
 */
export default function Peak3D({
  terrain,
  pins,
  route,
  rules,
  ringRadius,
}: {
  terrain: RawTerrain;
  pins: Pin3D[];
  route: Route3D | null;
  rules: Rule3D[];
  ringRadius: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [azimuth, setAzimuth] = useState(0);
  /** Наклон камеры в градусах от горизонта. Базовый вычисляем из сплющивания. */
  const [pitch, setPitch] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Ширину берём у родителя. Если задавать её самому холсту, наблюдатель
  // измеряет уже раздутый контейнер и тот никогда не сжимается — страница
  // получает лишние полторы тысячи пикселей по горизонтали.
  const [width, setWidth] = useState(VIEW.w);
  const from = useRef<{ x: number; y: number; a: number; p: number } | null>(null);
  /** Скорость последнего движения — из неё живёт инерция после отпускания. */
  const speed = useRef({ a: 0, p: 0 });
  const last = useRef({ x: 0, y: 0, t: 0 });
  const spin = useRef(0);

  const { centre, radius: RX, height: HMAX, squash: SQ0 } = terrain;

  /**
   * Наклон камеры. Площадка сплющивается как синус угла над горизонтом, а
   * высота горы — как косинус: поднимаешь взгляд — круг раскрывается, гора
   * приседает. Держим в пределах ±30° от исходного ракурса.
   */
  const basePitch = (Math.asin(Math.min(1, SQ0)) * 180) / Math.PI;
  const angle = Math.max(6, Math.min(70, basePitch + pitch));
  const rad = (angle * Math.PI) / 180;
  const SQ = Math.sin(rad);
  const H = HMAX * (Math.cos(rad) / Math.cos((basePitch * Math.PI) / 180));
  /**
   * Поднимая взгляд, круг раскрывается и уходит за нижний край кадра — сцену
   * приходится подтягивать вверх. Но подтяжка едет против руки: тянешь вниз,
   * а гора уезжает вверх. Поэтому смещаем, во-первых, только когда кольцо и
   * правда полезло за край, во-вторых — не быстрее, чем ближняя сторона горы
   * опускается. Тогда на всём рабочем наклоне гора идёт за рукой.
   */
  const overflow = Math.max(0, centre.y + (ringRadius + 45) * SQ - (VIEW.y + VIEW.h - 8));
  const cy = centre.y - Math.min(overflow, Math.max(0, SQ - SQ0) * ringRadius * 0.62);
  const centreAt = { x: centre.x, y: cy };

  /** Глубина точки площадки: >0 — ближняя к камере половина, <0 — дальняя. */
  const depthOf = useMemo(() => {
    const a = (azimuth * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return (u: number, v: number) => u * sin + v * cos;
  }, [azimuth]);

  /** Проекция точки площадки на экран при текущем повороте. */
  const project = useMemo(() => {
    const a = (azimuth * Math.PI) / 180;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return (u: number, v: number, level: number): [number, number] => {
      const ru = u * cos - v * sin;
      const rv = u * sin + v * cos;
      return [centreAt.x + ru * RX, centreAt.y + rv * RX * SQ - level * H];
    };
  }, [azimuth, centreAt.x, centreAt.y, RX, H, SQ]);

  // Размер холста — под ширину панели, с учётом плотности экрана.
  useEffect(() => () => cancelAnimationFrame(spin.current), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = width / VIEW.w;
    el.width = Math.round(width * dpr);
    el.height = Math.round(((width * VIEW.h) / VIEW.w) * dpr);
    const ctx = el.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, -VIEW.y * dpr * scale);
    ctx.clearRect(0, VIEW.y, VIEW.w, VIEW.h);

    // --- компас: кольцо, гребёнка, буквы. Он поворачивается вместе с горой.
    const ring = (r: number) => {
      ctx.beginPath();
      for (let d = 0; d <= 360; d += 2) {
        const a = (d * Math.PI) / 180;
        const x = centreAt.x + r * Math.cos(a);
        const y = centreAt.y + r * SQ * Math.sin(a);
        if (d === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.strokeStyle = '#5e9a93';
    ctx.lineWidth = 2.6;
    ring(ringRadius);
    ctx.stroke();

    const P = (deg: number, r: number): [number, number] => {
      const a = (deg * Math.PI) / 180;
      return [centreAt.x + r * Math.cos(a), centreAt.y + r * SQ * Math.sin(a)];
    };

    ctx.strokeStyle = '#b4b4b4';
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    for (let q = 0; q < 4; q++) {
      const start = CARDINALS[q].deg + azimuth;
      const step = 90 / (PER_QUARTER + 1);
      for (let k = 1; k <= PER_QUARTER; k++) {
        const deg = start + step * k;
        const [x1, y1] = P(deg, ringRadius + 7);
        const [x2, y2] = P(deg, ringRadius + 7 + TICK);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }

    ctx.font = `700 ${MARK}px Manrope, "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of CARDINALS) {
      const deg = c.deg + azimuth;
      const a = (deg * Math.PI) / 180;
      const [x, y] = P(deg, ringRadius + 7 + MARK / 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.transform(Math.sin(a), -SQ * Math.cos(a), Math.cos(a), SQ * Math.sin(a), 0, 0);
      ctx.lineWidth = 7;
      ctx.strokeStyle = '#1c1c1d';
      ctx.lineJoin = 'round';
      ctx.strokeText(c.t, 0, 0);
      ctx.fillStyle = '#dcdcdc';
      ctx.fillText(c.t, 0, 0);
      ctx.restore();
    }

    // Отметки порогов на самом склоне: для каждого порога берём ближайшую
    // горизонталь и красим её. Взятые — зелёным, будущие — приглушённо.
    const tierBand = new Map<number, Rule3D>();
    for (const r of rules) {
      let best = 0;
      let bestGap = Infinity;
      terrain.bands.forEach((b, i) => {
        const gap = Math.abs(b.level - r.level);
        if (gap < bestGap) {
          bestGap = gap;
          best = i;
        }
      });
      tierBand.set(best, r);
    }

    // --- маршрут и ножки меток.
    //
    // Холст не знает про глубину, поэтому рисуем в два захода: то, что ушло за
    // гору, идёт ДО рельефа и честно скрывается за ним, а ближняя половина —
    // после. Без этого тропа с обратной стороны продолжала висеть поверх
    // склона, будто в воздухе.
    const strokeHalf = (
      pts: number[],
      near: boolean,
      style: string,
      width: number,
      dash: number[],
    ) => {
      if (pts.length < 6) return;
      ctx.setLineDash(dash);
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < pts.length; i += 3) {
        const side = depthOf(pts[i], pts[i + 1]) >= 0;
        if (side !== near) {
          drawing = false;
          continue;
        }
        const [x, y] = project(pts[i], pts[i + 1], pts[i + 2]);
        if (drawing) ctx.lineTo(x, y);
        else {
          ctx.moveTo(x, y);
          drawing = true;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const drawRoute = (near: boolean) => {
      if (!route) return;
      strokeHalf(route.covered, near, '#7a7a7a', 2.4, []);
      strokeHalf(route.remaining, near, '#f0f0f0', 2.8, [10, 8]);
    };

    const drawStems = (near: boolean) => {
      for (const p of pins) {
        if (depthOf(p.u, p.v) >= 0 !== near) continue;
        const [sx, sy] = project(p.u, p.v, p.level);
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx, sy - p.stem + 17);
        ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const drawFlag = () => {
      if (!route || route.covered.length < 3) return;
      const [fx, fy] = project(route.covered[0], route.covered[1], route.covered[2]);
      ctx.strokeStyle = '#e4e4e4';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx, fy - 34);
      ctx.stroke();
      ctx.fillStyle = '#e4e4e4';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 34);
      ctx.lineTo(fx + 22, fy - 27);
      ctx.lineTo(fx, fy - 20);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(fx, fy, 3.6, 0, Math.PI * 2);
      ctx.fill();
    };

    drawRoute(false);
    drawStems(false);

    // --- рельеф: ступени снизу вверх, непрозрачные, поверх дальних ближние.
    for (const [i, band] of terrain.bands.entries()) {
      ctx.beginPath();
      for (const loop of band.loops) {
        for (let i = 0; i < loop.length; i += 2) {
          const [x, y] = project(loop[i], loop[i + 1], band.level);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      const t = Math.pow(Math.max(0, Math.min(1, band.level)), 0.85);
      const c = Math.round(30 + 28 * t);
      ctx.fillStyle = `rgb(${c} ${c} ${c + 2})`;
      ctx.fill('evenodd');

      const tier = tierBand.get(i);
      if (tier) {
        // Кольца порогов опоясывают гору на всех высотах. Взятое светится
        // зелёным, будущее читается серебром — тише, но это всё равно кольцо,
        // а не случайная горизонталь.
        ctx.strokeStyle = tier.passed ? '#c9e08f' : '#778a5b';
        ctx.lineWidth = tier.passed ? 4 : 3;
        ctx.shadowColor = tier.passed ? 'rgba(180, 198, 140, 0.8)' : 'transparent';
        ctx.shadowBlur = tier.passed ? 12 : 0;
      } else {
        ctx.strokeStyle = band.index ? '#b4b4b4' : '#6b6b6b';
        ctx.lineWidth = band.index ? 1.25 : 0.8;
      }
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    drawRoute(true);
    drawStems(true);
    drawFlag();

    // --- пороги ставок: горизонтальные линейки справа, они не вращаются.
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.strokeStyle = '#2e2e2f';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(1300, centreAt.y - H);
    ctx.lineTo(1300, centreAt.y);
    ctx.stroke();
    for (const r of rules) {
      const y = centreAt.y - r.level * H;
      ctx.setLineDash([3, 8]);
      ctx.strokeStyle = r.passed ? '#c9e08f' : '#778a5b';
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      // Начинаем правее подошвы: гора вращается, и линейка не должна её резать.
      ctx.moveTo(centreAt.x + RX * 1.06, y);
      ctx.lineTo(1290, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(1294, y);
      ctx.lineTo(1306, y);
      ctx.stroke();
      ctx.fillStyle = r.passed ? '#c9e08f' : '#8f9d76';
      ctx.font = '13px "JetBrains Mono", monospace';
      ctx.fillText(r.label, 1316, y + 4);
      ctx.fillStyle = r.passed ? '#8d9b6d' : '#6f6f73';
      ctx.font = '600 11.5px Manrope, "Helvetica Neue", sans-serif';
      ctx.fillText(r.rate, 1316, y + 21);
    }
  }, [terrain, pins, route, rules, project, azimuth, width, centreAt.x, centreAt.y, RX, H, SQ, ringRadius]);

  /**
   * Сколько градусов даёт пиксель курсора. Считаем от экранного радиуса
   * площадки: протащил на радиус — повернул на четверть оборота. Так гора
   * едет ровно за рукой и на широкой панели, и на узкой, а не «примерно».
   */
  const degPerPx = 90 / Math.max(60, RX * (width / VIEW.w));
  const TILT = 0.7;

  function down(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    cancelAnimationFrame(spin.current);
    speed.current = { a: 0, p: 0 };
    from.current = { x: e.clientX, y: e.clientY, a: azimuth, p: pitch };
    last.current = { x: e.clientX, y: e.clientY, t: performance.now() };
    setDragging(true);
  }

  function move(e: React.PointerEvent) {
    const start = from.current;
    if (!start) return;
    const now = performance.now();
    const dt = Math.max(8, now - last.current.t);
    // Скорость в градусах за кадр (16 мс) — в таких же единицах её потом и гасим.
    speed.current = {
      a: (-(e.clientX - last.current.x) * degPerPx * 16) / dt,
      p: ((e.clientY - last.current.y) * degPerPx * TILT * 16) / dt,
    };
    last.current = { x: e.clientX, y: e.clientY, t: now };
    // Знак минуса — чтобы ближняя к нам сторона горы ехала туда же, куда
    // рука. С плюсом гора уезжает навстречу курсору и это сбивает.
    setAzimuth(start.a - (e.clientX - start.x) * degPerPx);
    setPitch(
      Math.max(-30, Math.min(30, start.p + (e.clientY - start.y) * degPerPx * TILT)),
    );
  }

  /**
   * Инерция после отпускания: сцена доезжает по остаточной скорости и гаснет
   * за несколько десятых секунды. Без этого разворот обрывается резко, будто
   * гору держали за край.
   */
  function coast() {
    const step = () => {
      const v = speed.current;
      if (Math.abs(v.a) < 0.02 && Math.abs(v.p) < 0.02) {
        speed.current = { a: 0, p: 0 };
        return;
      }
      setAzimuth((prev) => prev + v.a);
      setPitch((prev) => Math.max(-30, Math.min(30, prev + v.p)));
      speed.current = { a: v.a * 0.93, p: v.p * 0.93 };
      spin.current = requestAnimationFrame(step);
    };
    spin.current = requestAnimationFrame(step);
  }

  function up(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    from.current = null;
    setDragging(false);
    coast();
  }

  const scale = width / VIEW.w;
  const place = (u: number, v: number, level: number, lift: number) => {
    const [x, y] = project(u, v, level);
    return { left: x * scale, top: (y - VIEW.y - lift) * scale };
  };

  return (
    <div
      ref={box}
      className={`relative w-full select-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => {
        cancelAnimationFrame(spin.current);
        speed.current = { a: 0, p: 0 };
        setAzimuth(0);
        setPitch(0);
      }}
    >
      <canvas ref={canvas} className="absolute inset-0 block h-full w-full" />

      {pins.map((p) => {
        const at = place(p.u, p.v, p.level, p.stem);
        return (
          <div
            key={p.id}
            className={`group absolute -translate-x-1/2 -translate-y-1/2 transition-opacity duration-150 hover:z-20 ${
              p.strong ? 'z-10 opacity-100' : 'opacity-55 hover:opacity-100'
            }`}
            style={{ left: at.left, top: at.top }}
          >
            <div
              className={`n flex items-center justify-center rounded-full font-bold leading-none transition-transform duration-150 group-hover:scale-125 ${
                p.strong ? 'h-10 w-10 text-[11.5px]' : 'h-[30px] w-[30px] text-[9.5px]'
              }`}
              style={{
                background: p.strong ? p.color : '#1f1f20',
                color: p.strong ? '#1c1c1d' : p.color,
                border: `2px solid ${p.color}`,
                boxShadow: '0 0 0 4px #1c1c1d',
              }}
            >
              <span className="ink-mid">{p.initials}</span>
            </div>
            <div
              className="n pointer-events-none absolute bottom-full left-1/2 mb-2.5 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-semibold opacity-0 transition-opacity duration-150 group-hover:opacity-100"
              style={{
                background: '#232324',
                border: `1px solid ${p.strong ? p.color : '#3a3a3b'}`,
                color: p.strong ? p.color : '#d0d0d0',
              }}
            >
              {p.hideProfit ? p.handle : `${p.handle} · ${usd(p.profitCents)}`}
            </div>
          </div>
        );
      })}

      <span
        className="pointer-events-none absolute bottom-2 right-3 text-[11px] text-dim transition"
        style={{ opacity: azimuth === 0 && pitch === 0 ? 1 : 0 }}
      >
        потяни, чтобы обойти гору
      </span>
    </div>
  );
}
