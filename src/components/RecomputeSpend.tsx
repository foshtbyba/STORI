'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { runAdsSyncDeep, adsSyncStatus, type AdsSyncStatus } from '@/app/actions/integrations';
import Tip from './Tip';

/**
 * Кнопка «Пересчитать расход за 14 дней» на кассе. Перетягивает ad-level расход
 * за 14 дней (а не 3, как обычное «Обновить стату») и заново считает «Агентку»
 * по ad-level — так возвращается расход, пропавший после отвязки/возврата
 * агентского кабинета. Заход тяжёлый и идёт в фоне: опрашиваем общий статус
 * синка, по завершении обновляем страницу, чтобы сверить кассу.
 */
const DEPTHS = [14, 30, 60] as const;

export default function RecomputeSpend() {
  const router = useRouter();
  const [status, setStatus] = useState<AdsSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number>(14);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s = await adsSyncStatus();
      setStatus(s);
      if (s.running) {
        wasRunning.current = true;
        setBusy(true);
        timer.current = setTimeout(poll, 4000);
      } else {
        setBusy(false);
        if (wasRunning.current) {
          wasRunning.current = false;
          router.refresh();
        }
      }
    } catch {
      timer.current = setTimeout(poll, 5000);
    }
  }, [router]);

  useEffect(() => {
    poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    wasRunning.current = true;
    try {
      await runAdsSyncDeep(days);
    } catch {
      /* запуск лёгкий; статус ниже покажет, идёт ли */
    }
    if (timer.current) clearTimeout(timer.current);
    poll();
  };

  const finished = status && !status.running && status.finishedAt;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {/* Глубина пересчёта: 14 по умолчанию, глубже — если дыра в расходе старше. */}
      <div className="flex items-center gap-1 rounded-full bg-sub p-0.5">
        {DEPTHS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={busy}
            onClick={() => setDays(d)}
            className={`rounded-full px-2.5 py-1 text-[11.5px] transition ${
              days === d ? 'bg-sage-t text-sage' : 'text-mute hover:text-soft'
            } ${busy ? 'opacity-60' : ''}`}
          >
            {d} дн
          </button>
        ))}
      </div>
      <Tip label="Перетягивает расход по объявлениям за выбранное число дней и заново считает «Агентку». Нужно, когда расход пропал (напр. после отвязки/возврата агентского кабинета) — обычное «Обновить стату» тянет только 3 дня. Чем глубже окно, тем дольше заход. Идёт в фоне; по завершении цифры кассы обновятся.">
        <button
          type="button"
          disabled={busy}
          onClick={onClick}
          className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
            busy ? 'cursor-progress opacity-60' : ''
          }`}
        >
          {busy ? `Пересчитываю… (${days} дн)` : `Пересчитать расход · ${days} дн`}
        </button>
      </Tip>
      {busy ? (
        <span className="text-[11.5px] text-mute">идёт в фоне — страница обновится сама</span>
      ) : finished ? (
        <span className="text-[11.5px] text-mute">
          пересчитано {status!.touched}
          {status!.problems.length ? (
            <>
              {' · '}
              <Tip label={<span className="flex flex-col gap-1">{status!.problems.map((p, i) => <span key={i}>{p}</span>)}</span>}>
                <span className="cursor-help text-rust underline decoration-dotted">проблемы: {status!.problems.length}</span>
              </Tip>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
