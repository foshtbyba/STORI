'use client';

import { useEffect, useRef, useState } from 'react';

export type AgentOpt = { id: string; name: string; commissionBps: number };

const pct = (bps: number) => (bps / 100).toString().replace('.', ',');

/**
 * Презентационный выбор агента в стиле приложения (нативный select рисует список
 * средствами ОС и выбивается из дизайна). Контролируемый: value — id агента ('' =
 * не выбран), onChange(id). Используется и на кабинете (Интеграции), и в строках
 * «Доп. расходов».
 */
export default function AgentSelect({
  value,
  agents,
  onChange,
  disabled = false,
  invalid = false,
  size = 'sm',
}: {
  value: string;
  agents: AgentOpt[];
  onChange: (id: string) => void;
  disabled?: boolean;
  /** Подсветить красным (напр. строка с суммой без агента). */
  invalid?: boolean;
  /** 'sm' — пилюля (кабинет), 'md' — поле в строке таблицы. */
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current = agents.find((a) => a.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const choose = (id: string) => { setOpen(false); if (id !== value) onChange(id); };

  const btn =
    size === 'md'
      ? `flex h-10 w-full items-center justify-between gap-2 rounded-lg border px-3 text-[13px] transition disabled:opacity-50 ${
          invalid ? 'border-rust text-rust' : current ? 'border-line text-text' : 'border-line text-mute'
        } bg-sub`
      : `flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10.5px] transition disabled:opacity-50 ${
          current ? 'border-teal/40 bg-teal-t text-teal' : 'border-line bg-raise text-soft hover:text-text'
        }`;

  const itemCls = (active: boolean) =>
    `flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition ${
      active ? 'bg-teal-t text-teal' : 'text-soft hover:bg-raise hover:text-text'
    }`;

  return (
    <div ref={wrapRef} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={disabled} className={btn}>
        <span className={size === 'md' ? 'truncate' : 'max-w-[120px] truncate'}>
          {current ? `${current.name} · ${pct(current.commissionBps)}%` : '— агент —'}
        </span>
        <svg width={size === 'md' ? 14 : 10} height={size === 'md' ? 14 : 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[180px] max-w-[260px] rounded-2xl border border-line p-1.5"
          style={{ background: 'var(--color-panel)', boxShadow: '0 12px 32px -8px rgba(0,0,0,.55)' }}
        >
          <button type="button" onClick={() => choose('')} className={itemCls(!value)}>
            <span>— без агента —</span>
            {!value ? <Check /> : null}
          </button>
          {agents.length ? (
            <div className="my-1 border-t border-line" />
          ) : (
            <div className="px-2.5 py-1.5 text-[11px] text-mute">Агентов нет — заведи их кнопкой «Агенты» в «Доп. расходах».</div>
          )}
          {agents.map((a) => (
            <button key={a.id} type="button" onClick={() => choose(a.id)} className={itemCls(a.id === value)}>
              <span className="truncate">{a.name}</span>
              <span className="flex items-center gap-1.5">
                <span className="n text-[11px] opacity-80">{pct(a.commissionBps)}%</span>
                {a.id === value ? <Check /> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Check() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}
