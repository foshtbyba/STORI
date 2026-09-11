import 'server-only';

import { prisma } from './db';
import { listDomains, KeitaroError } from './keitaro';

/** Цена зоны по умолчанию, если для неё не задана своя, — $7. */
export const DEFAULT_ZONE_PRICE_CENTS = 700;

const STOCK_GROUP_KEY = 'kt_domain_stock_group';
const SYNCED_AT_KEY = 'kt_domain_stock_synced_at';
/** Не дёргаем КТ чаще, чем раз в столько мс при авто-заходе (кнопка — форсит). */
const THROTTLE_MS = 120_000;

export type StockSyncResult =
  | { ok: true; added: number; found: number; skipped?: boolean }
  | { ok: false; error: string };

/**
 * Подтянуть домены из группы-склада Keitaro на витрину: читаем домены трекера,
 * берём те, что лежат в группе-складе, и заводим у себя свободными (кого ещё
 * нет). Автозаход (force=false) не чаще раза в THROTTLE_MS; кнопка форсит.
 * Никогда не бросает — на любой сбой возвращает {ok:false}, чтобы страница
 * магазина не падала из-за КТ.
 */
export async function syncStockFromKeitaro(force = false): Promise<StockSyncResult> {
  try {
    const s = await prisma.setting.findUnique({ where: { key: STOCK_GROUP_KEY } });
    const stock = s?.value?.trim() ?? '';
    if (!stock) return { ok: false, error: 'Не задан id группы-склада.' };

    if (!force) {
      const t = await prisma.setting.findUnique({ where: { key: SYNCED_AT_KEY } });
      const last = t ? Number(t.value) : 0;
      if (Number.isFinite(last) && Date.now() - last < THROTTLE_MS) {
        return { ok: true, added: 0, found: 0, skipped: true };
      }
    }

    const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
    if (!tracker) return { ok: false, error: 'Нет активного трекера.' };

    const ktDomains = await listDomains(tracker.baseUrl, tracker.apiKey);
    const inStock = ktDomains.filter((d) => d.groupId === stock && /\.[a-z]{2,}$/i.test(d.name));

    // Метку времени ставим даже при пустом складе — чтобы не долбить КТ.
    await prisma.setting.upsert({
      where: { key: SYNCED_AT_KEY },
      update: { value: String(Date.now()) },
      create: { key: SYNCED_AT_KEY, value: String(Date.now()) },
    });

    if (inStock.length === 0) return { ok: true, added: 0, found: 0 };

    const names = inStock.map((d) => d.name);
    const existing = await prisma.domain.findMany({ where: { name: { in: names } }, select: { name: true } });
    const have = new Set(existing.map((d) => d.name));
    const fresh = inStock.filter((d) => !have.has(d.name));
    if (fresh.length) {
      try {
        await prisma.domain.createMany({
          data: fresh.map((d) => ({ name: d.name, zone: d.name.slice(d.name.lastIndexOf('.') + 1), status: 'available', ktId: d.id })),
        });
      } catch {
        // Гонка параллельных заходов: часть имён уже вставил другой заход —
        // это не ошибка, дубли отсекает уникальный индекс.
      }
    }
    return { ok: true, added: fresh.length, found: inStock.length };
  } catch (e) {
    return { ok: false, error: e instanceof KeitaroError ? e.message : `Не прочитали домены КТ: ${(e as Error).message}` };
  }
}
