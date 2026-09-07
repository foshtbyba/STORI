'use client';

import { useState } from 'react';
import { Avatar, Sub } from './ui';
import TokenLabel from './TokenLabel';
import ConfirmSubmit from './ConfirmSubmit';
import { toggleAccount, toggleAgency, toggleToken, deleteToken, deleteMyToken } from '@/app/actions/integrations';
import type { StatusTone } from '@/lib/fb-status';

export type AccountRow = {
  id: string;
  externalId: string;
  name: string;
  currency: string;
  enabled: boolean;
  agency: boolean;
  duplicate: boolean;
  spend: string;
  badge: { label: string; tone: StatusTone };
};

export type Group = {
  tokenId: string;
  handle: string;
  initials: string;
  color: string;
  label: string;
  proxied: boolean;
  paused: boolean;
  updated: string | null;
  accounts: AccountRow[];
  /** Полное управление — у админа; свой кабинет баер только снимает. */
  admin: boolean;
  own: boolean;
};

const TONE: Record<StatusTone, string> = {
  ok: 'bg-sage-t text-sage',
  warn: 'bg-amber-t text-amber',
  bad: 'bg-rust-t text-rust',
  mute: 'bg-sub text-mute',
};

/**
 * Профиль (соц) со своими кабинетами — сворачивается по клику на шапку.
 * Свёрнутый показывает главное: кто, сколько кабинетов, когда обновлён, есть
 * ли проблемные статусы. Так длинный список профилей листается глазами.
 */
export default function AccountGroup({ group, defaultOpen = false }: { group: Group; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  // Короткая сводка для свёрнутого вида: сколько не активны.
  const bad = group.accounts.filter((a) => a.badge.tone === 'bad').length;
  const warn = group.accounts.filter((a) => a.badge.tone === 'warn').length;

  return (
    <div className="mt-3 border-t border-line pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center gap-3 text-left"
      >
        <Avatar initials={group.initials} color={group.color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[14.5px] font-semibold">
            {group.handle}
            {group.admin ? (
              <TokenLabel id={group.tokenId} label={group.label} />
            ) : group.label ? (
              <span className="text-[12px] font-normal text-mute">{group.label}</span>
            ) : null}
          </span>
          <span className="block text-[11.5px] text-mute">
            {group.updated ? `обновлено ${group.updated}` : 'ещё не синхронизировано'}
            {' · '}
            кабинетов {group.accounts.length}
            {group.proxied ? (
              <span className="ml-2 rounded-full bg-steel-t px-2 py-0.5 text-[10px] text-steel">через прокси</span>
            ) : null}
            {group.paused ? (
              <span className="ml-2 rounded-full bg-amber-t px-2 py-0.5 text-[10px] text-amber">на паузе</span>
            ) : null}
          </span>
        </span>

        {/* Сводка статусов в свёрнутом виде */}
        <span className="flex items-center gap-1.5 text-[11px]">
          {bad ? <span className="rounded-full bg-rust-t px-2 py-0.5 text-rust">бан {bad}</span> : null}
          {warn ? <span className="rounded-full bg-amber-t px-2 py-0.5 text-amber">риск {warn}</span> : null}
          <span className="text-dim">{open ? '▲' : '▼'}</span>
        </span>
      </button>

      {open ? (
        <>
          {group.admin ? (
            <div className="mt-3 flex items-center gap-2">
              <form action={toggleToken}>
                <input type="hidden" name="id" value={group.tokenId} />
                <button type="submit" className="rounded-full bg-sub px-3.5 py-1.5 text-[12px] text-soft transition hover:text-text">
                  вкл/выкл токен
                </button>
              </form>
              <form action={deleteToken}>
                <input type="hidden" name="id" value={group.tokenId} />
                <ConfirmSubmit
                  className="px-1 text-[13px] text-dim transition hover:text-rust"
                  armedClassName="!text-rust font-semibold"
                  title="Отвязать токен"
                >
                  ✕ отвязать
                </ConfirmSubmit>
              </form>
            </div>
          ) : group.own ? (
            <div className="mt-3">
              <form action={deleteMyToken}>
                <input type="hidden" name="id" value={group.tokenId} />
                <button type="submit" className="px-1 text-[12px] text-dim transition hover:text-rust" title="Отвязать">
                  ✕ отвязать свой токен
                </button>
              </form>
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {group.accounts.map((acc) => (
              <Sub key={acc.id} className={`px-3.5 py-2.5 ${acc.enabled ? '' : 'opacity-55'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`min-w-0 truncate text-[12.5px] ${acc.enabled ? 'text-soft' : 'text-dim line-through'}`}>
                    {acc.name || acc.externalId}
                  </span>
                  <span className="n shrink-0 text-[12.5px] text-mute">
                    {acc.spend}
                    {acc.currency !== 'USD' ? <span className="ml-1 text-rust">{acc.currency}</span> : null}
                  </span>
                </div>

                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${TONE[acc.badge.tone]}`}>{acc.badge.label}</span>
                  {acc.agency ? (
                    <span className="rounded-full bg-teal-t px-2 py-0.5 text-[10px] text-teal">агентский</span>
                  ) : null}
                  {acc.duplicate ? (
                    <span className="rounded-full bg-sub px-2 py-0.5 text-[10px] text-dim" title="Тот же act_ID виден под другим профилем">
                      дубль
                    </span>
                  ) : null}
                  <span className="n ml-auto text-[10px] text-dim" title="ID кабинета в Facebook">
                    {acc.externalId}
                  </span>
                </div>

                {group.admin ? (
                  <div className="mt-2 flex items-center gap-1.5">
                    <form action={toggleAccount}>
                      <input type="hidden" name="id" value={acc.id} />
                      <button type="submit" className="rounded-full bg-raise px-2.5 py-1 text-[10.5px] text-soft transition hover:text-text">
                        {acc.enabled ? 'в синке' : 'выкл'}
                      </button>
                    </form>
                    <form action={toggleAgency}>
                      <input type="hidden" name="id" value={acc.id} />
                      <button
                        type="submit"
                        className={`rounded-full px-2.5 py-1 text-[10.5px] transition ${
                          acc.agency ? 'bg-teal-t text-teal' : 'bg-raise text-soft hover:text-text'
                        }`}
                      >
                        {acc.agency ? '★ агентский' : 'сделать агентским'}
                      </button>
                    </form>
                  </div>
                ) : null}
              </Sub>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
