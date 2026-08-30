'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveBuyerProfile } from '@/app/actions/team';
import { Avatar } from './ui';

export type RosterRow = {
  id: string;
  handle: string;
  initials: string;
  color: string;
  /** YYYY-MM-DD или '' — не задано. */
  startedAt: string;
  birthday: string;
  /** 'BUYER' | 'LEAD' | ''. */
  position: string;
  owner: boolean;
};

/**
 * Ростер команды: у каждого — дата выхода, день рождения, позиция и флаг
 * овнера. Дата выхода отбрасывает недели до прихода из расчёта; овнер уводит
 * человека в отдельный лист. Правит только админ.
 */
export default function BuyerRoster({ rows }: { rows: RosterRow[] }) {
  return (
    <div className="mt-4 flex flex-col">
      <div className="hidden grid-cols-[1.4fr_1fr_1fr_0.9fr_auto] gap-3 pb-2 md:grid">
        <span className="lab">Баер</span>
        <span className="lab">С какого дня</span>
        <span className="lab">День рождения</span>
        <span className="lab">Позиция</span>
        <span className="lab text-right">Овнер</span>
      </div>
      {rows.map((r) => (
        <RosterLine key={r.id} row={r} />
      ))}
      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
        «С какого дня» отбрасывает недели, целиком прошедшие до этой даты, из
        расчёта — оклад за время до прихода не платится. «Овнер» уводит человека
        в отдельный лист: в зарплате и в командном отчёте он не участвует. День
        рождения и позиция — справочно.
      </p>
    </div>
  );
}

const field =
  'n h-9 rounded-lg border border-line bg-sub px-3 text-[13px] text-soft outline-none transition focus:border-sage [color-scheme:dark]';

function RosterLine({ row }: { row: RosterRow }) {
  const router = useRouter();
  const [startedAt, setStartedAt] = useState(row.startedAt);
  const [birthday, setBirthday] = useState(row.birthday);
  const [position, setPosition] = useState(row.position);
  const [owner, setOwner] = useState(row.owner);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty =
    startedAt !== row.startedAt ||
    birthday !== row.birthday ||
    position !== row.position ||
    owner !== row.owner;

  function commit(nextOwner = owner) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await saveBuyerProfile(row.id, {
        startedAt,
        birthday,
        position,
        owner: nextOwner,
      });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-2 items-center gap-3 border-t border-line py-3 md:grid-cols-[1.4fr_1fr_1fr_0.9fr_auto]">
      <span className="col-span-2 flex items-center gap-3 md:col-span-1">
        <Avatar initials={row.initials} color={row.color} size={30} />
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold">
            {row.handle}
            {owner ? <span className="ml-2 rounded-full bg-sage-t px-2 py-0.5 text-[10px] text-sage">овнер</span> : null}
          </span>
          {saved && !dirty ? <span className="text-[11px] text-sage">сохранено</span> : null}
          {error ? <span className="text-[11px] text-rust">{error}</span> : null}
        </span>
      </span>

      <label className="flex flex-col gap-1 md:contents">
        <span className="lab md:hidden">С какого дня</span>
        <input
          type="date"
          value={startedAt}
          onChange={(e) => setStartedAt(e.target.value)}
          className={`${field} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1 md:contents">
        <span className="lab md:hidden">День рождения</span>
        <input
          type="date"
          value={birthday}
          onChange={(e) => setBirthday(e.target.value)}
          className={`${field} w-full`}
        />
      </label>

      <label className="flex flex-col gap-1 md:contents">
        <span className="lab md:hidden">Позиция</span>
        <select
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          className={`${field} w-full`}
        >
          <option value="">—</option>
          <option value="BUYER">баер</option>
          <option value="LEAD">тимлид</option>
        </select>
      </label>

      <span className="col-span-2 flex items-center justify-end gap-2 md:col-span-1">
        <button
          type="button"
          onClick={() => {
            const next = !owner;
            setOwner(next);
            commit(next);
          }}
          disabled={pending}
          className={`h-8 rounded-full px-3 text-[11.5px] transition disabled:opacity-40 ${
            owner ? 'bg-sage text-bg font-semibold' : 'bg-sub text-mute hover:text-soft'
          }`}
        >
          {owner ? 'овнер' : 'сделать овнером'}
        </button>
        <button
          type="button"
          onClick={() => commit()}
          disabled={pending || !dirty}
          className="h-8 rounded-full bg-sage px-4 text-[12px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          {pending ? '…' : 'ОК'}
        </button>
      </span>
    </div>
  );
}
