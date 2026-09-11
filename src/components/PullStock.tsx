'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { pullStockFromKeitaro } from '@/app/actions/domains';

/**
 * Кнопка «подтянуть домены со склада Keitaro»: тянет домены из группы-склада
 * КТ на витрину, чтобы не вводить имена руками. Результат показываем рядом.
 */
export default function PullStock() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = () => {
    if (pending) return;
    setMsg(null);
    start(async () => {
      const r = await pullStockFromKeitaro();
      if (!r?.ok) {
        setMsg({ ok: false, text: r?.error ?? 'Не вышло подтянуть.' });
      } else if (r.added === 0) {
        setMsg({ ok: true, text: r.found ? `На складе КТ ${r.found} — новых нет, всё уже на витрине.` : 'В группе-складе КТ доменов не нашли.' });
      } else {
        setMsg({ ok: true, text: `Добавлено ${r.added} из ${r.found} со склада КТ.` });
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        disabled={pending}
        onClick={run}
        className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
          pending ? 'cursor-progress opacity-60' : ''
        }`}
      >
        {pending ? 'Тяну со склада КТ…' : 'Подтянуть со склада КТ'}
      </button>
      {msg ? <span className={`text-[11.5px] ${msg.ok ? 'text-mute' : 'text-rust'}`}>{msg.text}</span> : null}
    </div>
  );
}
