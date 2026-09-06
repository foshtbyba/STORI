import { NextResponse } from 'next/server';
import { syncAll, SYNC_DAYS } from '@/lib/sync';

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
 * Крон на сервере (два задания):
 *   каждые полчаса — только сегодня, чтобы у баера было живо:
 *     0,30 * * * * curl -fsS -H "X-Sync-Key: …" "https://msdash.top/api/sync?days=1"
 *   раз в сутки — переподтянуть все 14 дней (поздние подтверждения):
 *     0 1 * * *   curl -fsS -H "X-Sync-Key: …" "https://msdash.top/api/sync?days=14"
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
