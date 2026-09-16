'use client';

import { useState } from 'react';

/** Поле со ссылкой подключения TikTok + кнопка «Скопировать». Одну ссылку баер
 *  открывает по очереди в разных антидетект-профилях, подключая кабинеты. */
export default function CopyConnectLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard может быть недоступен — тогда копируют вручную из поля */
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-xl border border-line2 bg-sub px-3 text-[11.5px] text-mute"
      />
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:border-sage hover:text-sage"
      >
        {copied ? 'Скопировано' : 'Скопировать ссылку'}
      </button>
    </div>
  );
}
