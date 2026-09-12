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
 * тем же, что у отчётов (SYNC_TZ — часовой пояс команды): день списания должен
 * совпасть с днём в базе и с тем, что видит баер.
 * Микро и отклонённые пропускаем — это не траты.
 */
export async function dailySpend(
  apiKey: string,
  from: string,
  to: string,
  tz = 'UTC',
): Promise<{ rows: BrocardSpendRow[]; voidedCents: number; voidedCount: number }> {
  const out: BrocardSpendRow[] = [];
  let voidedCents = 0;
  let voidedCount = 0;

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
      // Микро — это центовая проверка карты, не трата: пропускаем целиком.
      if (p.is_micro === true) continue;

      // Статус платежа Brocard — объект `state = { value, label }`. Успешный —
      // label "Settled" (value 1); отменённый — label "Void" (value 2). Void
      // (а также reversed/refund/chargeback, если появятся) — НЕ расход: деньги
      // вернулись на карту, пропускаем целиком. Иначе спенд завышается.
      const st = (p.state ?? null) as { value?: unknown; label?: unknown } | string | null;
      const stateLabel = (typeof st === 'string' ? st : String((st as { label?: unknown } | null)?.label ?? '')).toLowerCase();
      const stateValue = st && typeof st === 'object' ? Number((st as { value?: unknown }).value) : NaN;
      const voidWords = ['void', 'revers', 'refund', 'chargeback', 'cancel'];
      const isVoid = voidWords.some((w) => stateLabel.includes(w)) || stateValue === 2;
      if (isVoid) {
        const vc = Math.round(Number(p.amount ?? 0) * 100);
        if (Number.isFinite(vc) && vc > 0) { voidedCents += vc; voidedCount += 1; }
        continue;
      }

      const day = String(p.date ?? '').slice(0, 10);
      if (!day) continue;

      const user = (p.user ?? {}) as { team?: { id?: unknown } };
      const teamId = String(user.team?.id ?? '');
      if (!teamId) continue;

      // Отклонён? У decline проверяем не «истинность»: строка «0»/«false» тоже
      // истинна, а это валидный платёж.
      const decline = p.decline;
      const declined =
        decline !== null &&
        decline !== undefined &&
        decline !== '' &&
        decline !== '0' &&
        decline !== 'false' &&
        decline !== false;

      const currency = String(p.currency ?? 'USD');
      // Комиссию Brocard берём со ВСЕХ платежей, включая отклонённые: карта
      // всё равно списывает комиссию за попытку. Складываем только в валюте
      // платежа — чужую валюту без курса не пересчитываем.
      const fees = (p.fees ?? []) as { amount?: unknown; currency?: unknown }[];
      const feeCents = fees.reduce((sum, f) => {
        if (f.currency && String(f.currency) !== currency) return sum;
        const c = Math.round(Number(f.amount ?? 0) * 100);
        return Number.isFinite(c) ? sum + c : sum;
      }, 0);

      // Чужую валюту без курса пересчитать нельзя, а посчитать её число как
      // доллары — значит завысить расход баера и его зарплату. Поэтому не-USD
      // платёж пропускаем целиком (у команды карты в USD; если появятся другие
      // — нужен курс). Лучше не учесть, чем учесть неверно.
      if (currency !== 'USD') continue;

      // Тело платежа — только у прошедших: это чистый расход на рекламу.
      // Отклонённый рекламу не оплатил, но комиссию за него мы уже учли выше.
      const amountCents = declined ? 0 : Math.round(Number(p.amount ?? 0) * 100);
      if (!Number.isFinite(amountCents)) continue;

      // Ни траты, ни комиссии — строку заводить незачем.
      if (amountCents === 0 && feeCents === 0) continue;

      out.push({ date: day, teamId, amountCents, feeCents });
    }

    const lastPage = Number((raw as { last_page?: unknown }).last_page ?? 1);
    if (!Number.isFinite(lastPage) || page >= lastPage) break;
  }

  return { rows: out, voidedCents, voidedCount };
}

/** Проверка ключа: сколько команд видно под ним. */
export async function checkBrocard(apiKey: string) {
  const teams = await listTeams(apiKey);
  return { teams };
}

/**
 * Диагностика для админа: сырой ответ Brocard по счетам/балансу/картам, чтобы
 * увидеть точные поля (баланс команды, сумма на картах, номер счёта) и собрать
 * плитки остатка баера правильно, без угадывания. Возвращаем усечённый JSON:
 * первый элемент списков + сам баланс. Ничего не пишем — только читаем.
 */
export async function probeBalances(apiKey: string) {
  const out: Record<string, string> = {};
  const grab = async (label: string, path: string, params: Record<string, string> = {}) => {
    try {
      const raw = await call(apiKey, path, params);
      // Списки усекаем до первого элемента, чтобы не тащить всё и не светить номера.
      const data = (raw as { data?: unknown }).data;
      const sample = Array.isArray(data) ? { count: data.length, first: data[0] } : raw;
      out[label] = JSON.stringify(sample, null, 2).slice(0, 2000);
    } catch (e) {
      out[label] = `ошибка: ${(e as Error).message}`;
    }
  };
  await grab('GET /balance', '/balance');
  await grab('GET /teams (первая)', '/teams', { per_page: '1' });
  await grab('GET /cards (первая)', '/cards', { per_page: '1' });
  return out;
}
