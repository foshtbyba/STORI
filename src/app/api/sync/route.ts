import { NextResponse } from 'next/server';
import { syncAll, SYNC_DAYS } from '@/lib/sync';

// Синхронизация нарочно неспешная — с паузами между запросами к Facebook,
// чтобы не словить чекпоинт. Полный заход длится минуты, поэтому маршрут
// динамический и без ограничения времени.
export const dynamic = 'force-dynamic';
export const maxDuration = 900;

/**
 * Точка для крона: дёргает синхронизацию расхода и дохода.
 *
 * Глубина задаётся `?days=N`: частый лёгкий синк берёт день-два (у баера
 * картина за сегодня всегда свежая), а раз в сутки глубокий заход
 * переподтягивает все 14 дней — конверсии в Keitaro подтверждаются с
 * задержкой, и вчерашние цифры ещё меняются. По умолчанию — полные 14 дней.
 *
 * Авторизации по сессии тут нет, вместо неё общий секрет `SYNC_SECRET`. Пока
 * секрет не задан, ручка закрыта наглухо: открытый эндпоинт, дёргающий чужие
 * API, — не то, что стоит оставлять включённым «на всякий случай».
 *
 * Крон на сервере. Время НАРОЧНО плавающее: запуск ровно в :00 из суток в
 * сутки — сам по себе машинный почерк, поэтому перед каждым заходом ждём
 * случайную паузу (`sleep $((RANDOM % N))`). Внутри синхронизация и так идёт
 * вразнобой с паузами между кабинетами (см. src/lib/pace.ts) — это второй,
 * главный слой защиты от чекпоинта.
 *
 *   # лёгкий заход раз в ~час, со сдвигом 0–40 минут:
 *   7 * * * * sleep $((RANDOM \% 2400)); curl -fsS --max-time 900 -H "X-Sync-Key: …" "https://msdash.top/api/sync?days=1"
 *   # глубокий заход раз в сутки ночью, со сдвигом 0–90 минут:
 *   13 4 * * * sleep $((RANDOM \% 5400)); curl -fsS --max-time 1200 -H "X-Sync-Key: …" "https://msdash.top/api/sync?days=14"
 *
 * Минуты (7 и 13) взяты не круглые тоже намеренно. `--max-time` большой:
 * заход с паузами длится минуты, curl не должен оборвать его раньше времени.
 */
export async function GET(req: Request) {
  const secret = process.env.SYNC_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'SYNC_SECRET не задан — ручка выключена' },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const given = req.headers.get('x-sync-key') ?? url.searchParams.get('key') ?? '';
  if (given !== secret) {
    return NextResponse.json({ ok: false, error: 'не тот ключ' }, { status: 401 });
  }

  // Глубину зажимаем в 1…31: случайный ?days=9999 не должен вешать чужие API.
  const asked = Number(url.searchParams.get('days'));
  const days = Number.isFinite(asked) && asked > 0 ? Math.min(31, Math.max(1, Math.round(asked))) : SYNC_DAYS;

  const result = await syncAll(days);
  return NextResponse.json({ ok: true, days, ...result });
}
