/**
 * Из ссылки объявления достаём токен кампании Keitaro.
 *
 * TDS-ссылка выглядит как `https://track.top/qynyTnDK?ad_id=…&sun=qynyTnDK`:
 * токен кампании — это первый сегмент пути (`qynyTnDK`), и команда дублирует его
 * в параметр `sun`. Что именно совпадёт с кампанией в трекере, решает уже
 * матчинг по индексу токенов (см. keitaro.ts) — здесь лишь собираем кандидатов
 * по всем местам, где токен может стоять, в порядке надёжности.
 *
 * Кандидатов возвращаем несколько, потому что разметка ссылок в командах
 * разнится: у кого-то токен в пути, у кого-то в `sun`, изредка в явном
 * параметре. Матчинг переберёт их и возьмёт первый, который есть в трекере.
 */

/** Параметры, куда команды кладут токен кампании явным значением. */
const TOKEN_PARAMS = ['sun', 'token', 'campaign', 'camp'];

/** Токен КТ — это буквы/цифры, 4–40 символов. Отсекаем мусорные сегменты. */
const TOKENISH = /^[A-Za-z0-9_-]{4,40}$/;

export function parseKtCandidates(rawUrl: string): string[] {
  const url = safeUrl(rawUrl);
  if (!url) return [];

  const out: string[] = [];
  const push = (v: string | null | undefined) => {
    const s = (v ?? '').trim();
    if (s && TOKENISH.test(s) && !out.includes(s)) out.push(s);
  };

  // Первый сегмент пути — канонический токен TDS-ссылки.
  const first = url.pathname.split('/').filter(Boolean)[0];
  push(first);

  // Явные параметры — второй по надёжности источник.
  for (const p of TOKEN_PARAMS) push(url.searchParams.get(p));

  return out;
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
