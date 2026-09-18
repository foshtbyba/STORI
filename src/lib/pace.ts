import 'server-only';

/**
 * Темп обращений к Facebook — чтобы синхронизация не выглядела как робот.
 *
 * Шестнадцать кабинетов, опрошенных залпом за секунду, — это ровно тот
 * паттерн, за который Facebook кидает аккаунт в чекпоинт. Поэтому между
 * запросами держим паузу со случайным разбросом: не ровно N секунд (это тоже
 * машинный почерк), а «примерно столько, сколько тратит человек, листающий
 * кабинеты».
 *
 * Все пороги — через переменные окружения, чтобы крутить темп без пересборки.
 */

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** Пауза между запросами к Facebook: по умолчанию 3–7 секунд (мягкий режим). */
export const FB_PAUSE_MIN_MS = envInt('SYNC_FB_PAUSE_MIN_MS', 3000);
export const FB_PAUSE_MAX_MS = envInt('SYNC_FB_PAUSE_MAX_MS', 7000);

/** Сколько часов токен «отдыхает» после тревожного сигнала. */
export const FB_COOLDOWN_HOURS = envInt('SYNC_FB_COOLDOWN_HOURS', 6);

/**
 * Отдельный, КОРОТКИЙ кулдаун для троттлинга. Троттлинг (код 4 и т.п.) FB
 * отпускает через минуты, а не часы — незачем держать кабинет мёртвым полдня.
 * «Блок» за подозрительную активность — другое: там отступаем надолго
 * (FB_COOLDOWN_HOURS), чтобы не довести до чекпоинта.
 */
export const FB_THROTTLE_COOLDOWN_HOURS = envInt('SYNC_FB_THROTTLE_COOLDOWN_HOURS', 1);

/**
 * До какого времени парковать токен после сигнала FB (или null — не паркуем).
 * Троттлинг → короткий кулдаун, блок → длинный.
 */
export function fbCooldownUntil(kind: 'throttle' | 'blocked' | 'token' | 'other', from: Date): Date | null {
  const hours = kind === 'throttle' ? FB_THROTTLE_COOLDOWN_HOURS : kind === 'blocked' ? FB_COOLDOWN_HOURS : 0;
  return hours ? new Date(from.getTime() + hours * 3600_000) : null;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Случайная задержка в диапазоне [min, max]. */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return sleep(lo + Math.floor(Math.random() * (hi - lo + 1)));
}

/** Пауза «как человек между кликами по кабинетам». */
export const humanPause = () => jitter(FB_PAUSE_MIN_MS, FB_PAUSE_MAX_MS);

/**
 * Перемешать массив (Фишер—Йетс). Порядок кабинетов каждый заход разный —
 * повторяющийся из раза в раз обход тоже читается как автомат.
 */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Максимум токенов, опрашиваемых одновременно. Разные токены — разные
 *  аккаунты и прокси, их можно вести параллельно; серийность нужна только
 *  внутри аккаунта. */
export const FB_CONCURRENCY = envInt('SYNC_FB_CONCURRENCY', 3);

/**
 * Выполнить задачи с ограничением на число одновременно идущих. Простой пул:
 * держим не больше `limit` промисов в полёте, по мере завершения берём
 * следующий. Порядок результатов сохраняется по входному массиву.
 */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
