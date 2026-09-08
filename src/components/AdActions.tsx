'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPortal } from 'react-dom';
import {
  setAdRunning, duplicateAction,
  remoderateAd, renameAdAction, getAdText, setAdText,
} from '@/app/actions/integrations';

type DupLevel = 'ad' | 'adset' | 'campaign';

type ActionFn = (prev: null, form: FormData) => Promise<{ ok: boolean; error?: string } | null>;

/**
 * Кнопка запуск/пауза + меню «ещё» с действиями над объявлением. Меню и модалка
 * смены текста рисуются через портал (position:fixed) — иначе их обрезала бы
 * прокрутка таблицы. Все правки идут в Facebook и обновляют страницу.
 */
export default function AdActions({
  id,
  active,
  name,
  onError,
  onOk,
}: {
  id: string;
  active: boolean;
  name: string;
  onError: (msg: string) => void;
  onOk: (msg: string) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState<null | { message: string; headline: string; description: string }>(null);
  const [dup, setDup] = useState<null | { level: DupLevel; count: number }>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

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

  const run = (fn: ActionFn, extra?: Record<string, string>, okMsg?: string) => {
    setOpen(false);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id);
      for (const [k, v] of Object.entries(extra ?? {})) fd.set(k, v);
      const res = await fn(null, fd);
      if (res && !res.ok) onError(res.error ?? 'Не вышло');
      else { if (okMsg) onOk(okMsg); router.refresh(); }
    });
  };

  const toggleMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.right, y: r.bottom + 6 });
    setOpen((v) => !v);
  };

  const openTextEditor = () => {
    setOpen(false);
    start(async () => {
      const res = await getAdText(id);
      if (!res.ok) { onError(res.error ?? 'Не удалось прочитать текст'); return; }
      setText({ message: res.message ?? '', headline: res.headline ?? '', description: res.description ?? '' });
    });
  };

  const saveText = () => {
    if (!text) return;
    const t = text;
    setText(null);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id);
      fd.set('message', t.message); fd.set('headline', t.headline); fd.set('description', t.description);
      const res = await setAdText(null, fd);
      if (res && !res.ok) onError(res.error ?? 'Не вышло');
      else { onOk('Текст изменён — объявление ушло на ре-модерацию'); router.refresh(); }
    });
  };

  const runDup = () => {
    if (!dup) return;
    const { level, count } = dup;
    setDup(null);
    const label = level === 'campaign' ? 'кампании' : level === 'adset' ? 'адсета' : 'объявления';
    run(duplicateAction, { level, count: String(count) }, `Копий ${label}: ${count} (на паузе). Появятся после «Обновить стату» / в Ads Manager.`);
  };

  const saveRename = () => {
    const v = (renaming ?? '').trim();
    setRenaming(null);
    if (!v) return;
    run(renameAdAction, { name: v }, 'Переименовано');
  };

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-soft transition hover:bg-sub disabled:opacity-50';

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => run(setAdRunning, { status: active ? 'PAUSED' : 'ACTIVE' })}
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
              className="z-50 min-w-[230px] overflow-hidden rounded-xl border border-line2 bg-raise py-1 shadow-lg"
            >
              <button type="button" className={item} disabled={pending} onClick={() => { setOpen(false); setDup({ level: 'ad', count: 1 }); }}>🧬 Дублировать…</button>
              <div className="my-1 border-t border-line" />
              <button type="button" className={item} disabled={pending} onClick={() => run(remoderateAd, undefined, 'Отправлено на ре-модерацию')}>🔁 Перемодерация (точка)</button>
              <button type="button" className={item} disabled={pending} onClick={openTextEditor}>✏️ Сменить текст…</button>
              <button type="button" className={item} disabled={pending} onClick={() => { setOpen(false); setRenaming(name); }}>🏷️ Переименовать…</button>
            </div>,
            document.body,
          )
        : null}

      {renaming !== null && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setRenaming(null)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-line2 bg-raise p-5 text-left shadow-2xl">
                <div className="mb-3 text-[14px] font-semibold text-text">Переименовать объявление</div>
                <input
                  value={renaming}
                  onChange={(e) => setRenaming(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }}
                  autoFocus
                  className="mb-4 w-full rounded-lg border border-line2 bg-sub px-3 py-2 text-[12.5px] text-text outline-none focus:border-sage"
                />
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setRenaming(null)} className="rounded-full px-4 py-1.5 text-[12px] text-mute hover:text-soft">Отмена</button>
                  <button type="button" disabled={pending} onClick={saveRename} className="rounded-full bg-sage-t px-4 py-1.5 text-[12px] font-semibold text-sage hover:opacity-80 disabled:opacity-50">Сохранить</button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {dup && typeof document !== 'undefined'
        ? createPortal(
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={() => setDup(null)}>
              <div onClick={(e) => e.stopPropagation()} className="w-full max-w-xs rounded-2xl border border-line2 bg-raise p-5 text-left shadow-2xl">
                <div className="mb-3 text-[14px] font-semibold text-text">Что дублировать?</div>
                <div className="mb-3 flex flex-col gap-1">
                  {([['ad', 'Объявление'], ['adset', 'Адсет (группу)'], ['campaign', 'Кампанию']] as const).map(([v, t]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDup({ ...dup, level: v })}
                      className={`rounded-lg px-3 py-2 text-left text-[12.5px] transition ${dup.level === v ? 'bg-sage-t text-sage font-semibold' : 'bg-sub text-soft hover:text-text'}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <div className="mb-1 text-[11px] text-mute">Сколько копий</div>
                <input
                  type="number"
                  min={1}
                  max={dup.level === 'campaign' ? 3 : 20}
                  value={dup.count}
                  onChange={(e) => setDup({ ...dup, count: Math.max(1, Math.round(Number(e.target.value) || 1)) })}
                  className="n mb-4 w-full rounded-lg border border-line2 bg-sub px-3 py-2 text-[13px] text-text outline-none focus:border-sage"
                />
                <div className="mb-3 text-[10.5px] text-dim">Копии создаются на паузе. Кампания/адсет собираются по частям (это чуть дольше).</div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setDup(null)} className="rounded-full px-4 py-1.5 text-[12px] text-mute hover:text-soft">Отмена</button>
                  <button type="button" disabled={pending} onClick={runDup} className="rounded-full bg-sage-t px-4 py-1.5 text-[12px] font-semibold text-sage hover:opacity-80 disabled:opacity-50">Дублировать</button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {text && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
              onClick={() => setText(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-2xl border border-line2 bg-raise p-5 text-left shadow-2xl"
              >
                <div className="mb-3 text-[14px] font-semibold text-text">Сменить текст объявления</div>
                <div className="mb-1 text-[11px] text-mute">Заголовок</div>
                <input
                  value={text.headline}
                  onChange={(e) => setText({ ...text, headline: e.target.value })}
                  className="mb-3 w-full rounded-lg border border-line2 bg-sub px-3 py-2 text-[12.5px] text-text outline-none focus:border-sage"
                />
                <div className="mb-1 text-[11px] text-mute">Основной текст</div>
                <textarea
                  value={text.message}
                  onChange={(e) => setText({ ...text, message: e.target.value })}
                  rows={4}
                  className="mb-3 w-full resize-y rounded-lg border border-line2 bg-sub px-3 py-2 text-[12.5px] text-text outline-none focus:border-sage"
                />
                <div className="mb-1 text-[11px] text-mute">Описание</div>
                <input
                  value={text.description}
                  onChange={(e) => setText({ ...text, description: e.target.value })}
                  className="mb-4 w-full rounded-lg border border-line2 bg-sub px-3 py-2 text-[12.5px] text-text outline-none focus:border-sage"
                />
                <div className="text-[10.5px] text-dim mb-3">После сохранения объявление уйдёт на ре-модерацию — это нормально.</div>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setText(null)} className="rounded-full px-4 py-1.5 text-[12px] text-mute hover:text-soft">Отмена</button>
                  <button type="button" disabled={pending} onClick={saveText} className="rounded-full bg-sage-t px-4 py-1.5 text-[12px] font-semibold text-sage hover:opacity-80 disabled:opacity-50">Сохранить</button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
