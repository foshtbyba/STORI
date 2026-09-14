'use client';

import { useState } from 'react';
import { Avatar, Sub } from './ui';
import TokenLabel from './TokenLabel';
import ConfirmSubmit from './ConfirmSubmit';
import ReplaceToken from './ReplaceToken';
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
  /** Хранимый URL прокси профиля — чтобы подставить его при обновлении токена. */
  proxy?: string;
  paused: boolean;
  /** Последняя ошибка токена (сессия слетела/бан). Пусто — токен здоров. */
  error: string;
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
  const [showBanned, setShowBanned] = useState(false);

  // Короткая сводка для свёрнутого вида: считаем только кабинеты, что реально в
  // трекинге. Выключенный из синхронизации кабинет (в том числе давно
  // забаненный, который убрали) в сводку «бан N» вверху не попадает — иначе она
  // копит мёртвые кабинеты и перестаёт отражать живую картину.
  const tracked = group.accounts.filter((a) => a.enabled);
  const bad = tracked.filter((a) => a.badge.tone === 'bad').length;
  const warn = tracked.filter((a) => a.badge.tone === 'warn').length;

  // Забаненные (бан/закрыт/отключён) в открытом виде занимают половину экрана и
  // мешают смотреть на рабочие. Прячем их под кнопку, а рабочие показываем
  // сразу. Внутри — рабочие вперёд: активные, потом риск/проверка.
  const rank = (t: StatusTone) => (t === 'ok' ? 0 : t === 'warn' ? 1 : t === 'mute' ? 2 : 3);
  const sorted = [...group.accounts].sort((a, b) => rank(a.badge.tone) - rank(b.badge.tone));
  const live = sorted.filter((a) => a.badge.tone !== 'bad');
  const banned = sorted.filter((a) => a.badge.tone === 'bad');

  // Плитка кабинета — одна на рабочие и на забаненные, чтобы не расходились.
  const renderAcc = (acc: AccountRow) => (
    <Sub key={acc.id} className={`px-3.5 py-2 ${acc.enabled ? '' : 'opacity-55'}`}>
      {/* Строка 1: имя + статус справа от него, сумма у правого края. */}
      <div className="flex items-center gap-2">
        <span className={`shrink-0 truncate text-[12.5px] ${acc.enabled ? 'text-soft' : 'text-dim line-through'}`}>
          {acc.name || acc.externalId.replace(/^act_/, '')}
        </span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${TONE[acc.badge.tone]}`}>
          {acc.badge.label}
        </span>
        {acc.agency ? (
          <span className="shrink-0 rounded-full bg-teal-t px-2 py-0.5 text-[10px] text-teal">агентский</span>
        ) : null}
        {acc.duplicate ? (
          <span className="shrink-0 rounded-full bg-sub px-2 py-0.5 text-[10px] text-dim" title="Тот же act_ID виден под другим профилем">
            дубль
          </span>
        ) : null}
        <span className="n ml-auto shrink-0 text-[12.5px] text-mute">
          {acc.spend}
          {acc.currency !== 'USD' ? <span className="ml-1 text-rust">{acc.currency}</span> : null}
        </span>
      </div>

      {group.admin ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          <form action={toggleAccount}>
            <input type="hidden" name="id" value={acc.id} />
            <button
              type="submit"
              title={acc.enabled ? 'Расход тянется — нажми, чтобы исключить из синхронизации' : 'Исключён из синхронизации — нажми, чтобы вернуть'}
              className={`rounded-full px-2.5 py-1 text-[10.5px] transition ${
                acc.enabled ? 'bg-sage-t text-sage' : 'bg-raise text-dim hover:text-soft'
              }`}
            >
              {acc.enabled ? '✓ тянуть расход' : 'не тянуть'}
            </button>
          </form>
          <form action={toggleAgency}>
            <input type="hidden" name="id" value={acc.id} />
            <button
              type="submit"
              title={acc.agency ? 'Агентский — расход идёт в агентский автоматически. Нажми, чтобы снять' : 'Пометить агентским — его расход пойдёт в агентский автоматически'}
              className={`rounded-full px-2.5 py-1 text-[10.5px] transition ${
                acc.agency ? 'bg-teal-t text-teal' : 'bg-raise text-soft hover:text-text'
              }`}
            >
              {acc.agency ? '★ агентский' : 'в агентский'}
            </button>
          </form>
          <span className="n ml-auto text-[10px] text-dim" title={`ID кабинета в Facebook: ${acc.externalId}`}>
            {acc.externalId.replace(/^act_/, '')}
          </span>
        </div>
      ) : (
        <div className="mt-1 text-right">
          <span className="n text-[10px] text-dim" title={`ID кабинета в Facebook: ${acc.externalId}`}>
            {acc.externalId.replace(/^act_/, '')}
          </span>
        </div>
      )}
    </Sub>
  );

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        className="flex w-full cursor-pointer flex-wrap items-center gap-3 text-left"
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
            {/* Состояние токена: слетел → красным, на паузе → жёлтым, иначе «активен». */}
            {group.error ? (
              <span className="ml-2 rounded-full bg-rust-t px-2 py-0.5 text-[10px] text-rust" title={group.error}>токен слетел</span>
            ) : group.paused ? (
              <span className="ml-2 rounded-full bg-amber-t px-2 py-0.5 text-[10px] text-amber">на паузе</span>
            ) : (
              <span className="ml-2 rounded-full bg-sage-t px-2 py-0.5 text-[10px] text-sage">активен</span>
            )}
          </span>
        </span>

        {/* Сводка статусов в свёрнутом виде */}
        <span className="flex items-center gap-1.5 text-[11px]">
          {bad ? <span className="rounded-full bg-rust-t px-2 py-0.5 text-rust">бан {bad}</span> : null}
          {warn ? <span className="rounded-full bg-amber-t px-2 py-0.5 text-amber">риск {warn}</span> : null}
          <button
            type="button"
            aria-label={open ? 'Свернуть' : 'Развернуть'}
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-dim transition hover:bg-sub hover:text-soft"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </span>
      </div>

      {/* Плавное раскрытие: сетка 0fr→1fr анимирует высоту без «прыжка», а
          внутренний overflow-hidden прячет содержимое, пока свёрнуто. */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden">
          {group.admin ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ReplaceToken tokenId={group.tokenId} proxy={group.proxy} />
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <ReplaceToken tokenId={group.tokenId} own proxy={group.proxy} />
              <form action={deleteMyToken}>
                <input type="hidden" name="id" value={group.tokenId} />
                <button type="submit" className="px-1 text-[12px] text-dim transition hover:text-rust" title="Отвязать">
                  ✕ отвязать свой токен
                </button>
              </form>
            </div>
          ) : null}

          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((acc) => renderAcc(acc))}
          </div>

          {banned.length ? (
            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => setShowBanned((v) => !v)}
                className="rounded-full bg-sub px-3.5 py-1.5 text-[11.5px] text-mute transition hover:text-soft"
              >
                {showBanned ? `Скрыть забаненные (${banned.length})` : `Показать забаненные (${banned.length})`}
              </button>
              <div
                className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                  showBanned ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                }`}
              >
                <div className="overflow-hidden">
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {banned.map((acc) => renderAcc(acc))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
