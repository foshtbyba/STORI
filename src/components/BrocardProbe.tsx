'use client';

import { useState, useTransition } from 'react';
import { brocardProbe } from '@/app/actions/integrations';

/**
 * Админ-диагностика Brocard: показывает сырой ответ по балансу/счетам/картам,
 * чтобы точно увидеть поля (баланс команды, сумма на картах, номер счёта) перед
 * тем как собирать плитки остатка и перевод. Только чтение.
 */
export default function BrocardProbe() {
  const [pending, start] = useTransition();
  const [data, setData] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState('');

  const run = () => {
    if (pending) return;
    setErr('');
    start(async () => {
      const r = await brocardProbe();
      if (!r.ok) {
        setErr(r.error ?? 'сбой');
        setData(null);
      } else {
        setData(r.data ?? {});
      }
    });
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}
        >
          {pending ? 'Читаю Brocard…' : 'Диагностика счетов (сырой ответ)'}
        </button>
        <span className="text-[11px] text-dim">только чтение — чтобы увидеть поля баланса</span>
      </div>
      {err ? <p className="mt-2 text-[12px] text-rust">{err}</p> : null}
      {data
        ? Object.entries(data).map(([k, v]) => (
            <div key={k} className="mt-3">
              <div className="text-[12px] font-semibold">{k}</div>
              <pre className="mt-1 overflow-x-auto rounded-lg bg-sub p-2.5 text-[11px] leading-relaxed text-mute">{v}</pre>
            </div>
          ))
        : null}
    </div>
  );
}
