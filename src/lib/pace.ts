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

/** Пауза между запросами к Facebook: по умолчанию 2–6 секунд. */
export const FB_PAUSE_MIN_MS = envInt('SYNC_FB_PAUSE_MIN_MS', 2000);
export const FB_PAUSE_MAX_MS = envInt('SYNC_FB_PAUSE_MAX_MS', 6000);

/** Пауза между разными токенами (аккаунтами): по умолчанию 8–20 секунд. */
export const FB_TOKEN_GAP_MIN_MS = envInt('SYNC_FB_TOKEN_GAP_MIN_MS', 8000);
export const FB_TOKEN_GAP_MAX_MS = envInt('SYNC_FB_TOKEN_GAP_MAX_MS', 20000);

/** Сколько часов токен «отдыхает» после тревожного сигнала. */
export const FB_COOLDOWN_HOURS = envInt('SYNC_FB_COOLDOWN_HOURS', 6);

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Случайная задержка в диапазоне [min, max]. */
export function jitter(minMs: number, maxMs: number): Promise<void> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  return sleep(lo + Math.floor(Math.random() * (hi - lo + 1)));
}

/** Пауза «как человек между кликами по кабинетам». */
export const humanPause = () => jitter(FB_PAUSE_MIN_MS, FB_PAUSE_MAX_MS);

/** Пауза между аккаунтами. */
export const tokenGap = () => jitter(FB_TOKEN_GAP_MIN_MS, FB_TOKEN_GAP_MAX_MS);

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
