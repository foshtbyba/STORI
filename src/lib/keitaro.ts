import 'server-only';

/**
 * Клиент к админскому API Keitaro. Нужны две вещи: список кампаний с их
 * группами и доход по дням в разрезе кампаний.
 *
 * Группу баера напрямую отчёт не отдаёт, поэтому идём в два шага: тянем отчёт
 * по кампаниям, а принадлежность кампании к группе берём из списка кампаний.
 * Так мы опираемся только на два самых обычных эндпоинта и не зависим от того,
 * как именно в конкретной сборке называется группировка по группам.
 */

export class KeitaroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeitaroError';
  }
}

function root(baseUrl: string) {
  // Хвостовой слэш и случайно приклеенный /admin_api убираем: адрес вводит
  // человек, и вариантов написания у него много.
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/admin_api(\/v1)?$/, '');
}

async function call(
  baseUrl: string,
  apiKey: string,
  path: string,
  body?: unknown,
) {
  const url = `${root(baseUrl)}/admin_api/v1${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Api-Key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (e) {
    throw new KeitaroError(`Не достучались до трекера: ${(e as Error).message}`);
  }

  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new KeitaroError('Трекер не принял ключ — проверь Api-Key и права.');
  }
  if (!res.ok) {
    throw new KeitaroError(`Трекер ответил ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new KeitaroError(
      `Трекер ответил не по-json. Похоже, адрес ведёт не туда: ${text.slice(0, 160)}`,
    );
  }
}

export type KeitaroCampaign = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
};

/** Кампании со своими группами. Кампания без группы попадает в «Без группы». */
export async function listCampaigns(baseUrl: string, apiKey: string) {
  const raw = await call(baseUrl, apiKey, '/campaigns');
  if (!Array.isArray(raw)) {
    throw new KeitaroError('Трекер вернул список кампаний в непонятном виде.');
  }

  return raw.map((c: Record<string, unknown>): KeitaroCampaign => {
    const group = (c.group ?? {}) as { id?: unknown; name?: unknown };
    const groupId = String(group.id ?? c.group_id ?? '') || 'none';
    return {
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      groupId,
      groupName: String(group.name ?? '') || (groupId === 'none' ? 'Без группы' : groupId),
    };
  });
}

export type KeitaroDay = {
  /** YYYY-MM-DD в часовом поясе, который вернул трекер. */
  date: string;
  campaignId: string;
  /** Доход в центах. */
  revenueCents: number;
  conversions: number;
};

/**
 * Доход по дням и кампаниям.
 *
 * Названия метрик в сборках Keitaro отличаются: где-то доход зовётся
 * `sale_revenue`, где-то `revenue`. Просим оба и берём то, что пришло, — иначе
 * на чужом инстансе синхронизация молча писала бы нули.
 */
export async function dailyRevenue(
  baseUrl: string,
  apiKey: string,
  from: string,
  to: string,
  timezone = 'UTC',
) {
  const raw = await call(baseUrl, apiKey, '/report/build', {
    range: { from, to, timezone },
    grouping: ['day', 'campaign_id'],
    metrics: ['conversions', 'sale_revenue', 'revenue'],
    filters: [],
    limit: 10000,
  });

  const rows = ((raw as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  const out: KeitaroDay[] = [];
  for (const row of rows) {
    const day = String(row.day ?? row.date ?? '').slice(0, 10);
    if (!day) continue;
    const money = pickNumber(row, ['sale_revenue', 'revenue', 'profit']);
    out.push({
      date: day,
      campaignId: String(row.campaign_id ?? ''),
      revenueCents: Math.round(money * 100),
      conversions: Math.round(pickNumber(row, ['conversions', 'sales'])),
    });
  }
  return out;
}

/** Первое поле из списка, в котором лежит число. Ноль — тоже значение. */
function pickNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const v = row[key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/** Проверка связи: сколько кампаний и групп видно под ключом. */
export async function checkTracker(baseUrl: string, apiKey: string) {
  const campaigns = await listCampaigns(baseUrl, apiKey);
  const groups = new Map<string, string>();
  for (const c of campaigns) groups.set(c.groupId, c.groupName);
  return { campaigns: campaigns.length, groups: [...groups].map(([id, name]) => ({ id, name })) };
}
