'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconSearch, IconPlus } from './icons';

/**
 * Поиск офферов с одной морфящейся кнопкой справа:
 *   пусто        → «+ Оффер» (завести оффер),
 *   набираешь    → «Поиск»   (отправить запрос),
 *   есть запрос  → «Сбросить» (очистить).
 * Кнопка — один и тот же элемент, поэтому смена состояний идёт плавно
 * (transition по цвету и ширине). Зелёная рамка при фокусе — на всей плитке
 * поиска, а не на внутреннем поле.
 */
export default function OfferSearch({
  query,
  status,
  canAdd,
  newHref,
  resetHref,
}: {
  query: string;
  status?: string;
  canAdd: boolean;
  newHref: string;
  resetHref: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);

  const trimmed = value.trim();
  const typing = trimmed.length > 0 && trimmed !== query;
  const hasSearch = query.length > 0;
  const mode: 'search' | 'reset' | 'add' | 'none' = typing
    ? 'search'
    : hasSearch
      ? 'reset'
      : canAdd
        ? 'add'
        : 'none';

  const green =
    'bg-sage text-bg hover:opacity-90 border border-transparent';
  const muted =
    'bg-sub text-mute border border-line2 hover:border-rust hover:text-rust';

  return (
    <form action="/offers" className="flex basis-full items-center gap-2 sm:basis-auto">
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-line2 bg-sub px-3.5 transition focus-within:border-sage focus-within:ring-2 focus-within:ring-sage/25 sm:w-[230px] sm:flex-none">
        <IconSearch color="#8a8a8a" size={14} />
        <input
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Название или гео"
          // Внутреннюю подсветку убираем наглухо (инлайн бьёт глобальный
          // input:focus-visible) — зелёная рамка живёт на всей плитке, а не на поле.
          style={{ outline: 'none' }}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-text placeholder:text-mute"
        />
      </label>

      {mode === 'none' ? null : (
        <button
          type="submit"
          onClick={(e) => {
            // «Поиск» отправляет форму как есть; остальные состояния — переход.
            if (mode === 'reset') {
              e.preventDefault();
              router.push(resetHref);
            } else if (mode === 'add') {
              e.preventDefault();
              router.push(newHref);
            }
          }}
          className={`flex h-9 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full px-4 text-[12.5px] font-semibold transition-all duration-200 ${
            mode === 'reset' ? muted : green
          }`}
        >
          {mode === 'add' ? <IconPlus color="#141414" size={13} width={2.8} /> : null}
          {mode === 'search' ? 'Поиск' : mode === 'reset' ? 'Сбросить' : 'Оффер'}
        </button>
      )}
    </form>
  );
}
