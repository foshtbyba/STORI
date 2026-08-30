import { grossUp, ceilDollars } from './money';

/**
 * Правило, по которому синхронизация решает, можно ли переписать цифру.
 *
 * Живёт отдельным файлом и ничего не знает ни про базу, ни про чужие API: цена
 * ошибки здесь — неверная зарплата, и такое хочется уметь прогнать отдельно,
 * не поднимая ни Facebook, ни Keitaro.
 *
 * Суть: в строке дня лежит то, что синхронизация записала в прошлый раз. Если
 * текущее значение совпадает с ним — никто не вмешивался, обновляем. Если не
 * совпадает — цифру поправили руками, и трогать её нельзя: у человека есть
 * причина, которой не знает API.
 */

export type DayState = {
  spendNetCents: number;
  revenueCents: number;
  commissionBps: number;
  /** Что записала синхронизация в прошлый раз. null — не записывала вовсе. */
  spendSyncedCents: number | null;
  revenueSyncedCents: number | null;
};

export type Incoming = {
  spendCents?: number;
  revenueCents?: number;
  /**
   * Готовый расход с комиссией. Brocard знает фактическую комиссию за платёж,
   * поэтому передаёт её явно, а не через ставку в bps. Если не задан — считаем
   * по ставке строки, как раньше.
   */
  spendGrossCents?: number;
};

export type Merge = {
  /** Поля для записи. Пусто — писать нечего. */
  data: Record<string, number>;
  /** Хоть одну цифру не тронули, потому что её правили руками. */
  skipped: boolean;
};

/**
 * Поле не трогали, если оно совпадает с последним записанным значением. Когда
 * синхронизация ещё ничего не писала, нетронутым считаем только ноль: всё
 * остальное в строке появилось от человека.
 */
function untouched(current: number, synced: number | null) {
  return synced === null ? current === 0 : current === synced;
}

export function mergeDay(existing: DayState, incoming: Incoming): Merge {
  const data: Record<string, number> = {};
  let skipped = false;

  if (incoming.spendCents !== undefined) {
    // Всё, что приходит из синка, округляем до целых долларов — тем же
    // правилом, что и ручной ввод. Иначе колонки «доход − расход = профит» не
    // сходятся после поцентного округления в usd().
    const net = ceilDollars(incoming.spendCents);
    if (untouched(existing.spendNetCents, existing.spendSyncedCents)) {
      data.spendNetCents = net;
      // Комиссия: если источник знает фактическую (Brocard) — берём её, иначе
      // считаем по ставке строки, как для ручного ввода.
      data.spendGrossCents =
        incoming.spendGrossCents !== undefined
          ? ceilDollars(incoming.spendGrossCents)
          : grossUp(net, existing.commissionBps);
      data.spendSyncedCents = net;
    } else {
      skipped = true;
    }
  }

  if (incoming.revenueCents !== undefined) {
    const revenue = ceilDollars(incoming.revenueCents);
    if (untouched(existing.revenueCents, existing.revenueSyncedCents)) {
      data.revenueCents = revenue;
      data.revenueSyncedCents = revenue;
    } else {
      skipped = true;
    }
  }

  return { data, skipped };
}
