'use client';

import { useEffect, useRef, useState } from 'react';
import { loadRecentJobs, type JobRow } from '@/app/actions/autoupload';

const fmt = (iso: string) => {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const dot = (s: string) => (s === 'done' ? 'text-sage' : s === 'error' ? 'text-rust' : 'text-amber');
const label = (s: string) => (s === 'done' ? '✓ готово' : s === 'error' ? '✗ ошибка' : '⏳ идёт');

/**
 * Журнал заливов — недавние UploadJob с автообновлением. Залив уходит в фон, а
 * тут видно статус/журнал: можно уйти со страницы и вернуться за результатом.
 */
export default function JobsJournal({ pollMs = 5000, defaultExpanded = false }: { pollMs?: number; defaultExpanded?: boolean }) {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [open, setOpen] = useState('');
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const running = jobs.filter((j) => j.status === 'running').length;

  const refresh = async () => {
    try { setJobs(await loadRecentJobs()); } catch { /* тихо */ }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, pollMs);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  return (
    <div className="rounded-[16px] border border-line2 bg-panel/60 p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`shrink-0 text-mute transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[14px] font-semibold">Журнал заливов</span>
          {jobs.length ? <span className="text-[12px] text-mute">{jobs.length}{running ? ` · ⏳ ${running}` : ''}</span> : null}
          <span className="text-[11.5px] text-dim">{expanded ? 'обновляется сам' : 'раскрыть'}</span>
        </button>
        {expanded ? <button type="button" onClick={refresh} className="shrink-0 text-[11.5px] text-mute transition hover:text-sage">обновить</button> : null}
      </div>
      {!expanded ? null : loading && jobs.length === 0 ? (
        <p className="mt-3 text-[12px] text-mute">Загружаю…</p>
      ) : jobs.length === 0 ? (
        <p className="mt-3 text-[12px] text-mute">Пока пусто. Запусти залив — он появится здесь.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {jobs.map((j) => {
            const isOpen = open === j.id;
            return (
              <div key={j.id} className={`rounded-[12px] border bg-sub px-3.5 py-2.5 ${j.status === 'error' ? 'border-rust/40' : j.status === 'running' ? 'border-amber/40' : 'border-line'}`}>
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className={`shrink-0 ${dot(j.status)}`}>{label(j.status)}</span>
                  <span className="min-w-0 flex-1 truncate text-soft">{j.campaignName || 'без имени'} <span className="text-mute">· {j.accountName}</span></span>
                  <span className="shrink-0 text-[11px] text-dim">{fmt(j.createdAt)}</span>
                  <span className={`shrink-0 text-[11.5px] ${j.status === 'running' ? 'text-amber' : 'text-mute'}`}>
                    {j.status === 'error'
                      ? (j.error || 'ошибка')
                      : j.status === 'running'
                        ? (j.stage || 'идёт…')
                        : `${j.adsCreated}/${j.adsPlanned || j.adsCreated} объявл.`}
                  </span>
                  {j.log ? <button type="button" onClick={() => setOpen(isOpen ? '' : j.id)} className="shrink-0 text-[11px] text-mute transition hover:text-sage">{isOpen ? 'скрыть' : 'журнал'}</button> : null}
                </div>
                {isOpen && j.log ? <pre className="scroll-slim mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{j.log}</pre> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
