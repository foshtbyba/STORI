'use client';

import { useState, useTransition } from 'react';
import { syncTiktokToken, deleteTiktokToken } from '@/app/actions/tiktok';

export type TiktokAccountView = {
  id: string;
  advertiserId: string;
  name: string;
  currency: string;
  status: string;
  statusReason: string;
  balance: string;
  spend: string;
  dead: boolean;
};

export type TiktokTokenView = {
  id: string;
  label: string;
  handle: string;
  status: string;
  error: string;
  updated: string | null;
  canManage: boolean;
  accounts: TiktokAccountView[];
};

const statusLabel = (s: string) =>
  s === 'STATUS_ENABLE' ? { text: 'активен', tone: 'text-sage' }
  : s === 'STATUS_DISABLE' ? { text: 'отключён', tone: 'text-rust' }
  : { text: s.replace(/^STATUS_/, '').toLowerCase(), tone: 'text-amber' };

/** Одно подключение TikTok: кабинеты под токеном + синк/отключение. */
export default function TiktokTokenCard({ token }: { token: TiktokTokenView }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const sync = () =>
    start(async () => {
      const r = await syncTiktokToken(token.id);
      setMsg(r?.ok ? { ok: true, text: r.info || 'Обновлено' } : { ok: false, text: r?.error || 'Ошибка' });
    });

  const disconnect = () =>
    start(async () => {
      const r = await deleteTiktokToken(token.id);
      if (!r?.ok) setMsg({ ok: false, text: r?.error || 'Ошибка' });
    });

  return (
    <div className="mt-3 rounded-[14px] border border-line px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-soft">{token.handle}{token.label ? ` · ${token.label}` : ''}</span>
        <span className="text-[11px] text-mute">{token.accounts.length} кабинетов</span>
        {token.updated ? <span className="text-[11px] text-dim">· синк {token.updated}</span> : null}
        {token.canManage ? (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={sync} disabled={pending} className={`rounded-full border border-line2 px-3 py-1 text-[11.5px] text-mute transition hover:border-sage hover:text-sage ${pending ? 'opacity-50' : ''}`}>
              {pending ? 'Синхронизирую…' : 'Синхронизировать'}
            </button>
            {confirmDel ? (
              <>
                <button type="button" onClick={disconnect} disabled={pending} className="rounded-full border border-rust px-3 py-1 text-[11.5px] text-rust transition hover:brightness-110">Точно отключить</button>
                <button type="button" onClick={() => setConfirmDel(false)} className="rounded-full border border-line2 px-3 py-1 text-[11.5px] text-mute transition hover:text-text">Отмена</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDel(true)} className="rounded-full border border-line2 px-3 py-1 text-[11.5px] text-mute transition hover:border-rust hover:text-rust">Отключить</button>
            )}
          </div>
        ) : null}
      </div>

      {token.error ? <div className="mt-1.5 text-[11px] text-rust">Ошибка: {token.error}</div> : null}
      {msg ? <div className={`mt-1.5 text-[11px] ${msg.ok ? 'text-sage' : 'text-rust'}`}>{msg.text}</div> : null}

      {token.accounts.length === 0 ? (
        <p className="mt-2 text-[11.5px] text-mute">Кабинетов под этим подключением нет — нажми «Синхронизировать».</p>
      ) : (
        <div className="mt-2 flex flex-col gap-1">
          {token.accounts.map((a) => {
            const st = statusLabel(a.status);
            return (
              <div key={a.id} className="flex items-center gap-2 rounded-[10px] border border-line2 px-3 py-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-soft">{a.name || a.advertiserId}</span>
                  <span className="ml-2 text-dim">{a.advertiserId}</span>
                  {a.statusReason ? <span className="ml-2 text-rust">· {a.statusReason}</span> : null}
                </span>
                <span className={`shrink-0 text-[11px] ${st.tone}`}>{st.text}</span>
                <span className="shrink-0 text-[11px] text-mute">баланс {a.balance}</span>
                <span className="shrink-0 text-[11.5px] text-soft">{a.spend} <span className="text-dim">/нед</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
