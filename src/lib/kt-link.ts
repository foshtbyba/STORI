/**
 * Из ссылки объявления достаём токен кампании Keitaro.
 *
 * TDS-ссылка выглядит как `https://track.top/qynyTnDK?ad_id=…`: токен кампании —
 * это ПЕРВЫЙ СЕГМЕНТ ПУТИ (`qynyTnDK`). Берём только его: параметры вроде `sun`
 * в разных ссылках означают разное и токену не равны, поэтому на них не
 * опираемся. Что совпало с кампанией в трекере, решает матчинг по индексу
 * токенов (см. keitaro.ts).
 */

/** Токен КТ — это буквы/цифры, 4–40 символов. Отсекаем мусорные сегменты. */
const TOKENISH = /^[A-Za-z0-9_-]{4,40}$/;

export function parseKtCandidates(rawUrl: string): string[] {
  const url = safeUrl(rawUrl);
  if (!url) return [];

  // Только первый сегмент пути — канонический токен TDS-ссылки.
  const first = (url.pathname.split('/').filter(Boolean)[0] ?? '').trim();
  return first && TOKENISH.test(first) ? [first] : [];
}

/** Удобно, когда нужен один «главный» кандидат (для показа распарсенного). */
export function parseKtToken(rawUrl: string): string {
  return parseKtCandidates(rawUrl)[0] ?? '';
}

function safeUrl(raw: string): URL | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  try {
    return new URL(s);
  } catch {
    // Иногда прилетает ссылка без схемы — попробуем достроить.
    try {
      return new URL(`https://${s}`);
    } catch {
      return null;
    }
  }
}
