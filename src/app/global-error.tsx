'use client';

import { useEffect } from 'react';

/**
 * Последний рубеж: ловит сбои, до которых не дотянулся error.tsx раздела (в т.ч.
 * в корневом лейауте). Заменяет весь документ, поэтому рисует свои <html>/<body>
 * и не полагается на глобальные стили — только инлайн, чтобы точно отрисовалось.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Приложение упало:', error);
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ margin: 0, background: '#141414', color: '#e4e4e4', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ maxWidth: 440, width: '100%', border: '1px solid #3a3a3b', background: '#1c1c1d', borderRadius: 16, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>⚠</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Приложение споткнулось</div>
            <p style={{ fontSize: 12.5, color: '#8a8a8a', lineHeight: 1.6, marginTop: 8 }}>
              Нажми «Повторить». Если не отпускает — покажи мне текст ошибки ниже.
            </p>
            {error?.message ? (
              <pre style={{ marginTop: 12, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', background: '#232324', color: '#ce6e58', padding: '8px 12px', borderRadius: 8, textAlign: 'left', fontSize: 11 }}>
                {error.message}
                {error.digest ? `\n\ndigest: ${error.digest}` : ''}
              </pre>
            ) : null}
            <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                type="button"
                onClick={reset}
                style={{ background: '#b4c68c', color: '#141414', border: 0, borderRadius: 999, padding: '8px 20px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{ background: '#232324', color: '#c4c4c4', border: '1px solid #3a3a3b', borderRadius: 999, padding: '8px 20px', fontSize: 12.5, cursor: 'pointer' }}
              >
                Перезагрузить
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
