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
// залогинен TikTok-кабинет) — callback опознает баера из подписи, без куки и без
// сессии нашего приложения. Подпись — HMAC на AUTH_SECRET, жизнь — 15 минут.
const STATE_TTL_MS = 15 * 60 * 1000;
const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
function stateSecret(): string {
  return process.env.AUTH_SECRET || process.env.TIKTOK_APP_SECRET || 'tiktok-state';
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
