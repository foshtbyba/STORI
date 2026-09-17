import 'server-only';

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Тонкий клиент к официальному TikTok Marketing API (business-api.tiktok.com).
 *
 * Подключение — как у сервисов агентских кабинетов: баер открывает ссылку
 * авторизации приложения в браузере, где залогинен его TikTok-кабинет (OAuth),
 * подтверждает доступ, TikTok редиректит к нам с auth_code, мы меняем его на
 * долгоживущий access_token и получаем список advertiser_id. Дальше по токену —
 * инфо о кабинетах и расход из отчётов. Ни прокси, ни антидетекта не нужно.
 *
 * Приложение (app_id + secret) одно на всю платформу — из env. redirect_uri
 * должен совпадать с указанным в настройках приложения TikTok for Business.
 */

const API = 'https://business-api.tiktok.com/open_api/v1.3';
/** Портал авторизации (OAuth) — сюда ведём баера, чтобы он подтвердил доступ. */
const AUTH_PORTAL = 'https://business-api.tiktok.com/portal/auth';

export type TiktokConfig = { appId: string; secret: string; redirectUri: string };

/** Конфиг приложения из окружения. Пустые поля — интеграция ещё не настроена. */
export function tiktokConfig(): TiktokConfig {
  return {
    appId: process.env.TIKTOK_APP_ID ?? '',
    secret: process.env.TIKTOK_APP_SECRET ?? '',
    redirectUri: process.env.TIKTOK_REDIRECT_URI ?? '',
  };
}

/** Настроено ли приложение (есть ли смысл показывать кнопку подключения). */
export function tiktokConfigured(): boolean {
  const c = tiktokConfig();
  return Boolean(c.appId && c.secret && c.redirectUri);
}

/** Человеческая ошибка TikTok API: code != 0 приходит двухсоткой с телом. */
export class TiktokError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = 'TiktokError';
    this.code = code;
  }
}

// --- Подписанный state ---------------------------------------------------
// Кладём в state (как делает shakeads) подписанную полезную нагрузку с id баера
// и временем. Это позволяет открыть ссылку авторизации В ЛЮБОМ браузере (где
// залогинен TikTok-кабинет) — callback опознаёт баера из подписи, без куки и без
// сессии нашего приложения. Подпись — HMAC на AUTH_SECRET.
//
// Срок жизни длинный: ОДНУ ссылку баер открывает по очереди в разных
// антидетект-профилях, чтобы подключить много кабинетов подряд — она не должна
// протухнуть между профилями.
const STATE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 дней
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function stateSecret(): string {
  // Секрет для подписи state — берём серверный AUTH_SECRET (в этом приложении
  // он всегда задан: на нём держится сессия). НИКАКОГО публичного литерала-
  // фолбэка: иначе state можно подделать и привязать кабинеты к чужому баеру.
  const s = process.env.AUTH_SECRET || process.env.TIKTOK_APP_SECRET || '';
  if (!s) throw new TiktokError('Не задан AUTH_SECRET — подключение TikTok отключено');
  return s;
}

/** Подписать state: { b: buyerId, t: ts }. */
export function signTiktokState(buyerId: string): string {
  const data = b64url(Buffer.from(JSON.stringify({ b: buyerId, t: Date.now() })));
  const sig = b64url(createHmac('sha256', stateSecret()).update(data).digest());
  return `${data}.${sig}`;
}

/** Проверить state и вернуть buyerId (или null — подпись/срок не сошлись). */
export function verifyTiktokState(state: string): string | null {
  const [data, sig] = (state || '').split('.');
  if (!data || !sig) return null;
  const expected = b64url(createHmac('sha256', stateSecret()).update(data).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(unb64url(data).toString('utf8')) as { b?: string; t?: number };
    if (!payload.b || !payload.t || Date.now() - payload.t > STATE_TTL_MS) return null;
    return payload.b;
  } catch {
    return null;
  }
}

