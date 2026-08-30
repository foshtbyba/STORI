import 'server-only';

/**
 * Клиент к API Brocard — реальный расход команды: фактические списания с карт.
 *
 * Берём эндпоинт `GET /api/v2/payments`: он отдаёт платежи по картам за период
 * с разбивкой по командам. Команда (`user.team`) и есть баер — по ней делим
 * расход, ровно как доход в Keitaro делится по группам.
 *
 * Реальная трата — это `amount` в валюте аккаунта (USD) у прошедших платежей.
 * Отклонённые (`decline`) и микро-списания (`is_micro` — центовые проверки
 * карты) в расход не идут: денег они не стоили.
 */

/** Адрес фиксированный: у всех один портал. */
const BASE = 'https://private.mybrocard.com/api/v2';

export class BrocardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrocardError';
  }
}

async function call(apiKey: string, path: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
    });
  } catch (e) {
    throw new BrocardError(`Не достучались до Brocard: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new BrocardError('Brocard не принял ключ — проверь API-ключ и что API включён.');
  }
  if (!res.ok) {
    throw new BrocardError(`Brocard ответил ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BrocardError(`Brocard ответил не по-json: ${text.slice(0, 160)}`);
  }
}

export type BrocardTeamRow = { id: string; name: string };

/** Команды Brocard — их привязываем к баерам. */
export async function listTeams(apiKey: string): Promise<BrocardTeamRow[]> {
  const raw = await call(apiKey, '/teams', { per_page: '200' });
  const data = ((raw as { data?: unknown }).data ?? []) as Record<string, unknown>[];
  return data.map((t) => ({ id: String(t.id ?? ''), name: String(t.name ?? '') || String(t.id ?? '') }));
}

export type BrocardSpendRow = {
  /** YYYY-MM-DD в часовом поясе, который запросили. */
  date: string;
  teamId: string;
  /** Реальная трата в центах (USD). */
  amountCents: number;
  /** Комиссия Brocard за этот платёж, в центах (USD). */
  feeCents: number;
};

/**
 * Дневной расход по командам за отрезок.
 *
 * Платежи забираем постранично, `dates[begin]/[end]` — границы, `tz` держим
 * тем же, что у отчётов (UTC): день списания должен совпасть с днём в базе.
 * Микро и отклонённые пропускаем — это не траты.
 */
export async function dailySpend(
  apiKey: string,
  from: string,
  to: string,
  tz = 'UTC',
): Promise<BrocardSpendRow[]> {
  const out: BrocardSpendRow[] = [];

  for (let page = 1; page <= 200; page += 1) {
    const raw = await call(apiKey, '/payments', {
      tz,
      per_page: '100',
      page: String(page),
      'dates[begin]': from,
      'dates[end]': to,
    });

    const data = ((raw as { data?: unknown }).data ?? []) as Record<string, unknown>[];
    for (const p of data) {
      // Микро-проверки карты и отклонённые платежи денег не стоили.
      if (p.is_micro === true) continue;
      if (p.decline) continue;

      const day = String(p.date ?? '').slice(0, 10);
      if (!day) continue;

      const user = (p.user ?? {}) as { team?: { id?: unknown } };
      const teamId = String(user.team?.id ?? '');
      if (!teamId) continue;

      const amountCents = Math.round(Number(p.amount ?? 0) * 100);
      if (!Number.isFinite(amountCents)) continue;

      const fees = (p.fees ?? []) as { amount?: unknown; currency?: unknown }[];
      const feeCents = fees.reduce((sum, f) => {
        const c = Math.round(Number(f.amount ?? 0) * 100);
        return Number.isFinite(c) ? sum + c : sum;
      }, 0);

      out.push({ date: day, teamId, amountCents, feeCents });
    }

    const lastPage = Number((raw as { last_page?: unknown }).last_page ?? 1);
    if (!Number.isFinite(lastPage) || page >= lastPage) break;
  }

  return out;
}

/** Проверка ключа: сколько команд видно под ним. */
export async function checkBrocard(apiKey: string) {
  const teams = await listTeams(apiKey);
  return { teams };
}
