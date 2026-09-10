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
  // Часть ручек на успехе отвечают пустым телом (напр. обновление расхода) —
  // это не ошибка, возвращаем пустой объект.
  if (!text.trim()) return {};
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
  /** Токен из TDS-ссылки: `track.top/qynyTnDK` → `qynyTnDK`. По нему объявление
   *  ФБ (в ссылке которого он и стоит) приписывается к этой кампании. */
  token: string;
  /** Человекочитаемый псевдоним ссылки — второй способ адресовать кампанию. */
  alias: string;
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
      token: String(c.token ?? ''),
      alias: String(c.alias ?? ''),
    };
  });
}

/**
 * Индекс «токен/псевдоним кампании → кампания». По ключу из ссылки объявления
 * находим кампанию КТ. Кладём и токен, и alias: ссылку размечают то одним, то
 * другим. Регистр сохраняем — токены Keitaro регистрозависимы.
 */
export function indexByToken(campaigns: KeitaroCampaign[]) {
  const map = new Map<string, KeitaroCampaign>();
  for (const c of campaigns) {
    if (c.token) map.set(c.token, c);
    if (c.alias) map.set(c.alias, c);
  }
  return map;
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
 * Доход — это ПОДТВЕРЖДЁННЫЙ доход, поле `sale_revenue` (в UI Keitaro «Доход
 * (подтверждённый)»). Именно его команда считает доходом. Поле `revenue` брать
 * нельзя: оно включает неподтверждённые лиды и завышает — на реальном дне
 * revenue давал $827 против настоящих $101 в sale_revenue.
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
    metrics: ['conversions', 'sale_revenue'],
    filters: [],
    limit: 10000,
  });

  const rows = ((raw as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  const out: KeitaroDay[] = [];
  for (const row of rows) {
    const day = String(row.day ?? row.date ?? '').slice(0, 10);
    if (!day) continue;
    const money = Number(row.sale_revenue ?? 0);
    out.push({
      date: day,
      campaignId: String(row.campaign_id ?? ''),
      revenueCents: Number.isFinite(money) ? Math.round(money * 100) : 0,
      conversions: Math.round(pickNumber(row, ['conversions', 'sales'])),
    });
  }
  return out;
}

export type KeitaroAdDay = {
  date: string;
  /** Значение sub_id_4 — это ad_id объявления Facebook. */
  subId4: string;
  revenueCents: number;
  conversions: number;
};

/**
 * Доход и конверсии по дням в разрезе sub_id_4 (= ad_id объявления Facebook).
 *
 * Стандартный шаблон Facebook в Keitaro кладёт ad.id в Sub ID 4, поэтому по нему
 * доход сводится к конкретному объявлению — для профита в таблице кампаний.
 */
export async function revenueByAd(
  baseUrl: string,
  apiKey: string,
  from: string,
  to: string,
  timezone = 'UTC',
) {
  const raw = await call(baseUrl, apiKey, '/report/build', {
    range: { from, to, timezone },
    grouping: ['day', 'sub_id_4'],
    metrics: ['conversions', 'sale_revenue'],
    filters: [],
    limit: 50000,
  });

  const rows = ((raw as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  const out: KeitaroAdDay[] = [];
  for (const row of rows) {
    const day = String(row.day ?? row.date ?? '').slice(0, 10);
    const subId4 = String(row.sub_id_4 ?? '').trim();
    if (!day || !subId4) continue;
    const money = Number(row.sale_revenue ?? 0);
    out.push({
      date: day,
      subId4,
      revenueCents: Number.isFinite(money) ? Math.round(money * 100) : 0,
      conversions: Math.round(pickNumber(row, ['conversions', 'sales'])),
    });
  }
  return out;
}

/**
 * Кампании, у кликов которых реально заполнен Sub ID 4 (= ad_id объявления
 * Facebook). Нужно, чтобы решить, как заливать расход: где Sub ID 4 есть —
 * точечно по объявлению (фильтр), где нет — на кампанию целиком.
 *
 * Берём отчёт по кликам, сгруппированный «кампания + Sub ID 4»: если у кампании
 * встречается хоть одна строка с непустым Sub ID 4 — значит в её кликах он
 * проставляется, и точечная привязка сработает.
 */
/**
 * Карта «ad_id (sub_id_4) → кампания КТ», построенная по САМИМ кликам Keitaro.
 *
 * Надёжнее матчинга по ссылке объявления: не зависит от того, какой токен в
 * ссылке и распознали ли мы его — берём кампанию, под которой Keitaro реально
 * залогировал клики этого объявления. По ней и льём расход, чтобы он лёг туда
 * же, где клики (иначе cost ложится в пустую кампанию и в отчёте остаётся 0).
 *
 * Если у одного sub_id_4 клики в нескольких кампаниях — берём ту, где их больше.
 */
export async function adCampaignMap(
  baseUrl: string,
  apiKey: string,
  from: string,
  to: string,
  timezone = 'UTC',
): Promise<{ dayMap: Map<string, string>; adMap: Map<string, string> }> {
  const raw = await call(baseUrl, apiKey, '/report/build', {
    range: { from, to, timezone },
    grouping: ['sub_id_4', 'campaign_id', 'day'],
    metrics: ['clicks'],
    filters: [],
    limit: 100000,
  });

  const rows = ((raw as { rows?: unknown }).rows ?? []) as Record<string, unknown>[];
  // Лучшая кампания по кликам за КОНКРЕТНЫЙ день (точная привязка расхода дня)
  // и за всё окно (запасная, если по дню клика не нашлось).
  const bestDay = new Map<string, { campId: string; clicks: number }>();
  const bestAd = new Map<string, { campId: string; clicks: number }>();
  for (const row of rows) {
    const sub = String(row.sub_id_4 ?? '').trim();
    const campId = String(row.campaign_id ?? '').trim();
    const day = String(row.day ?? row.date ?? '').slice(0, 10);
    if (!sub || !campId) continue;
    const clicks = Math.round(Number(row.clicks ?? 0)) || 0;
    if (day) {
      const dk = `${sub}|${day}`;
      const cd = bestDay.get(dk);
      if (!cd || clicks > cd.clicks) bestDay.set(dk, { campId, clicks });
    }
    const ca = bestAd.get(sub);
    if (!ca || clicks > ca.clicks) bestAd.set(sub, { campId, clicks });
  }
  const dayMap = new Map<string, string>();
  for (const [k, v] of bestDay) dayMap.set(k, v.campId);
  const adMap = new Map<string, string>();
  for (const [k, v] of bestAd) adMap.set(k, v.campId);
  return { dayMap, adMap };
}

/**
 * Первое НЕнулевое число из списка полей. Ноль пропускаем как возможную
 * заглушку и берём следующее имя; если везде ноль или пусто — значит дохода
 * правда нет, возвращаем ноль.
 */
function pickNumber(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const v = row[key];
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

/** Один фильтр кликов Keitaro: имя поля, оператор, значение. Такой же формат,
 *  как в отчётах (`/report/build`) — массив таких объектов. */
export type CostFilter = {
  name: string;
  /** Оператор сравнения Keitaro. Для точного совпадения — `EQUALS`. */
  operator: string;
  expression: string;
};

/** Одна запись расхода для заливки в Keitaro: отрезок времени, сумма и фильтр. */
export type CostEntry = {
  /** «YYYY-MM-DD HH:MM:SS» в поясе трекера. */
  start_date: string;
  end_date: string;
  /** Расход в долларах (число, не центы). */
  cost: number;
  /** Валюта расхода — Keitaro требует её обязательно. */
  currency?: string;
  /**
   * Фильтры кликов — МАССИВ объектов `{ name, operator, expression }`, как в
   * отчётах Keitaro. Напр. `[{ name: 'sub_id_4', operator: 'EQUALS',
   * expression: '123' }]`: расход ложится ровно на клики нужного объявления
   * (ad_id в Sub ID 4), как это делает FBtool. Без фильтра — на все клики
   * кампании за период. Key-value (`{ sub_id_4: '123' }`) Keitaro молча
   * игнорирует, и расход никуда не пишется.
   */
  filters?: CostFilter[];
};

/**
 * Залить расход в Keitaro пачкой (ручка «Update costs in bulk»,
 * POST /admin_api/v1/clicks/update_costs).
 *
 * Расход применяется к кликам указанных кампаний за отрезок: трекер сам
 * раскладывает сумму по кликам (CPC = сумма / клики). Шлём на ОДНУ кампанию
 * массив дневных сумм — так расход в отчётах КТ встаёт рядом с доходом, и
 * наконец считается ROI внутри самого трекера.
 */
export async function updateCostsBulk(
  baseUrl: string,
  apiKey: string,
  campaignId: string,
  costs: CostEntry[],
  timezone = 'UTC',
) {
  if (costs.length === 0) return {} as unknown;
  // Keitaro для этой ручки требует currency и timezone. Ставим на верхнем уровне
  // и currency дублируем в каждой записи (по умолчанию USD).
  const withCurrency = costs.map((c) => ({ currency: 'USD', ...c }));
  // Возвращаем ответ КТ — по нему видно, к скольким кликам реально применился
  // расход (иначе «залито» значит лишь «запрос принят», а не «cost встал»).
  return await call(baseUrl, apiKey, '/clicks/update_costs', {
    campaign_ids: [Number(campaignId)],
    currency: 'USD',
    timezone,
    costs: withCurrency,
  });
}

/** Проверка связи: сколько кампаний и групп видно под ключом. */
export async function checkTracker(baseUrl: string, apiKey: string) {
  const campaigns = await listCampaigns(baseUrl, apiKey);
  const groups = new Map<string, string>();
  for (const c of campaigns) groups.set(c.groupId, c.groupName);
  return { campaigns: campaigns.length, groups: [...groups].map(([id, name]) => ({ id, name })) };
}
