'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { runAdsSync, adsSyncStatus, type AdsSyncStatus } from '@/app/actions/integrations';
import Tip from './Tip';

/**
 * Кнопка «обновить расход по потокам». Заход тяжёлый (десятки кабинетов с
 * паузами против чекпоинта, минуты), поэтому НЕ держим http-запрос — иначе
 * браузер рвёт соединение по таймауту («NetworkError»). Вместо этого дёргаем
 * фоновый запуск и опрашиваем статус, пока заход идёт; по завершении
 * обновляем страницу, чтобы подтянулись свежие цифры.
 */
export default function SyncAds() {
  const router = useRouter();
  const [status, setStatus] = useState<AdsSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
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
        // Заход только что закончился — подтянем свежие данные в таблицу.
        if (wasRunning.current) {
          wasRunning.current = false;
          router.refresh();
        }
      }
    } catch {
      // Статус не прочитался (сеть моргнула) — не залипаем, попробуем ещё раз.
      timer.current = setTimeout(poll, 5000);
    }
  }, [router]);

  // На заходе проверим: вдруг синк уже идёт (запустили с другого экрана/вкладки).
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
      await runAdsSync();
    } catch {
      /* запуск лёгкий, но если не долетел — статус ниже покажет, что не идёт */
    }
    if (timer.current) clearTimeout(timer.current);
    poll();
  };

  const finished = status && !status.running && status.finishedAt;

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Tip label="Тянет статистику и расход за последние 3 дня и заливает cost в Keitaro. Идёт в фоне — можно уйти со страницы, догрузится сам.">
        <button
          type="button"
          disabled={busy}
          onClick={onClick}
          className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
            busy ? 'cursor-progress opacity-60' : ''
          }`}
        >
          {busy ? 'Тяну стату…' : 'Обновить стату'}
        </button>
      </Tip>
      {busy ? null : finished ? (
        <span className="text-[11.5px] text-mute">
          обновлено {status!.touched}
          {status!.info.length ? (
            <>
              {' · '}
              <Tip label={<span className="flex flex-col gap-1">{status!.info.map((p) => <span key={p}>{p}</span>)}</span>}>
                <span className="cursor-help text-soft underline decoration-dotted">заливка</span>
              </Tip>
            </>
          ) : null}
          {status!.problems.length ? (
            <>
              {' · '}
              <Tip label={<span className="flex flex-col gap-1">{status!.problems.map((p) => <span key={p}>{p}</span>)}</span>}>
                <span className="cursor-help text-rust underline decoration-dotted">проблемы: {status!.problems.length}</span>
              </Tip>
            </>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
