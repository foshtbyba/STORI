'use client';

import { useState } from 'react';
import { renameToken } from '@/app/actions/integrations';

/**
 * Подпись токена с правкой по клику. Имя профиля подставляется само при
 * добавлении; здесь его можно переименовать, не трогая сам токен. Клик по
 * тексту раскрывает поле, Enter или «уход» с поля сохраняет.
 */
export default function TokenLabel({ id, label }: { id: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(label);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Переименовать"
        className="text-left text-[12px] font-normal text-mute transition hover:text-soft"
      >
        {label || '— без подписи —'}
      </button>
    );
  }

  return (
    <form
      action={renameToken}
      onSubmit={() => setEditing(false)}
      className="inline-flex items-center gap-1.5"
    >
      <input type="hidden" name="id" value={id} />
      <input
        name="label"
        value={value}
        autoFocus
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue(label);
            setEditing(false);
          }
        }}
        placeholder="имя профиля"
        className="h-7 w-40 rounded-lg border border-line2 bg-sub px-2 text-[12px] text-text outline-none focus:border-sage"
      />
    </form>
  );
}
