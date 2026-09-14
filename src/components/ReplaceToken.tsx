'use client';

import { useActionState, useState } from 'react';
import { replaceToken, replaceMyToken, type ActionState } from '@/app/actions/integrations';
import { proxyUrlToInput } from '@/lib/proxy';
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

export default function ReplaceToken({ tokenId, own = false, proxy = '' }: { tokenId: string; own?: boolean; proxy?: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(own ? replaceMyToken : replaceToken, null as ActionState);
  // Прежний прокси профиля подставляем как есть: токен меняем — прокси остаётся.
  const prevProxy = proxyUrlToInput(proxy);
  const [proxyKind, setProxyKind] = useState<'http' | 'socks5'>(prevProxy.kind);

  return (
    <>
      {/* Кнопка-триггер всегда на месте (первой в ряду), форма раскрывается
          плавно под ней (grid-rows 0fr→1fr). */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`order-first rounded-full px-3.5 py-1.5 text-[12px] transition ${open ? 'bg-sage-t text-sage' : 'bg-sub text-soft hover:text-text'}`}
        title="Слетел токен — вставь новый мультитокен, профиль и кабинеты сохранятся"
      >
        ↻ обновить токен
      </button>
      <div className={`order-last grid basis-full transition-[grid-template-rows] duration-300 ease-out ${open ? 'mt-1 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <form action={action} className="w-full max-w-2xl rounded-[18px] bg-sub p-3.5">
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
        <span className="text-[11px] text-mute">Прокси профиля · остаётся прежним</span>
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
      <input name="proxyUrl" defaultValue={prevProxy.text} placeholder="1.2.3.4:8000:логин:пароль" className={`${field} n mt-1.5`} />

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
        </div>
      </div>
    </>
  );
}
