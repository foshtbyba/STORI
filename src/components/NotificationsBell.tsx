'use client';

import { useEffect, useRef, useState } from 'react';
import { markActivitySeen, fetchActivityFeed } from '@/app/actions/activity';
import type { ActivityItem } from '@/lib/activity';

/** Иконка события по типу — короткий эмодзи для наглядности. */
const ICON: Record<string, string> = {
  autoupload: '🚀',
  cabinet_added: '➕',
  tiktok_connected: '🎵',
  brocard_topup: '💳',
  team_lead: '👋',
  domain: '🌐',
  birthday: '🎂',
};

/** Колокольчик уведомлений: бейдж непрочитанных + выпадающая лента. */
export default function NotificationsBell({ items, unread }: { items: ActivityItem[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ActivityItem[]>(items);
  const [count, setCount] = useState(unread);
  const ref = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  // Клик вне — закрыть.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Живой фид: опрос раз в 25с + при возврате фокуса на вкладку. Layout в App
  // Router не перерисовывается при переходах, поэтому тянем свежее сами.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const f = await fetchActivityFeed();
        if (!alive) return;
        setList(f.items);
        // Если панель открыта — считаем прочитанным (бейдж не мигает).
        setCount(openRef.current ? 0 : f.unread);
      } catch { /* тихо */ }
    };
    const id = setInterval(refresh, 25_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { alive = false; clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && count > 0) {
      setCount(0);
      markActivitySeen().catch(() => {});
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Уведомления"
        title="Уведомления"
        className="relative flex h-8 w-8 items-center justify-center rounded-full bg-sub transition hover:bg-raise"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8a8a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rust px-1 text-[10px] font-semibold text-white">
            {count > 9 ? '9+' : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-2 max-h-[70vh] w-[320px] overflow-auto rounded-[14px] border border-line bg-panel p-2 shadow-xl">
          <div className="px-2 py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-mute">Уведомления</div>
          {list.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12.5px] text-mute">Пока пусто</div>
          ) : (
            <div className="flex flex-col">
              {list.map((it) => (
                <div key={it.id} className="flex items-start gap-2.5 rounded-[10px] px-2 py-2 transition hover:bg-sub">
                  <span className="mt-0.5 shrink-0 text-[15px]">{ICON[it.kind] ?? '•'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] leading-snug text-soft">{it.message}</div>
                    <div className="mt-0.5 text-[11px] text-dim">
                      {it.actorName ? `${it.actorName} · ` : ''}{it.when}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
