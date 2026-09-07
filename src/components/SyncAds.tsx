'use client';

import { useState, useTransition } from 'react';
import { runAdsSync } from '@/app/actions/integrations';

/**
 * Кнопка «обновить расход по потокам» — тянет расход по объявлениям с Facebook
 * и сводит его с кампаниями Keitaro. Идёт с паузами против чекпоинта, поэтому
 * небыстро; пока идёт — кнопка занята.
 */
export default function SyncAds() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runAdsSync>> | null>(null);

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setResult(await runAdsSync()))}
          className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
            pending ? 'cursor-progress opacity-60' : ''
          }`}
        >
          {pending ? 'Тяну стату…' : 'Обновить стату'}
        </button>
        {result ? (
          <span className="text-[11.5px] text-mute">
            обновлено {result.touched}
            {result.problems.length ? ` · проблемы: ${result.problems.length}` : ''}
          </span>
        ) : null}
      </div>
      {result?.problems.length ? (
        <div className="max-w-md rounded-xl px-3 py-2 text-right text-[11px] leading-relaxed" style={{ background: '#2c1f1a', color: '#ce6e58' }}>
          {result.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
