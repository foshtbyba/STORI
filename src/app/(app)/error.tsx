'use client';

import { useEffect } from 'react';

/**
 * Ловушка ошибок для всего раздела приложения. Без неё любой сбой в клиентском
 * компоненте (или при применении свежих данных после «Обновить стату») роняет
 * страницу в пустой чёрный экран «client-side exception». Здесь показываем, что
 * именно упало, и даём кнопку «повторить» — раздел оживает без перезагрузки.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // В консоль — полный стек для разбора.
    console.error('Раздел упал:', error);
  }, [error]);

  // Частый случай после деплоя: вкладка открыта со старой сборки, а на сервере
  // уже новая — id серверного действия не совпал. Лечится только перезагрузкой
  // (не «Повторить» — она шлёт тот же старый id). Ловим по тексту ошибки и
  // показываем понятное сообщение, а главной кнопкой делаем обновление.
  const stale =
    /server action/i.test(error?.message ?? '') ||
    /find-server-action|failed to find server action/i.test(error?.message ?? '');

  const reload = () => window.location.reload();

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-line2 bg-panel p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rust-t text-[20px]">⚠</div>
        {stale ? (
          <>
            <div className="text-[15px] font-semibold text-text">Приложение обновилось</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
              Страница открыта со старой сборки — обнови её, и всё заработает.
              Данные не пострадали, ничего заново вводить не нужно.
            </p>
          </>
        ) : (
          <>
            <div className="text-[15px] font-semibold text-text">Что-то сломалось на этой странице</div>
            <p className="mt-2 text-[12.5px] leading-relaxed text-mute">
              Раздел не отрисовался. Попробуй повторить — обычно помогает. Если повторяется,
              покажи мне текст ошибки ниже.
            </p>
          </>
        )}
        {error?.message ? (
          <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-sub px-3 py-2 text-left text-[11px] leading-relaxed text-rust">
            {error.message}
            {error.digest ? `\n\ndigest: ${error.digest}` : ''}
          </pre>
        ) : null}
        <div className="mt-4 flex justify-center gap-2">
          {stale ? (
            <button
              type="button"
              onClick={reload}
              className="rounded-full bg-sage px-5 py-2 text-[12.5px] font-semibold text-bg transition hover:opacity-90"
            >
              Обновить страницу
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={reset}
                className="rounded-full bg-sage px-5 py-2 text-[12.5px] font-semibold text-bg transition hover:opacity-90"
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={reload}
                className="rounded-full border border-line2 bg-sub px-5 py-2 text-[12.5px] text-soft transition hover:text-text"
              >
                Перезагрузить
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