/** Ссылка авторизации приложения. state — подписанный (см. signTiktokState). */
export function tiktokAuthUrl(state: string): string {
  const c = tiktokConfig();
  const u = new URL(AUTH_PORTAL);
  u.searchParams.set('app_id', c.appId);
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

/** Разбор ответа TikTok: { code, message, data }. code 0 — успех. */
function unwrap<T>(body: unknown): T {
  const b = body as { code?: number; message?: string; data?: T };
  if (b?.code !== 0) {
    throw new TiktokError(b?.message || 'TikTok API вернул ошибку', b?.code);
  }
  return b.data as T;
}

async function apiGet<T>(path: string, accessToken: string, params: Record<string, string>): Promise<T> {
  const u = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(u, { headers: { 'Access-Token': accessToken }, cache: 'no-store' });
  } catch (e) {
    throw new TiktokError(`Не достучались до TikTok: ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TiktokError(`TikTok ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }
  return unwrap<T>(body);
}

/**
 * Обмен auth_code (из редиректа) на access_token. Возвращает токен и список
 * advertiser_id, к которым он даёт доступ. Токен долгоживущий — не протухает,
 * как пользовательский токен FB.
 */
export async function exchangeAuthCode(authCode: string): Promise<{ accessToken: string; advertiserIds: string[] }> {
  const c = tiktokConfig();
  let res: Response;
  try {
    res = await fetch(`${API}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: c.appId, secret: c.secret, auth_code: authCode, grant_type: 'authorization_code' }),
      cache: 'no-store',
    });
  } catch (e) {
    throw new TiktokError(`Не достучались до TikTok (обмен кода): ${(e as Error).message}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new TiktokError(`TikTok ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = unwrap<{ access_token?: string; advertiser_ids?: string[] }>(body);
  const accessToken = data.access_token ?? '';
  if (!accessToken) throw new TiktokError('TikTok не вернул access_token');
  return { accessToken, advertiserIds: (data.advertiser_ids ?? []).map(String) };
}

/** advertiser_id, доступные под токеном (на случай, если обмен их не вернул). */
export async function listAdvertisers(accessToken: string): Promise<string[]> {
  const c = tiktokConfig();
  const data = await apiGet<{ list?: { advertiser_id?: string | number }[] }>(
    '/oauth2/advertiser/get/',
    accessToken,
    { app_id: c.appId, secret: c.secret },
  );
  return (data.list ?? []).map((a) => String(a.advertiser_id ?? '')).filter(Boolean);
}

export type TiktokAdvertiserInfo = {
  advertiserId: string;
  name: string;
  currency: string;
  timezone: string;
  status: string;
  statusReason: string;
  balanceCents: number;
};

/** Детали кабинетов (имя, валюта, таймзона, статус, баланс) по списку id. */
export async function advertiserInfo(accessToken: string, advertiserIds: string[]): Promise<TiktokAdvertiserInfo[]> {
  if (!advertiserIds.length) return [];
  const out: TiktokAdvertiserInfo[] = [];
  // TikTok ограничивает размер запроса — тянем пачками по 100.
  for (let i = 0; i < advertiserIds.length; i += 100) {
    const chunk = advertiserIds.slice(i, i + 100);
    const data = await apiGet<{ list?: Record<string, unknown>[] }>(
      '/advertiser/info/',
      accessToken,
      {
        advertiser_ids: JSON.stringify(chunk),
        fields: JSON.stringify(['advertiser_id', 'name', 'currency', 'timezone', 'status', 'status_reason', 'balance']),
      },
    );
    for (const row of data.list ?? []) {
      out.push({
        advertiserId: String(row.advertiser_id ?? ''),
        name: String(row.name ?? ''),
        currency: String(row.currency ?? 'USD'),
        timezone: String(row.timezone ?? ''),
        status: String(row.status ?? 'STATUS_ENABLE'),
        statusReason: String(row.status_reason ?? ''),
        balanceCents: Math.round(Number(row.balance ?? 0) * 100),
      });
    }
  }
  return out;
}

// ── Кампании и статистика ─────────────────────────────────────────────────
// Читающая часть готова к боевому токену: как только приложение одобрят и в env
// появятся app_id/secret, эти вызовы отдадут реальные кампании и их метрики.

/** Строка таблицы кампаний: настройки кампании + метрики за период. */
export type TiktokCampaignRow = {
  campaignId: string;
  name: string;
  objective: string;        // objective_type: TRAFFIC, CONVERSIONS, ...
  status: string;           // operation_status: ENABLE / DISABLE
  secondaryStatus: string;  // secondary_status — детальный статус (модерация/работа)
  budgetMode: string;       // BUDGET_MODE_DAY / BUDGET_MODE_TOTAL / BUDGET_MODE_INFINITE
  budgetCents: number;      // бюджет в минорных единицах валюты кабинета
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  ctr: number;              // %
  cpcCents: number;
};

type RawCampaign = {
  campaign_id?: string | number;
  campaign_name?: string;
  objective_type?: string;
  operation_status?: string;
  secondary_status?: string;
  budget_mode?: string;
  budget?: string | number;
};

/** Список кампаний кабинета (без статистики). Пагинация по 1000. */
export async function listCampaigns(accessToken: string, advertiserId: string): Promise<RawCampaign[]> {
  const out: RawCampaign[] = [];
  let page = 1;
  for (;;) {
    const data = await apiGet<{ list?: RawCampaign[]; page_info?: { total_page?: number } }>(
      '/campaign/get/',
      accessToken,
      {
        advertiser_id: advertiserId,
        fields: JSON.stringify([
          'campaign_id', 'campaign_name', 'objective_type',
          'operation_status', 'secondary_status', 'budget_mode', 'budget',
        ]),
        page: String(page),
        page_size: '1000',
      },
    );
    for (const c of data.list ?? []) out.push(c);
    const total = data.page_info?.total_page ?? 1;
    if (page >= total) break;
    page += 1;
  }
  return out;
}

/** Метрики по кампаниям за период: campaign_id → метрики. */
async function campaignMetrics(
  accessToken: string,
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<Map<string, { spend: number; impressions: number; clicks: number; conversions: number; ctr: number; cpc: number }>> {
  const map = new Map<string, { spend: number; impressions: number; clicks: number; conversions: number; ctr: number; cpc: number }>();
  let page = 1;
  for (;;) {
    const data = await apiGet<{
      list?: { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> }[];
      page_info?: { total_page?: number };
    }>('/report/integrated/get/', accessToken, {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions: JSON.stringify(['campaign_id']),
      metrics: JSON.stringify(['spend', 'impressions', 'clicks', 'conversions', 'ctr', 'cpc']),
      start_date: startDate,
      end_date: endDate,
      page: String(page),
      page_size: '1000',
    });
    for (const row of data.list ?? []) {
      const id = String(row.dimensions?.campaign_id ?? '');
      if (!id) continue;
      const m = row.metrics ?? {};
      map.set(id, {
        spend: Number(m.spend ?? 0),
        impressions: Number(m.impressions ?? 0),
        clicks: Number(m.clicks ?? 0),
        conversions: Number(m.conversions ?? 0),
        ctr: Number(m.ctr ?? 0),
        cpc: Number(m.cpc ?? 0),
      });
    }
    const total = data.page_info?.total_page ?? 1;
    if (page >= total) break;
    page += 1;
  }
  return map;
}

/** Кампании кабинета со статистикой за период — готовые строки для таблицы. */
export async function campaignsWithStats(
  accessToken: string,
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<TiktokCampaignRow[]> {
  const [campaigns, metrics] = await Promise.all([
    listCampaigns(accessToken, advertiserId),
    campaignMetrics(accessToken, advertiserId, startDate, endDate).catch(() => new Map()),
  ]);
  return campaigns.map((c) => {
    const id = String(c.campaign_id ?? '');
    const m = metrics.get(id);
    return {
      campaignId: id,
      name: String(c.campaign_name ?? ''),
      objective: String(c.objective_type ?? ''),
      status: String(c.operation_status ?? ''),
      secondaryStatus: String(c.secondary_status ?? ''),
      budgetMode: String(c.budget_mode ?? ''),
      budgetCents: Math.round(Number(c.budget ?? 0) * 100),
      spendCents: Math.round((m?.spend ?? 0) * 100),
      impressions: Math.round(m?.impressions ?? 0),
      clicks: Math.round(m?.clicks ?? 0),
      conversions: Math.round(m?.conversions ?? 0),
      ctr: m?.ctr ?? 0,
      cpcCents: Math.round((m?.cpc ?? 0) * 100),
    };
  });
}

/** POST в TikTok API (JSON-тело). Разворачивает { code, message, data }. */
async function apiPost<T>(path: string, accessToken: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (e) {
    throw new TiktokError(`Не достучались до TikTok: ${(e as Error).message}`);
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TiktokError(`TikTok ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }
  return unwrap<T>(parsed);
}

// ── Пауза / запуск / бюджет кампании ───────────────────────────────────────

/** Включить/выключить кампанию (operation_status: ENABLE | DISABLE). */
export async function setCampaignStatus(
  accessToken: string,
  advertiserId: string,
  campaignId: string,
  enable: boolean,
): Promise<void> {
  await apiPost('/campaign/status/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_ids: [campaignId],
    operation_status: enable ? 'ENABLE' : 'DISABLE',
  });
}

/** Изменить бюджет кампании (в основных единицах валюты, напр. 50 = $50). */
export async function updateCampaignBudget(
  accessToken: string,
  advertiserId: string,
  campaignId: string,
  budget: number,
): Promise<void> {
  await apiPost('/campaign/update/', accessToken, {
    advertiser_id: advertiserId,
    campaign_id: campaignId,
    budget,
  });
}

// ── Автозалив: создание кампании → группы → загрузка ролика → объявление ────
// Реализовано по документации Marketing API для видео-объявлений с ведением на
// сайт (objective TRAFFIC/WEBSITE). Перед боевым запуском проверить на тестовом
// кабинете: набор обязательных полей группы зависит от цели и типа продвижения.

export type TiktokLaunchInput = {
  advertiserId: string;
  campaignName: string;
  objective: string;             // TRAFFIC | CONVERSIONS | VIDEO_VIEWS | REACH
  budgetMode: string;            // BUDGET_MODE_DAY | BUDGET_MODE_TOTAL
  budget: number;                // бюджет кампании в основных единицах
  locationIds: string[];         // гео (location_id TikTok)
  ageGroups: string[];           // напр. ['AGE_25_34','AGE_35_44']
  gender: string;                // GENDER_UNLIMITED | GENDER_MALE | GENDER_FEMALE
  identityId: string;            // от чьего имени показывать (identity)
  identityType: string;          // CUSTOMIZED_USER | AUTH_CODE | TT_USER
  adText: string;
  landingUrl: string;
  callToAction: string;          // напр. LEARN_MORE, SHOP_NOW
  enable: boolean;               // запустить сразу или создать на паузе
};

/** Создать кампанию → вернуть campaign_id. */
export async function createCampaign(accessToken: string, i: TiktokLaunchInput): Promise<string> {
  const data = await apiPost<{ campaign_id?: string | number }>('/campaign/create/', accessToken, {
    advertiser_id: i.advertiserId,
    campaign_name: i.campaignName,
    objective_type: i.objective,
    budget_mode: i.budgetMode,
    budget: i.budget,
  });
  const id = String(data.campaign_id ?? '');
  if (!id) throw new TiktokError('TikTok не вернул campaign_id');
  return id;
}

/** Создать группу объявлений в кампании → вернуть adgroup_id. */
export async function createAdGroup(
  accessToken: string,
  i: TiktokLaunchInput,
  campaignId: string,
): Promise<string> {
  const data = await apiPost<{ adgroup_id?: string | number }>('/adgroup/create/', accessToken, {
    advertiser_id: i.advertiserId,
    campaign_id: campaignId,
    adgroup_name: `${i.campaignName} · AG`,
    placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
    promotion_type: 'WEBSITE',
    location_ids: i.locationIds,
    ...(i.ageGroups.length ? { age_groups: i.ageGroups } : {}),
    gender: i.gender,
    budget_mode: i.budgetMode,
    budget: i.budget,
    schedule_type: 'SCHEDULE_FROM_NOW',
    optimization_goal: i.objective === 'CONVERSIONS' ? 'CONVERT' : 'CLICK',
    billing_event: 'CPC',
    pacing: 'PACING_MODE_SMOOTH',
    operation_status: i.enable ? 'ENABLE' : 'DISABLE',
  });
  const id = String(data.adgroup_id ?? '');
  if (!id) throw new TiktokError('TikTok не вернул adgroup_id');
  return id;
}

/** Загрузить видеофайл в кабинет (multipart) → вернуть video_id. */
export async function uploadVideoFromFile(
  accessToken: string,
  advertiserId: string,
  file: File,
): Promise<string> {
  const form = new FormData();
  form.set('advertiser_id', advertiserId);
  form.set('upload_type', 'UPLOAD_BY_FILE');
  form.set('video_file', file, file.name || 'video.mp4');
  let res: Response;
  try {
    res = await fetch(`${API}/file/video/ad/upload/`, {
      method: 'POST',
      headers: { 'Access-Token': accessToken },
      body: form,
      cache: 'no-store',
    });
  } catch (e) {
    throw new TiktokError(`Не удалось загрузить ролик: ${(e as Error).message}`);
  }
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TiktokError(`TikTok ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = unwrap<{ video_id?: string }[] | { video_id?: string }>(parsed);
  const first = Array.isArray(data) ? data[0] : data;
  const id = String(first?.video_id ?? '');
  if (!id) throw new TiktokError('TikTok не вернул video_id');
  return id;
}

/** Создать объявление в группе → вернуть ad_id. */
export async function createAd(
  accessToken: string,
  i: TiktokLaunchInput,
  adgroupId: string,
  videoId: string,
): Promise<string> {
  const data = await apiPost<{ ad_ids?: (string | number)[] }>('/ad/create/', accessToken, {
    advertiser_id: i.advertiserId,
    adgroup_id: adgroupId,
    creatives: [
      {
        ad_name: `${i.campaignName} · AD`,
        identity_id: i.identityId,
        identity_type: i.identityType,
        ad_format: 'SINGLE_VIDEO',
        video_id: videoId,
        ad_text: i.adText,
        call_to_action: i.callToAction,
        landing_page_url: i.landingUrl,
      },
    ],
  });
  const id = String((data.ad_ids ?? [])[0] ?? '');
  if (!id) throw new TiktokError('TikTok не вернул ad_id');
  return id;
}

/** Идентити кабинета (от чьего имени публикуем объявление). */
export type TiktokIdentity = { identityId: string; identityType: string; displayName: string };

/** Список identity кабинета (для выбора в форме автозалива). */
export async function listIdentities(accessToken: string, advertiserId: string): Promise<TiktokIdentity[]> {
  const data = await apiGet<{ identity_list?: Record<string, unknown>[] }>(
    '/identity/get/',
    accessToken,
    { advertiser_id: advertiserId },
  );
  return (data.identity_list ?? []).map((r) => ({
    identityId: String(r.identity_id ?? ''),
    identityType: String(r.identity_type ?? 'CUSTOMIZED_USER'),
    displayName: String(r.display_name ?? ''),
  }));
}

/** Один день расхода по кабинету. */
export type TiktokSpendDay = { date: string; cents: number };

/**
 * Дневной расход по кабинету за период (YYYY-MM-DD). Отчёт integrated с
 * разбивкой по дням. spend приходит десятичной строкой в валюте кабинета.
 */
export async function advertiserSpendDays(
  accessToken: string,
  advertiserId: string,
  startDate: string,
  endDate: string,
): Promise<TiktokSpendDay[]> {
  const out: TiktokSpendDay[] = [];
  let page = 1;
  // Пагинация: TikTok отдаёт page_info с total_page.
  for (;;) {
    const data = await apiGet<{
      list?: { dimensions?: Record<string, unknown>; metrics?: Record<string, unknown> }[];
      page_info?: { total_page?: number };
    }>('/report/integrated/get/', accessToken, {
      advertiser_id: advertiserId,
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: JSON.stringify(['advertiser_id', 'stat_time_day']),
      metrics: JSON.stringify(['spend']),
      start_date: startDate,
      end_date: endDate,
      page: String(page),
      page_size: '1000',
    });
    for (const row of data.list ?? []) {
      const day = String(row.dimensions?.stat_time_day ?? '').slice(0, 10);
      const spend = Number(row.metrics?.spend ?? 0);
      if (day) out.push({ date: day, cents: Math.round(spend * 100) });
    }
    const totalPage = data.page_info?.total_page ?? 1;
    if (page >= totalPage) break;
    page += 1;
  }
  return out;
}
