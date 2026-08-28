import { usd } from '@/lib/money';

/**
 * Profit per day. Losses hang below the axis in a shallow band of their own so
 * a bad day is legible without letting it rescale the whole chart.
 */
export function ProfitBars({
  data,
  height = 150,
  lossHeight = 22,
}: {
  data: { date: Date; profitCents: number }[];
  height?: number;
  lossHeight?: number;
}) {
  const peak = Math.max(1, ...data.map((d) => Math.max(0, d.profitCents)));
  const worst = Math.max(1, ...data.map((d) => Math.max(0, -d.profitCents)));

  return (
    <div className="flex gap-3.5">
      <div className="flex w-8 flex-col justify-between text-right" style={{ height }}>
        <span className="n text-[10.5px] text-faint">{usd(peak)}</span>
        <span className="n text-[10.5px] text-faint">{usd(peak / 2)}</span>
        <span className="n text-[10.5px] text-faint">0</span>
      </div>
      <div className="min-w-0 flex-1">
        {/*
          Столбец целиком — одна наводимая колонка: попасть курсором в тонкую
          полоску убытка сложно, а знать сумму хочется по любому дню.
        */}
        <div className="flex items-end gap-1.5" style={{ height }}>
          {data.map((d, i) => (
            <div key={i} className="group relative flex flex-1 items-end" style={{ height }}>
              <div
                className="w-full rounded-[5px] bg-sage transition-opacity group-hover:opacity-80"
                style={{ height: d.profitCents > 0 ? Math.max(3, (d.profitCents / peak) * height) : 0 }}
              />
              <span
                className="n pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-line2 bg-raise px-2.5 py-1 text-[11.5px] font-semibold opacity-0 shadow-lg shadow-black/40 transition-opacity group-hover:opacity-100"
                style={{ color: d.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
              >
                {String(d.date.getUTCDate()).padStart(2, '0')}.
                {String(d.date.getUTCMonth() + 1).padStart(2, '0')} · {usd(d.profitCents, { sign: true })}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 h-px bg-line2" />
        <div className="flex items-start gap-1.5" style={{ height: lossHeight }}>
          {data.map((d, i) => (
            <div key={i} className="group relative flex-1">
              <div
                className="w-full rounded-[5px] bg-rust transition-opacity group-hover:opacity-80"
                style={{ height: d.profitCents < 0 ? Math.max(3, (-d.profitCents / worst) * lossHeight) : 0 }}
              />
              <span
                className="n pointer-events-none absolute left-1/2 top-full z-20 mt-1.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-line2 bg-raise px-2.5 py-1 text-[11.5px] font-semibold text-rust opacity-0 shadow-lg shadow-black/40 transition-opacity group-hover:opacity-100"
              >
                {String(d.date.getUTCDate()).padStart(2, '0')}.
                {String(d.date.getUTCMonth() + 1).padStart(2, '0')} · {usd(d.profitCents, { sign: true })}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-1 flex gap-1.5">
          {data.map((d, i) => (
            <div key={i} className="n flex-1 text-center text-[10px] text-faint">
              {i === 0 || (i + 1) % 5 === 0 ? String(d.date.getUTCDate()).padStart(2, '0') : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** ROI per day as a scatter, with the period average drawn across it. */
export function RoiDots({
  data,
  height = 116,
}: {
  data: { roi: number }[];
  height?: number;
}) {
  const values = data.map((d) => d.roi);
  const max = Math.max(10, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const y = (v: number) => ((max - v) / span) * 100;

  return (
    <div className="flex gap-2.5">
      <div className="flex w-8 flex-col justify-between text-right" style={{ height }}>
        <span className="n text-[10px] text-faint">{Math.round(max)}</span>
        <span className="n text-[10px] text-faint">{Math.round((max + min) / 2)}</span>
        <span className="n text-[10px] text-faint">{Math.round(min)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative" style={{ height }}>
          <div className="absolute inset-x-0 h-px bg-teal opacity-50" style={{ top: `${y(avg)}%` }} />
          {data.map((d, i) => (
            <span
              key={i}
              className="absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                left: `${(i / Math.max(1, data.length - 1)) * 100}%`,
                top: `${y(d.roi)}%`,
                background: d.roi < 0 ? '#ce6e58' : d.roi >= avg ? '#b4c68c' : '#6fa9a0',
              }}
              title={`${d.roi.toFixed(0)}%`}
            />
          ))}
        </div>
        <div className="h-px bg-line2" />
      </div>
    </div>
  );
}

export function Meter({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="h-2 flex-1 rounded-full bg-sub">
      <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
