'use client';

import { useActionState, useState } from 'react';
import { replaceToken, replaceMyToken, type ActionState } from '@/app/actions/integrations';
import SubmitButton from './SubmitButton';

/**
 * Подкинуть новый мультитокен существующему профилю, не отвязывая его.
 *
 * Сессионный ключ слетает — раньше приходилось удалять профиль и заводить
 * заново. Теперь просто вставляем свежий мультитокен: подписи, флаги агентских и
 * привязки остаются. Прокси необязателен — пусто оставит прежний.
 */
const field =
  'h-10 w-full rounded-xl border border-line2 bg-sub px-3.5 text-[13px] text-text outline-none transition focus:border-sage';

export default function ReplaceToken({ tokenId, own = false }: { tokenId: string; own?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(own ? replaceMyToken : replaceToken, null as ActionState);
  const [proxyKind, setProxyKind] = useState<'http' | 'socks5'>('http');

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-sub px-3.5 py-1.5 text-[12px] text-soft transition hover:text-text"
        title="Слетел токен — вставь новый мультитокен, профиль и кабинеты сохранятся"
      >
        ↻ обновить токен
      </button>
    );
  }

  return (
    <form action={action} className="mt-1 w-full max-w-2xl rounded-[18px] bg-sub p-3.5">
      <input type="hidden" name="id" value={tokenId} />
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold">Новый токен профиля</span>
        <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] text-dim transition hover:text-soft">
          свернуть
        </button>
      </div>
      <textarea
        name="token"
        placeholder="мультитокен eyJ… (или EAAB…)"
        rows={2}
        className={`${field} n h-auto resize-y py-2.5`}
        required
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-mute">Прокси · пусто оставит прежний</span>
        <div className="flex items-center gap-1 rounded-full bg-raise p-1">
          {([
            ['http', 'HTTP'],
            ['socks5', 'SOCKS5'],
          ] as const).map(([value, title]) => (
            <button
              key={value}
              type="button"
              onClick={() => setProxyKind(value)}
              aria-pressed={proxyKind === value}
              className={`rounded-full px-3 py-1 text-[11px] transition ${
                proxyKind === value ? 'bg-sub font-semibold text-text' : 'text-mute hover:text-soft'
              }`}
            >
              {title}
            </button>
          ))}
        </div>
      </div>
      <input type="hidden" name="proxyKind" value={proxyKind} />
      <input name="proxyUrl" placeholder="1.2.3.4:8000:логин:пароль" className={`${field} n mt-1.5`} />

      <div className="mt-2.5 flex justify-end">
        <SubmitButton
          pendingLabel="Проверяю токен…"
          className="rounded-full bg-sage px-5 py-2 text-[12.5px] font-semibold text-bg transition hover:opacity-90"
        >
          Проверить и обновить
        </SubmitButton>
      </div>
      {state ? (
        <div
          className="mt-2.5 rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{
            background: state.ok ? '#252e1e' : '#2c1f1a',
            color: state.ok ? '#b4c68c' : '#ce6e58',
          }}
        >
          {state.ok ? state.message : state.error}
        </div>
      ) : null}
    </form>
  );
}
