import 'server-only';

/**
 * Курс ₽/$ хранится в сотых (8000 = 80,00 ₽) — то же целочисленное правило,
 * что и у денег, чтобы нигде не всплыл float.
 *
 * Источники опрашиваются по очереди: первый ответивший выигрывает. Если не
 * ответил никто, вызывающий оставляет прежнее значение — курс, показанный
 * вчера, честнее нуля.
 */
const SOURCES: { name: string; url: string; pick: (data: unknown) => number | null }[] = [
  {
    name: 'er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
    pick: (data) => {
      const rates = (data as { rates?: Record<string, number> }).rates;
      return typeof rates?.RUB === 'number' ? rates.RUB : null;
    },
  },
  {
    name: 'cbr',
    url: 'https://www.cbr-xml-daily.ru/daily_json.js',
    pick: (data) => {
      const value = (data as { Valute?: { USD?: { Value?: number } } }).Valute?.USD?.Value;
      return typeof value === 'number' ? value : null;
    },
  },
];

export type FetchedRate = {
  /** Рабочий курс — по нему считаем и конвертируем всё в приложении. */
  hundredths: number;
  /** Рыночный курс без вычета, как его отдал источник. */
  marketHundredths: number;
  source: string;
};

/**
 * Запас на перевод. Курс на бирже и курс, по которому деньги реально доходят
 * до баера, — разные вещи: комиссию за перевод кто-то платит. Поэтому от
 * рыночного отнимаем два рубля и живём по нему: 86 на рынке — считаем по 84.
 */
export const TRANSFER_MARGIN_HUNDREDTHS = 200;

/**
 * Если наружу не пускают, каждый рендер страницы упирался бы в два таймаута
 * подряд. После полного промаха держим паузу — сайт остаётся быстрым и на
 * сервере без исходящей сети.
 */
const RETRY_AFTER_MS = 5 * 60 * 1000;
let nextAttemptAt = 0;

export async function fetchRate(): Promise<FetchedRate | null> {
  if (Date.now() < nextAttemptAt) return null;

  for (const source of SOURCES) {
    try {
      const response = await fetch(source.url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const value = source.pick(await response.json());
      // Отсекаем явную чушь: курс вне этого коридора означает сломанный ответ,
      // а не событие на рынке.
      if (!value || value < 10 || value > 1000) continue;
      nextAttemptAt = 0;
      const marketHundredths = Math.round(value * 100);
      return {
        hundredths: Math.max(100, marketHundredths - TRANSFER_MARGIN_HUNDREDTHS),
        marketHundredths,
        source: source.name,
      };
    } catch {
      // Источник не ответил — пробуем следующий.
    }
  }
  nextAttemptAt = Date.now() + RETRY_AFTER_MS;
  return null;
}

/** Курс обновляем не чаще раза в час: чаще не нужно, а лимиты у источников есть. */
export const RATE_TTL_MS = 60 * 60 * 1000;

export function rateIsStale(updatedAt: Date | null) {
  if (!updatedAt) return true;
  return Date.now() - updatedAt.getTime() > RATE_TTL_MS;
}

export function formatRate(hundredths: number) {
  return (hundredths / 100).toFixed(2).replace('.', ',');
}
