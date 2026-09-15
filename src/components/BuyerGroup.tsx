'use client';

import { useState } from 'react';
import { Avatar } from './ui';
import AccountGroup, { type Group } from './AccountGroup';

/**
 * Баер со всеми его профилями (соцами). Свёрнутый показывает сразу главное:
 * сколько профилей активны, сколько слетело по токену, сколько на паузе, и
 * сколько всего кабинетов — чтобы проблемные баеры было видно, не раскрывая.
 * Клик по шапке раскрывает список профилей (каждый — свой AccountGroup).
 */
export default function BuyerGroup({ groups, defaultOpen = false }: { groups: Group[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const head = groups[0];

  // Токен профиля: слетел (error) → красный, на паузе → жёлтый, иначе активен.
  const dead = groups.filter((g) => g.error).length;
  const paused = groups.filter((g) => !g.error && g.paused).length;
  const active = groups.length - dead - paused;
  const cabinets = groups.reduce((n, g) => n + g.accounts.length, 0);

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v); } }}
        className="flex w-full cursor-pointer flex-wrap items-center gap-3 text-left"
      >
        <Avatar initials={head.initials} color={head.color} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[14.5px] font-semibold">{head.handle}</span>
          <span className="block text-[11.5px] text-mute">
            профилей {groups.length} · кабинетов {cabinets}
          </span>
        </span>

        {/* Сводка по токенам профилей — видно, не раскрывая баера. */}
        <span className="flex items-center gap-1.5 text-[11px]">
          {active ? <span className="rounded-full bg-sage-t px-2 py-0.5 text-sage" title="Профилей с живым токеном">активно {active}</span> : null}
          {dead ? <span className="rounded-full bg-rust-t px-2 py-0.5 text-rust" title="Профилей со слетевшим токеном">слетело {dead}</span> : null}
          {paused ? <span className="rounded-full bg-amber-t px-2 py-0.5 text-amber" title="Профилей на паузе">пауза {paused}</span> : null}
          <button
            type="button"
            aria-label={open ? 'Свернуть' : 'Развернуть'}
            onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-dim transition hover:bg-sub hover:text-soft"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`pointer-events-none transition-transform duration-300 ${open ? 'rotate-180' : ''}`}><path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        </span>
      </div>

      {/* Плавное раскрытие профилей: сетка 0fr→1fr без «прыжка». */}
      <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
        <div className="overflow-hidden">
          <div className="pl-3">
            {groups.map((g) => <AccountGroup key={g.tokenId} group={g} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
