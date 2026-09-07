'use client';

import { useState, useTransition } from 'react';
import { runCampaignSync } from '@/app/actions/integrations';

/**
 * Кнопка «обновить кампании» — тянет только статус кампаний с Facebook, не
 * трогая доход/расход. Идёт с паузами против чекпоинта, поэтому небыстро;
 * пока идёт — кнопка занята.
 */
export default function SyncCampaigns() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runCampaignSync>> | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await runCampaignSync()))}
        className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
          pending ? 'cursor-progress opacity-60' : ''
        }`}
      >
        {pending ? 'Тяну кампании…' : 'Обновить кампании'}
      </button>
      {result ? (
        <span className="text-[11.5px] text-mute">
          обновлено {result.touched}
          {result.problems.length ? ` · проблемы: ${result.problems.length}` : ''}
        </span>
      ) : null}
    </div>
  );
}
