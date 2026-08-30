import { grossUp } from './money';

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
    if (untouched(existing.spendNetCents, existing.spendSyncedCents)) {
      data.spendNetCents = incoming.spendCents;
      // Комиссия за пополнение сидит внутри перевода — пересчитываем её от
      // нового чистого расхода той же ставкой, что стояла в строке.
      data.spendGrossCents = grossUp(incoming.spendCents, existing.commissionBps);
      data.spendSyncedCents = incoming.spendCents;
    } else {
      skipped = true;
    }
  }

  if (incoming.revenueCents !== undefined) {
    if (untouched(existing.revenueCents, existing.revenueSyncedCents)) {
      data.revenueCents = incoming.revenueCents;
      data.revenueSyncedCents = incoming.revenueCents;
    } else {
      skipped = true;
    }
  }

  return { data, skipped };
}
