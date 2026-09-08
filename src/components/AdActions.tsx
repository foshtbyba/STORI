'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import { setAdRunning, duplicateAdAction, duplicateCampaignAction } from '@/app/actions/integrations';

/**
 * Кнопка запуск/пауза + меню «ещё» с действиями над объявлением. Меню рисуем
 * через портал с position:fixed — иначе его обрезала бы прокрутка таблицы
 * (overflow-x). Действия шлют команду в Facebook и обновляют страницу.
 *
 * Дубли создаются на паузе и появляются в таблице после следующей «Обновить
 * стату» — Facebook не отдаёт их мгновенно.
 */
export default function AdActions({
  id,
  active,
  onError,
}: {
  id: string;
  active: boolean;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Меню закрываем по клику вне, Escape и прокрутке — оно на fixed и иначе
  // «отклеится» от кнопки.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('click', close);
      clearTimeout(t);
    };
  }, [open]);

  const act = (fn: (prev: null, form: FormData) => Promise<{ ok: boolean; error?: string } | null>, extra?: Record<string, string>) => {
    setOpen(false);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id);
      for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
      const res = await fn(null, fd);
      if (res && !res.ok) onError(res.error ?? 'Не вышло');
      else router.refresh();
    });
  };

  const toggleMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.right, y: r.bottom + 6 });
    setOpen((v) => !v);
  };

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-soft transition hover:bg-sub disabled:opacity-50';

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => act(setAdRunning, { status: active ? 'PAUSED' : 'ACTIVE' })}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[10.5px] transition ${
          active ? 'bg-amber-t text-amber hover:opacity-80' : 'bg-sage-t text-sage hover:opacity-80'
        } ${pending ? 'cursor-progress opacity-60' : ''}`}
        title={active ? 'Поставить на паузу' : 'Запустить'}
      >
        {active ? 'пауза' : 'запуск'}
        <span className="text-[9px]">{active ? '⏸' : '▶'}</span>
      </button>

      <button
        ref={btnRef}
        type="button"
        disabled={pending}
        onClick={(e) => { e.stopPropagation(); toggleMenu(); }}
        className={`flex h-6 w-6 items-center justify-center rounded-full text-[15px] leading-none text-mute transition hover:bg-sub hover:text-soft ${pending ? 'cursor-progress opacity-60' : ''}`}
        title="Ещё действия"
        aria-label="Ещё действия"
      >
        ⋯
      </button>

      {open && pos && typeof document !== 'undefined'
        ? createPortal(
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'fixed', left: Math.min(pos.x, window.innerWidth - 8), top: pos.y, transform: 'translateX(-100%)' }}
              className="z-50 min-w-[210px] overflow-hidden rounded-xl border border-line2 bg-raise py-1 shadow-lg"
            >
              <button type="button" className={item} disabled={pending} onClick={() => act(duplicateAdAction)}>
                🧬 Дублировать объявление
              </button>
              <button type="button" className={item} disabled={pending} onClick={() => act(duplicateCampaignAction)}>
                📄 Дублировать кампанию
              </button>
              <div className="my-1 border-t border-line" />
              <div className="px-3 py-1.5 text-[10.5px] text-dim">Скоро: смена текста, перемодерка</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
