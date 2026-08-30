import { NextResponse } from 'next/server';
import { syncAll } from '@/lib/sync';

/**
 * Точка для крона: дёргает синхронизацию расхода и дохода.
 *
 * Заходить сюда браузером незачем — авторизации по сессии тут нет, вместо неё
 * общий секрет из `SYNC_SECRET`. Пока секрет не задан, ручка закрыта наглухо:
 * открытый эндпоинт, дёргающий чужие API, — не то, что стоит оставлять
 * включённым «на всякий случай».
 *
 * На сервере:
 *   * * * * * — не надо. Раз в полчаса достаточно, цифры всё равно
 *   доуточняются часами:
 *   0,30 * * * * curl -fsS -H "X-Sync-Key: …" https://msdash.top/api/sync
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

  const result = await syncAll();
  return NextResponse.json({ ok: true, ...result });
}
