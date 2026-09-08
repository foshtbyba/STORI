'use client';

import { useState, useTransition } from 'react';
import { runAdsSync } from '@/app/actions/integrations';
import Tip from './Tip';

/**
 * Кнопка «обновить расход по потокам» — тянет расход по объявлениям с Facebook
 * и сводит его с кампаниями Keitaro. Идёт с паузами против чекпоинта, поэтому
 * небыстро; пока идёт — кнопка занята.
 */
export default function SyncAds() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runAdsSync>> | null>(null);

  return (
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
          {result.problems.length ? (
            <>
              {' · '}
              <Tip
                label={
                  <span className="flex flex-col gap-1">
                    {result.problems.map((p) => (
                      <span key={p}>{p}</span>
                    ))}
                  </span>
                }
              >
                <span className="cursor-help text-rust underline decoration-dotted">проблемы: {result.problems.length}</span>
              </Tip>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
