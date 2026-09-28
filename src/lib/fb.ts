import 'server-only';

import axios from 'axios';
import FormDataNode from 'form-data';

import { proxyAgent } from './proxy-agent';
import { cookieHeaderOf, readCookieBlob } from './fb-engine';
import { buildPlacementTargeting } from './placements';

/**
 * Тонкий клиент к Marketing API Facebook. Нужны ровно две вещи: список
 * кабинетов под токеном и дневной расход по каждому.
 *
 * Токен берётся у System User в Business Manager — он бессрочный и не завязан
 * на чей-то личный вход. Обычный пользовательский токен тоже подойдёт, но
 * протухнет через пару месяцев, и синхронизация встанет.
 */

/** Версию держим в одном месте: Мета выпускает новую раз в квартал. */
const API = 'https://graph.facebook.com/v21.0';

/**
 * Версия для СОЗДАЮЩИХ вызовов автозалива (кампания/адсет/креатив/объявление).
 * С v22.0 у Меты модель «opt-in»: авто-улучшения креатива (Advantage+/Essential
 * — enhance CTA, яркость/контраст, релевантные комментарии, спотлайты) НЕ
 * применяются, если их явно не включили. На старой v21 они включались сами и
 * standard_enhancements OPT_OUT их не гасил. Чтение/синк оставляем на v21.
 */
const CREATE_API_VERSION = 'v22.0';

export type FbAccount = {
  externalId: string;
  name: string;
  currency: string;
  /** account_status из Facebook: 1 активен, 2 отключён, 3 не оплачен и т.д. */
  accountStatus: number;
  /** disable_reason: почему отключён (0 — не отключён). */
  disableReason: number;
  /** Лимит кабинета (spend_cap) в минорных единицах валюты; 0 — лимита нет. */
  spendCapCents: number;
  /** Всего потрачено (amount_spent) в минорных единицах. */
  amountSpentCents: number;
  /** Текущий баланс (balance) в минорных единицах. */
  balanceCents: number;
};

/** День расхода по одному кабинету. */
export type FbSpendDay = {
  /** YYYY-MM-DD, как отдаёт Facebook. */
  date: string;
  /** Расход в минимальных единицах валюты кабинета. */
  cents: number;
};

/**
 * Ошибка с человеческим текстом. Facebook на любой чих отвечает двухсоткой с
 * телом `{error:{...}}` либо четырёхсоткой с тем же телом — разбираем оба
 * случая одинаково, иначе в интерфейсе окажется «Unexpected token <».
 */
export class FbError extends Error {
  /** Код и субкод Facebook — по ним синхронизация решает, отступить ли. */
  code?: number;
  subcode?: number;
  /** Технический message ФБ как есть (в нём Мета часто перечисляет допустимые
   * значения поля — для error_user_msg этот список обычно теряется). */
  raw?: string;
  constructor(message: string, code?: number, subcode?: number, raw?: string) {
    super(message);
    this.name = 'FbError';
    this.code = code;
    this.subcode = subcode;
    this.raw = raw;
  }
}

/**
 * Что это за ошибка Facebook — по коду. Синхронизация реагирует по-разному:
 * на троттлинг и «подозрительную активность» надо немедленно отступить и дать
 * аккаунту отдохнуть, чтобы не доводить до чекпоинта; протухший токен трогать
 * бессмысленно; остальное — разовый сбой.
 */
export function fbErrorKind(e: unknown): 'throttle' | 'blocked' | 'token' | 'other' {
  if (!(e instanceof FbError) || e.code == null) return 'other';
  const c = e.code;
  // Троттлинг: слишком часто дёргали API.
  if (c === 4 || c === 17 || c === 32 || c === 613 || c === 80004) return 'throttle';
  // 368 — «временно заблокировано за подозрительную активность». Прямой
  // предвестник чекпоинта: тут нельзя ходить дальше ни в коем случае.
  if (c === 368) return 'blocked';
  // 190 — токен недействителен/протух: ходить им бесполезно.
  if (c === 190) return 'token';
  return 'other';
}

/**
 * Из строки, которую вставил человек, достаём рабочий токен Graph API.
 *
 * Вставляют двумя способами. Либо это плоский ключ вида `EAAB…` — тогда берём
 * как есть. Либо «мультитокен» из антидетекта: base64 от JSON с полями
 * `cookies`, `ua`, `token`; кабинеты у команды арендованные, System User там
 * не завести, и это единственный рабочий вход. Нам из него нужен `token`, а
 * заодно `ua` — тем же user-agent ходим в Graph, чтобы запрос был чуть меньше
 * похож на робота с чужого IP.
 *
 * base64 объекта всегда начинается с `eyJ` (это закодированное «{"»), по этому
 * и различаем два случая.
 */
/**
 * Пытаемся вытащить ключ из мультитокена антидетекта. Формат у всех чуть
 * разный: обычный или url-safe base64, поле ключа зовётся то `token`, то
 * `access_token`, то `accessToken`; user-agent — `ua`/`userAgent`. Перебираем
 * оба варианта base64 и известные имена полей, возвращаем первое, что похоже
 * на настоящий ключ Graph API (EAA…). Ничего не подошло — null.
 */
function tryMultitoken(s: string): { token: string; ua?: string } | null {
  const urlSafe = s.replace(/-/g, '+').replace(/_/g, '/');
  for (const variant of new Set([s, urlSafe])) {
    let json: string;
    try {
      json = Buffer.from(variant, 'base64').toString('utf8');
    } catch {
      continue;
    }
    if (!json.trim().startsWith('{')) continue;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(json) as Record<string, unknown>;
    } catch {
      continue;
    }

    const pick = (keys: string[]) => {
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v) return v;
      }
      return undefined;
    };
    const token = pick(['token', 'access_token', 'accessToken', 'fb_token', 'fbToken']);
    if (!token) continue;
    return { token, ua: pick(['ua', 'userAgent', 'user_agent']) };
  }
  return null;
}

export function extractFbToken(raw: string): { token: string; ua?: string } {
  // Убираем не только края, но и переносы строк и пробелы ВНУТРИ: из чата и
  // антидетекта строка часто прилетает разбитой на несколько строк, а лишний
  // \n посреди ключа Facebook уже не примет.
  const s = raw.replace(/\s+/g, '');
  if (!s) throw new FbError('Пусто — вставь токен или мультитокен');

  // Плоский ключ Graph API начинается с EAA — берём как есть, без фокусов.
  if (/^EAA[A-Za-z0-9]/.test(s)) return { token: s };

  // Иначе пробуем разобрать как мультитокен антидетекта: base64(JSON) с полем
  // token. Кодируют по-разному — обычный и url-safe base64, иногда с пробелом
  // после «{», — поэтому не привязываемся к префиксу eyJ, а честно пробуем
  // раскодировать оба варианта и достать token.
  const multi = tryMultitoken(s);
  if (multi) return multi;

  // Строка похожа на мультитокен (base64 приличной длины), но раскодировать
  // token не удалось — это не «просто плоский ключ», а битый мультитокен.
  if (/^[A-Za-z0-9+/_=-]{60,}$/.test(s) && !s.startsWith('EAA')) {
    throw new FbError(
      'Похоже на мультитокен из антидетекта, но ключ из него не достаётся — скопирован не целиком. Возьми строку целиком (обычно очень длинная) и вставь заново.',
    );
  }

  // Не EAA и не мультитокен — но вдруг всё-таки рабочий ключ иного вида.
  // Отдаём как есть, пусть Facebook скажет своё слово.
  return { token: s };
}

/**
 * Чем и через что ходим в Graph.
 *
 * `ua` приезжает из мультитокена антидетекта. `proxyUrl` — прокси того
 * аккаунта, которому принадлежит ключ: кабинеты арендованные, и Facebook
 * заметно спокойнее, когда запросы идут с привычного адреса, а не с адреса
 * сервера. Оба поля необязательны — без них ходим напрямую.
 */
export type FbNet = { ua?: string; proxyUrl?: string | null; cookie?: string | null };

/**
 * Один запрос к Graph, с прокси или без.
 *
 * Через прокси идём axios-ом: у него агент подключается одной строкой.
 * Напрямую — обычным fetch, без лишней зависимости в горячем пути. Наружу оба
 * пути отдают одно и то же — код ответа и тело строкой, — поэтому разбор
 * ошибок ниже общий и про транспорт ничего не знает.
 */
async function send(
  url: URL,
  net: FbNet,
  method: 'GET' | 'POST' = 'GET',
  reqBody?: string,
): Promise<{ status: number; text: string }> {
  // Токены, снятые из Ads Manager, публичный Graph API принимает только когда
  // запрос выглядит как из браузера аккаунта: его user-agent, его куки и его
  // прокси. Без кук на такой токен приходит «код 1 Invalid request», хотя сам
  // токен рабочий — это и путало. С куками сессии тот же токен отдаёт данные.
  const headers: Record<string, string> = {};
  if (net.ua) headers['User-Agent'] = net.ua;
  if (net.cookie) headers['Cookie'] = net.cookie;
  // Тело POST-а уходит form-urlencoded (см. call): у креативов payload с
  // object_story_spec/asset_feed_spec огромный, в query он не влезает — edge
  // Facebook рубит слишком длинный URL HTML-страницей 400/502 ещё до Graph API.
  if (reqBody !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  if (net.proxyUrl) {
    const agent = proxyAgent(net.proxyUrl);
    const res = await axios.request({
      method,
      url: url.toString(),
      headers,
      data: reqBody,
      httpAgent: agent,
      httpsAgent: agent,
      // Facebook на длинную цепочку кук иногда отвечает не по-json огромной
      // HTML-страницей — режем ответ, чтобы не тянуть её целиком в память.
      maxContentLength: 5_000_000,
      timeout: 20000,
      // Тело нужно строкой и без разбора: JSON парсится ниже, вместе с
      // ответами прямого пути.
      responseType: 'text',
      transformResponse: [(d) => d],
      // Четырёхсотки — это ответ Facebook с телом, а не сбой связи: разбираем
      // их сами, поэтому axios не должен бросать исключение.
      validateStatus: () => true,
    });
    return { status: res.status, text: String(res.data ?? '') };
  }

  const res = await fetch(url, {
    method,
    cache: 'no-store',
    headers: Object.keys(headers).length ? headers : undefined,
    body: reqBody,
  });
  return { status: res.status, text: await res.text() };
}

async function call(
  path: string,
  token: string,
  params: Record<string, string> = {},
  net: FbNet = {},
  method: 'GET' | 'POST' = 'GET',
  version?: string,
) {
  const base = version ? `https://graph.facebook.com/${version}` : API;
  const url = new URL(`${base}${path}`);
  url.searchParams.set('access_token', token);
  // GET кладёт параметры в query; POST — в тело form-urlencoded. Payload
  // креатива (object_story_spec, asset_feed_spec, длинный link) в query не
  // помещается: edge Facebook отвечает на слишком длинный URL HTML-страницей
  // 400/502 «Client Error», хотя сам Graph API запрос принял бы.
  let reqBody: string | undefined;
  if (method === 'POST') {
    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) form.set(k, v);
    reqBody = form.toString();
  } else {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  let res: { status: number; text: string };
  try {
    res = await send(url, net, method, reqBody);
  } catch (e) {
    const via = net.proxyUrl ? ' (через прокси — проверь адрес и доступность)' : '';
    throw new FbError(`Не достучались до Facebook${via}: ${(e as Error).message}`);
  }

  const text = res.text;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FbError(`Facebook ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }

  const err = (
    body as {
      error?: {
        message?: string;
        code?: number;
        error_subcode?: number;
        error_user_msg?: string;
      };
    }
  ).error;
  if (err) {
    throw new FbError(fbErrorMessage(err, res.status), err.code, err.error_subcode, err.message);
  }
  if (res.status < 200 || res.status >= 300) {
    throw new FbError(`Facebook ответил ${res.status}`);
  }
  return body as Record<string, unknown>;
}

/**
 * Ошибки Facebook приходят голым кодом — «код 1: Invalid request» человеку
 * ничего не говорит и чинить нечего. Переводим частые коды в подсказку: что
 * именно не так с токеном и что проверить. Субкод показываем в скобках — по
 * нему различаются «протух» и «отозван» внутри одного кода 190.
 */
function fbErrorMessage(
  err: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string },
  status: number,
) {
  const code = err.code ?? status;
  const sub = err.error_subcode ? `/${err.error_subcode}` : '';
  const why = err.error_user_msg || err.message || 'без объяснений';
  const hint = fbHint(code, err.error_subcode, why);
  const base = `Facebook отказал (код ${code}${sub}): ${why}`;
  return hint ? `${base} — ${hint}` : base;
}

function fbHint(code: number, subcode: number | undefined, why: string): string | null {
  const w = why.toLowerCase();
  // 190 — проблема с самим токеном; субкод уточняет, какая именно.
  if (code === 190) {
    if (subcode === 463) return 'срок токена вышел — выпусти новый в бизнес-менеджере.';
    if (subcode === 467) return 'токен отозван или уже недействителен — выпусти новый.';
    if (subcode === 460) return 'токен привязан к другой сессии/паролю — перевыпусти его.';
    return 'токен недействителен или протух. Выпусти новый и вставь его целиком.';
  }
  // 1/2 «Invalid request» — Facebook не принял строку как ключ. Два разных
  // случая, и различать их важно: вставили не то (обрезанный ключ, cookie,
  // адрес кабинета) — либо ключ был настоящий, но его сессия закончилась.
  // Второе встречается чаще: ключи из антидетекта живут вместе с сессией
  // профиля и через несколько дней умирают молча, отвечая ровно этим кодом.
  if (code === 1 || code === 2 || w.includes('invalid request')) {
    return 'Facebook не принял этот ключ. Если он из антидетекта — скорее всего, закончилась сессия профиля: зайди в него, дай Ads Manager прогрузиться и возьми мультитокен заново, либо подключись через «Cookies» с прокси аккаунта. Если ключ вставляли руками — проверь, что строка скопирована целиком, а не оборвана. Ключ System User из Business Manager так не протухает.';
  }
  // 100 — плохие параметры. С субкодом это конкретная ошибка запроса (напр.
  // событие не подходит к цели кампании) — тогда честнее оставить текст ФБ, а не
  // валить на токен. Без субкода на нашем /me это обычно битый токен.
  if (code === 100) {
    // Кабинет привязан к конкретной ФП: реклама с другой страницы не проходит.
    if (w.includes("promoting doesn't match") || w.includes('during ad account creation')) {
      return 'кабинет привязан к другой Странице — выбери ту ФП, что разрешена этому кабинету (или подключи нужную страницу к кабинету).';
    }
    // С субкодом или с явным «param … must be one of …» это конкретная ошибка
    // параметров запроса (не токен) — оставляем текст ФБ как есть.
    if (subcode || w.includes('param ') || w.includes('must be one of') || w.includes('_spec')) return null;
    return 'Facebook не понял запрос — обычно так отвечает на неполный или испорченный токен.';
  }
  // Троттлинг: частые запросы к API.
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return 'Facebook временно режет частые запросы. Подожди пару минут и попробуй снова.';
  }
  // Нет прав на рекламные кабинеты под этим токеном.
  if (code === 10 || code === 200 || code === 803) {
    return 'у токена не хватает прав на рекламные кабинеты. Добавь доступ и выпусти новый.';
  }
  return null;
}

/**
 * Кабинеты, доступные под токеном. Постранично: у крупного BM их бывает
 * больше сотни, а Facebook отдаёт по 25 за раз.
 */
export async function listAccounts(token: string, net: FbNet = {}) {
  const out: FbAccount[] = [];
  let after = '';

  // Ограничение сверху на всякий случай: битая пагинация не должна вешать
  // синхронизацию навсегда.
  for (let page = 0; page < 40; page += 1) {
    const body = await call('/me/adaccounts', token, {
      fields: 'account_id,name,currency,account_status,disable_reason,spend_cap,amount_spent,balance',
      limit: '100',
      ...(after ? { after } : {}),
    }, net);
    const data = (body.data ?? []) as {
      account_id?: string;
      name?: string;
      currency?: string;
      account_status?: number;
      disable_reason?: number;
      spend_cap?: string | number;
      amount_spent?: string | number;
      balance?: string | number;
    }[];
    for (const row of data) {
      if (!row.account_id) continue;
      out.push({
        externalId: `act_${row.account_id}`,
        name: row.name ?? '',
        currency: row.currency ?? 'USD',
        accountStatus: Number(row.account_status ?? 1),
        disableReason: Number(row.disable_reason ?? 0),
        // FB отдаёт эти суммы строкой в минорных единицах валюты кабинета.
        spendCapCents: Math.round(Number(row.spend_cap ?? 0)),
        amountSpentCents: Math.round(Number(row.amount_spent ?? 0)),
        balanceCents: Math.round(Number(row.balance ?? 0)),
      });
    }
    const next = (body.paging as { cursors?: { after?: string }; next?: string } | undefined);
    if (!next?.next || !next.cursors?.after) break;
    after = next.cursors.after;
  }

  return out;
}

/**
 * Дневной расход по кабинету за отрезок.
 *
 * `time_increment=1` разбивает по дням, `level=account` не даёт Facebook
 * раскладывать ещё и по кампаниям — нам нужна одна цифра на день.
 *
 * Даты — строки YYYY-MM-DD в часовом поясе кабинета. Своим временем Facebook
 * живёт сам, и подгонять его под UTC бесполезно: в отчёте будет то, что видит
 * баер у себя в кабинете, а это как раз то, что нужно.
 */
export async function accountSpend(
  token: string,
  externalId: string,
  from: string,
  to: string,
  net: FbNet = {},
) {
  const body = await call(`/${externalId}/insights`, token, {
    fields: 'spend',
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '500',
  }, net);

  const rows = (body.data ?? []) as { date_start?: string; spend?: string }[];
  const out: FbSpendDay[] = [];
  for (const row of rows) {
    if (!row.date_start) continue;
    // spend приходит строкой вроде "123.45" — в центы через округление, иначе
    // копейки расползаются на длинных отрезках.
    const cents = Math.round(Number(row.spend ?? 0) * 100);
    if (!Number.isFinite(cents)) continue;
    out.push({ date: row.date_start, cents });
  }
  return out;
}

/**
 * Проверка вставленной строки: разбираем плоский токен или мультитокен, потом
 * смотрим, кто под ним и сколько кабинетов видно.
 */
/**
 * Собрать доступ к Graph из того, что лежит в базе у токена.
 *
 * Сессионный токен из Ads Manager публичный API принимает только вместе с
 * куками, user-agent и прокси того же аккаунта. Всё это приезжает в
 * мультитокене (`{cookies, ua, token}`), который и хранится в поле `token`;
 * отдельная колонка `cookiesJson` — запасной источник кук, если их сохранили
 * туда. Здесь оба случая сводятся к одному: строка токена и сеть к ней.
 */
export function fbAccess(rawToken: string, opts: { cookiesJson?: string | null; proxyUrl?: string | null } = {}): {
  token: string;
  net: FbNet;
} {
  const { token, ua } = extractFbToken(rawToken);

  // Куки: сначала из отдельной колонки, иначе — из самого мультитокена.
  let cookies: unknown[] | undefined;
  const fromColumn = opts.cookiesJson?.trim();
  try {
    if (fromColumn) cookies = readCookieBlob(fromColumn).cookies;
    else cookies = readCookieBlob(rawToken).cookies;
  } catch {
    cookies = undefined;
  }
  const cookie = cookies && cookies.length
    ? cookieHeaderOf(cookies as { name?: unknown; value?: unknown }[])
    : undefined;

  return { token, net: { ua, proxyUrl: opts.proxyUrl ?? null, cookie: cookie || null } };
}

export type FbCampaignRow = {
  campaignId: string;
  name: string;
  /** effective_status: реальное состояние с учётом модерации и статуса кабинета. */
  status: string;
  /** Дневной бюджет в минимальных единицах валюты кабинета (может отсутствовать
   *  — тогда бюджет на уровне адсета). */
  dailyBudget: number | null;
};

/**
 * Кампании кабинета: что вообще заведено и в каком состоянии. Берём
 * effective_status — он честнее status, потому что учитывает модерацию и статус
 * самого кабинета (в PAUSED-кабинете все кампании фактически стоят).
 *
 * Постранично и с потолком: у активного кабинета кампаний бывают сотни, а
 * вешать синхронизацию на одном кабинете нельзя.
 */
export async function listCampaigns(token: string, externalId: string, net: FbNet = {}) {
  const out: FbCampaignRow[] = [];
  let after = '';
  for (let page = 0; page < 20; page += 1) {
    const body = await call(`/${externalId}/campaigns`, token, {
      fields: 'name,effective_status,daily_budget',
      limit: '200',
      ...(after ? { after } : {}),
    }, net);
    const data = (body.data ?? []) as {
      id?: string;
      name?: string;
      effective_status?: string;
      daily_budget?: string;
    }[];
    for (const row of data) {
      if (!row.id) continue;
      const budget = row.daily_budget != null ? Math.round(Number(row.daily_budget)) : null;
      out.push({
        campaignId: row.id,
        name: row.name ?? '',
        status: row.effective_status ?? 'UNKNOWN',
        dailyBudget: Number.isFinite(budget as number) ? budget : null,
      });
    }
    const next = body.paging as { cursors?: { after?: string }; next?: string } | undefined;
    if (!next?.next || !next.cursors?.after) break;
    after = next.cursors.after;
  }
  return out;
}

/** Дневные метрики по одному объявлению. */
export type FbAdStatRow = {
  adId: string;
  adName: string;
  /** YYYY-MM-DD, как отдаёт Facebook (в поясе кабинета). */
  date: string;
  /** Расход в минимальных единицах валюты кабинета. */
  cents: number;
  /** Клики по ссылке (inline_link_clicks) и показы — для CTR/CPC. */
  clicks: number;
  impressions: number;
  /** Результаты/лиды из FB (сумма конверсионных actions). */
  leads: number;
};

/**
 * Типы actions, которые считаем «результатом/лидом». Facebook отдаёт действия
 * массивом по типам; единого поля «результат» в API нет — оно зависит от цели
 * оптимизации адсета. Суммируем конверсионные типы: для натры это лид/регистрация,
 * для товарки — покупка/подписка. Расхождение с Ads Manager возможно, но порядок
 * тот же.
 */
const LEAD_ACTIONS = /(^|\.)(lead|complete_registration|purchase|subscribe|start_trial|submit_application)$|lead_grouped/i;

function leadsFromActions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  let total = 0;
  for (const a of actions as { action_type?: string; value?: string }[]) {
    if (a.action_type && LEAD_ACTIONS.test(a.action_type)) {
      total += Math.round(Number(a.value ?? 0)) || 0;
    }
  }
  return total;
}

/**
 * Дневные метрики по ОБЪЯВЛЕНИЯМ кабинета за отрезок.
 *
 * `level=ad` раскладывает всё по каждому объявлению — расход можно приписать
 * потоку в Keitaro (токен в ссылке), а показы/клики/лиды показать в таблице.
 * Пустые (без показов и расхода) объявления Facebook в отчёт не включает,
 * поэтому набор сразу узкий — только то, что реально крутилось.
 */
export async function adStats(
  token: string,
  externalId: string,
  from: string,
  to: string,
  net: FbNet = {},
) {
  const out: FbAdStatRow[] = [];
  let after = '';
  for (let page = 0; page < 40; page += 1) {
    const body = await call(`/${externalId}/insights`, token, {
      fields: 'spend,ad_id,ad_name,impressions,inline_link_clicks,actions',
      level: 'ad',
      time_increment: '1',
      time_range: JSON.stringify({ since: from, until: to }),
      limit: '500',
      ...(after ? { after } : {}),
    }, net);

    const rows = (body.data ?? []) as {
      date_start?: string;
      ad_id?: string;
      ad_name?: string;
      spend?: string;
      impressions?: string;
      inline_link_clicks?: string;
      actions?: unknown;
    }[];
    for (const row of rows) {
      if (!row.date_start || !row.ad_id) continue;
      const cents = Math.round(Number(row.spend ?? 0) * 100);
      const impressions = Math.round(Number(row.impressions ?? 0)) || 0;
      // Пропускаем строки без активности вовсе (ни показа, ни расхода).
      if ((!Number.isFinite(cents) || cents <= 0) && impressions <= 0) continue;
      out.push({
        adId: row.ad_id,
        adName: row.ad_name ?? '',
        date: row.date_start,
        cents: Number.isFinite(cents) ? cents : 0,
        clicks: Math.round(Number(row.inline_link_clicks ?? 0)) || 0,
        impressions,
        leads: leadsFromActions(row.actions),
      });
    }
    const next = body.paging as { cursors?: { after?: string }; next?: string } | undefined;
    if (!next?.next || !next.cursors?.after) break;
    after = next.cursors.after;
  }
  return out;
}

/**
 * Все id объявлений кабинета (кроме архивных/удалённых) — чтобы в таблице можно
 * было показать и те, что сейчас без открута (свежие дубли на паузе и т.п.).
 * `adStats` их не отдаёт (там только с активностью), поэтому берём отдельно.
 */
export async function listAdIds(token: string, externalId: string, net: FbNet = {}) {
  // Только валидные для ОБЪЯВЛЕНИЯ статусы (без архив/удалённых — их много и в
  // таблице не нужны). Один неверный статус в списке → FB отклоняет весь запрос,
  // поэтому список держим строго из допустимых значений.
  const LIVE = [
    'ACTIVE', 'PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED',
    'PENDING_BILLING_INFO', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES',
  ];
  const fetchPage = (after: string, withFilter: boolean) =>
    call(`/${externalId}/ads`, token, {
      fields: 'id',
      ...(withFilter ? { effective_status: JSON.stringify(LIVE) } : {}),
      limit: '500',
      ...(after ? { after } : {}),
    }, net);

  const run = async (withFilter: boolean) => {
    const out: string[] = [];
    let after = '';
    for (let page = 0; page < 10; page += 1) {
      const body = await fetchPage(after, withFilter);
      for (const row of (body.data ?? []) as { id?: string }[]) if (row.id) out.push(row.id);
      const next = body.paging as { cursors?: { after?: string }; next?: string } | undefined;
      if (!next?.next || !next.cursors?.after) break;
      after = next.cursors.after;
    }
    return out;
  };

  try {
    return await run(true);
  } catch {
    // Если фильтр статусов не зашёл — берём без него (потом отфильтруем архив
    // по effective_status из меты выше по стеку не нужно; тут просто вернём id).
    return await run(false);
  }
}

export type FbAdMeta = {
  adId: string;
  name: string;
  status: string;
  /** Целевая ссылка креатива (destination URL) — в ней и стоит токен КТ. */
  link: string;
  adsetId: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  /** Дневной бюджет в центах — с того уровня, где он задан (адсет или кампания). */
  dailyBudget: number | null;
  /** ID объекта, которому слать смену бюджета: адсет (обычно) или кампания (CBO). */
  budgetTargetId: string;
  /** Короткая подпись таргета: «40-65 HU». */
  targeting: string;
  thumbnailUrl: string;
};

/**
 * Мета объявлений по списку id: статус, ссылка, адсет и кампания с бюджетом,
 * таргет, превью. Тянем ТОЛЬКО по id с активностью (их даёт adStats).
 * Facebook отдаёт до полусотни объектов за раз по `?ids=`, поэтому бьём на пачки.
 *
 * Бюджет бывает на адсете либо на кампании (CBO). Берём тот, что реально задан,
 * и запоминаем id этого объекта — чтобы менять бюджет там же, где он живёт.
 */
export async function adMeta(token: string, ids: string[], net: FbNet = {}) {
  const out: FbAdMeta[] = [];
  const fields =
    'name,effective_status,adset{id,name,daily_budget,lifetime_budget,targeting{age_min,age_max,geo_locations{countries}}},campaign{id,name,daily_budget,lifetime_budget},creative{thumbnail_url,link_url,object_url,object_story_spec{link_data{link},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}}}';

  const cents = (v: unknown) => {
    const n = v != null ? Math.round(Number(v)) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const body = await call('', token, { ids: chunk.join(','), fields }, net);
    for (const [adId, raw] of Object.entries(body as Record<string, unknown>)) {
      const ad = raw as {
        name?: string;
        effective_status?: string;
        creative?: { thumbnail_url?: string };
        adset?: {
          id?: string;
          name?: string;
          daily_budget?: string;
          lifetime_budget?: string;
          targeting?: {
            age_min?: number;
            age_max?: number;
            geo_locations?: { countries?: string[] };
          };
        };
        campaign?: { id?: string; name?: string; daily_budget?: string; lifetime_budget?: string };
      };
      const adsetDaily = cents(ad.adset?.daily_budget);
      const campDaily = cents(ad.campaign?.daily_budget);
      const adsetLife = cents(ad.adset?.lifetime_budget);
      const campLife = cents(ad.campaign?.lifetime_budget);
      // Показываем тот бюджет, что реально задан; дневной приоритетнее «на срок».
      const dailyBudget = adsetDaily ?? campDaily ?? adsetLife ?? campLife;
      // Менять шлём туда, где бюджет живёт (дневной приоритетнее для правки).
      const budgetTargetId =
        adsetDaily != null ? ad.adset?.id ?? ''
        : campDaily != null ? ad.campaign?.id ?? ''
        : adsetLife != null ? ad.adset?.id ?? ''
        : campLife != null ? ad.campaign?.id ?? ''
        : ad.adset?.id ?? ad.campaign?.id ?? '';
      out.push({
        adId,
        name: ad.name ?? '',
        status: ad.effective_status ?? 'UNKNOWN',
        link: pickCreativeLink((raw as { creative?: unknown }).creative),
        adsetId: ad.adset?.id ?? '',
        adsetName: ad.adset?.name ?? '',
        campaignId: ad.campaign?.id ?? '',
        campaignName: ad.campaign?.name ?? '',
        dailyBudget: Number.isFinite(dailyBudget as number) ? dailyBudget : null,
        budgetTargetId,
        targeting: targetingLabel(ad.adset?.targeting),
        thumbnailUrl: ad.creative?.thumbnail_url ?? '',
      });
    }
  }
  return out;
}

/** «40-65 HU» из таргета адсета. Пусто, если ничего не задано. */
function targetingLabel(t?: {
  age_min?: number;
  age_max?: number;
  geo_locations?: { countries?: string[] };
}): string {
  if (!t) return '';
  const age = t.age_min && t.age_max ? `${t.age_min}-${t.age_max}` : '';
  const geo = (t.geo_locations?.countries ?? []).slice(0, 3).join(', ');
  return [age, geo].filter(Boolean).join(' ');
}

/** Первая целевая ссылка из креатива — по всем местам, где она бывает. */
function pickCreativeLink(creative: unknown): string {
  const c = (creative ?? {}) as Record<string, unknown>;
  const spec = (c.object_story_spec ?? {}) as Record<string, unknown>;

  const linkData = (spec.link_data ?? {}) as { link?: unknown };
  const videoData = (spec.video_data ?? {}) as {
    call_to_action?: { value?: { link?: unknown } };
  };
  const templateData = (spec.template_data ?? {}) as { link?: unknown };
  const feed = (c.asset_feed_spec ?? {}) as { link_urls?: { website_url?: unknown }[] };

  const candidates = [
    linkData.link,
    videoData.call_to_action?.value?.link,
    templateData.link,
    feed.link_urls?.[0]?.website_url,
    c.link_url,
    c.object_url,
  ];
  for (const v of candidates) {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) return s;
  }
  return '';
}

/**
 * Пауза/запуск объявления. FB принимает status ACTIVE|PAUSED на самом объекте
 * объявления. Возвращает true, если Facebook подтвердил успех.
 */
export async function setAdStatus(token: string, adId: string, status: 'ACTIVE' | 'PAUSED', net: FbNet = {}) {
  const body = await call(`/${adId}`, token, { status }, net, 'POST');
  return Boolean((body as { success?: boolean }).success ?? true);
}

/**
 * Сменить дневной бюджет адсета. `cents` — в минимальных единицах валюты
 * кабинета (как отдаёт Facebook). Меняется на уровне адсета, а не объявления.
 */
export async function setAdsetBudget(token: string, adsetId: string, cents: number, net: FbNet = {}) {
  const body = await call(`/${adsetId}`, token, { daily_budget: String(Math.round(cents)) }, net, 'POST');
  return Boolean((body as { success?: boolean }).success ?? true);
}

/**
 * Дублировать объявление в том же адсете (ручка `/{ad_id}/copies`). Копия
 * создаётся НА ПАУЗЕ, чтобы не начать лить до проверки. Возвращает id копии.
 */
export async function duplicateAd(token: string, adId: string, net: FbNet = {}) {
  const body = await call(`/${adId}/copies`, token, { status_option: 'PAUSED' }, net, 'POST');
  return String((body as { copied_ad_id?: string; id?: string }).copied_ad_id ?? (body as { id?: string }).id ?? '');
}

/** id кампании объявления — нужен, чтобы дублировать всю кампанию целиком. */
export async function adCampaignId(token: string, adId: string, net: FbNet = {}) {
  const body = await call(`/${adId}`, token, { fields: 'campaign{id}' }, net);
  return String((body as { campaign?: { id?: string } }).campaign?.id ?? '');
}

/** Все id из страничной выборки graph (data[].id) с пагинацией. */
async function listIds(path: string, token: string, net: FbNet, pages = 10): Promise<string[]> {
  const out: string[] = [];
  let after = '';
  for (let p = 0; p < pages; p += 1) {
    const body = await call(path, token, { fields: 'id', limit: '500', ...(after ? { after } : {}) }, net);
    for (const r of (body.data ?? []) as { id?: string }[]) if (r.id) out.push(r.id);
    const next = body.paging as { cursors?: { after?: string }; next?: string } | undefined;
    if (!next?.next || !next.cursors?.after) break;
    after = next.cursors.after;
  }
  return out;
}

/** Небольшая пауза между копиями — чтобы не словить троттлинг на серии /copies. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Дублировать кампанию со всей структурой — НА ПАУЗЕ.
 *
 * Facebook не даёт скопировать за один синхронный вызов ≥3 объектов
 * (кампания+адсеты+объявления) — поэтому глубокая копия кампании падает с кодом
 * 100/1885194 и требует async-пакетов. Обходим без async: собираем копию по
 * одному объекту (это ниже лимита и работает синхронно) —
 *   1) копируем кампанию-оболочку (без структуры);
 *   2) каждый адсет по одному в новую кампанию;
 *   3) каждое объявление по одному в свой новый адсет.
 *
 * Возвращаем id новой кампании и счётчики (сколько адсетов/объявлений скопировано).
 */
export async function duplicateCampaign(token: string, campaignId: string, net: FbNet = {}) {
  // 1. Структура исходной кампании: адсеты и объявления каждого.
  const adsetIds = await listIds(`/${campaignId}/adsets`, token, net);
  const adsByAdset: { adsetId: string; adIds: string[] }[] = [];
  let totalAds = 0;
  for (const adsetId of adsetIds) {
    const adIds = await listIds(`/${adsetId}/ads`, token, net);
    adsByAdset.push({ adsetId, adIds });
    totalAds += adIds.length;
  }
  // Предохранитель: очень большую кампанию по одному копировать долго — не виснем.
  if (adsetIds.length + totalAds > 120) {
    throw new FbError('Слишком большая кампания для копии по частям (>120 объектов). Скопируй вручную в Ads Manager.');
  }

  // 2. Кампания-оболочка (1 объект — под лимитом).
  const campBody = await call(`/${campaignId}/copies`, token, { deep_copy: 'false', status_option: 'PAUSED' }, net, 'POST');
  const newCampId = String((campBody as { copied_campaign_id?: string; id?: string }).copied_campaign_id ?? (campBody as { id?: string }).id ?? '');
  if (!newCampId) throw new FbError('Facebook не вернул id копии кампании');

  // 3. Адсеты по одному в новую кампанию, затем объявления по одному в новый адсет.
  let copiedAdsets = 0, copiedAds = 0;
  for (const { adsetId, adIds } of adsByAdset) {
    await sleep(400);
    const asBody = await call(`/${adsetId}/copies`, token, { campaign_id: newCampId, deep_copy: 'false', status_option: 'PAUSED' }, net, 'POST');
    const newAdsetId = String((asBody as { copied_adset_id?: string; id?: string }).copied_adset_id ?? (asBody as { id?: string }).id ?? '');
    if (!newAdsetId) continue;
    copiedAdsets += 1;
    for (const adId of adIds) {
      await sleep(400);
      await call(`/${adId}/copies`, token, { adset_id: newAdsetId, status_option: 'PAUSED' }, net, 'POST');
      copiedAds += 1;
    }
  }
  return { newCampId, copiedAdsets, copiedAds };
}

/** Переименовать объявление. */
export async function renameAd(token: string, adId: string, name: string, net: FbNet = {}) {
  await call(`/${adId}`, token, { name }, net, 'POST');
  return true;
}

/** Тексты креатива объявления: основной текст, заголовок, описание. */
export type AdText = { message: string; headline: string; description: string };

/** Прочитать тексты креатива (для префилла формы смены текста). Поддержаны
 *  обычный (link_data), видео (video_data) и динамический (asset_feed_spec). */
export async function getAdCreative(token: string, adId: string, net: FbNet = {}): Promise<AdText> {
  const got = await call(`/${adId}`, token, { fields: 'creative{object_story_spec,asset_feed_spec}' }, net);
  const c = ((got as { creative?: unknown }).creative ?? {}) as {
    object_story_spec?: {
      link_data?: { message?: string; name?: string; description?: string };
      video_data?: { message?: string; title?: string; link_description?: string };
    };
    asset_feed_spec?: {
      bodies?: { text?: string }[];
      titles?: { text?: string }[];
      descriptions?: { text?: string }[];
    };
  };
  const spec = c.object_story_spec ?? {};
  const feed = c.asset_feed_spec;
  if (spec.link_data) return { message: spec.link_data.message ?? '', headline: spec.link_data.name ?? '', description: spec.link_data.description ?? '' };
  if (spec.video_data) return { message: spec.video_data.message ?? '', headline: spec.video_data.title ?? '', description: spec.video_data.link_description ?? '' };
  if (feed) return { message: feed.bodies?.[0]?.text ?? '', headline: feed.titles?.[0]?.text ?? '', description: feed.descriptions?.[0]?.text ?? '' };
  return { message: '', headline: '', description: '' };
}

/** Что делаем с текстом: перемодерка (переключить точку в конце) или задать
 *  новые значения полей. */
export type AdTextEdit =
  | { mode: 'period' }
  | { mode: 'text'; message?: string; headline?: string; description?: string };

/**
 * Изменить тексты объявления. Креатив в FB неизменяем, поэтому читаем текущий
 * спек, правим тексты, создаём НОВЫЙ креатив и назначаем его объявлению. Любое
 * такое изменение FB автоматически отправляет на ре-модерацию — на этом и
 * построена «перемодерка через точку».
 */
export async function applyAdText(token: string, accountExternalId: string, adId: string, edit: AdTextEdit, net: FbNet = {}) {
  const got = await call(`/${adId}`, token, { fields: 'creative{object_story_spec,asset_feed_spec}' }, net);
  const creative = ((got as { creative?: unknown }).creative ?? {}) as Record<string, unknown>;
  const spec = creative.object_story_spec ? structuredClone(creative.object_story_spec) as Record<string, unknown> : null;
  const feed = creative.asset_feed_spec ? structuredClone(creative.asset_feed_spec) as Record<string, unknown> : null;
  if (!spec && !feed) throw new FbError('У объявления нестандартный креатив — текст так не поменять.');

  // Точка: убрать, если есть на конце, иначе добавить (минимальная правка →
  // ре-модерация). Для режима text — подставить заданное, иначе оставить как есть.
  const toggle = (s = '') => {
    const t = s.replace(/\s+$/, '');
    return /\.+$/.test(t) ? t.replace(/\.+$/, '') : `${t}.`;
  };
  const pick = (cur = '', key: 'message' | 'headline' | 'description') =>
    edit.mode === 'period' ? toggle(cur) : ((edit as Record<string, string | undefined>)[key] ?? cur);

  const linkData = spec?.link_data as { message?: string; name?: string; description?: string } | undefined;
  const videoData = spec?.video_data as { message?: string; title?: string; link_description?: string } | undefined;
  if (linkData) {
    linkData.message = pick(linkData.message, 'message');
    linkData.name = pick(linkData.name, 'headline');
    if (linkData.description != null || (edit.mode === 'text' && edit.description != null)) linkData.description = pick(linkData.description, 'description');
  } else if (videoData) {
    videoData.message = pick(videoData.message, 'message');
    videoData.title = pick(videoData.title, 'headline');
    if (videoData.link_description != null || (edit.mode === 'text' && edit.description != null)) videoData.link_description = pick(videoData.link_description, 'description');
  }
  if (feed) {
    const bodies = feed.bodies as { text?: string }[] | undefined;
    const titles = feed.titles as { text?: string }[] | undefined;
    const descriptions = feed.descriptions as { text?: string }[] | undefined;
    if (bodies?.[0]) bodies[0].text = pick(bodies[0].text, 'message');
    if (titles?.[0]) titles[0].text = pick(titles[0].text, 'headline');
    if (descriptions?.[0]) descriptions[0].text = pick(descriptions[0].text, 'description');
  }

  const params: Record<string, string> = {};
  if (spec) params.object_story_spec = JSON.stringify(spec);
  if (feed) params.asset_feed_spec = JSON.stringify(feed);
  const acct = accountExternalId.replace(/^act_/, '');
  const created = await call(`/act_${acct}/adcreatives`, token, params, net, 'POST');
  const newId = String((created as { id?: string }).id ?? '');
  if (!newId) throw new FbError('Facebook не создал новый креатив');
  await call(`/${adId}`, token, { creative: JSON.stringify({ creative_id: newId }) }, net, 'POST');
  return newId;
}

/**
 * Дублировать адсет со всеми объявлениями — НА ПАУЗЕ. Если объявлений ≥2, разом
 * копировать нельзя (лимит FB <3 объектов), поэтому копируем адсет-оболочку и
 * объявления по одному. При ≤1 объявлении хватает одной глубокой копии.
 */
export async function duplicateAdset(token: string, adsetId: string, net: FbNet = {}) {
  const adIds = await listIds(`/${adsetId}/ads`, token, net);
  if (adIds.length <= 1) {
    const b = await call(`/${adsetId}/copies`, token, { deep_copy: 'true', status_option: 'PAUSED' }, net, 'POST');
    return String((b as { copied_adset_id?: string; id?: string }).copied_adset_id ?? (b as { id?: string }).id ?? '');
  }
  const asB = await call(`/${adsetId}/copies`, token, { deep_copy: 'false', status_option: 'PAUSED' }, net, 'POST');
  const newAdsetId = String((asB as { copied_adset_id?: string; id?: string }).copied_adset_id ?? (asB as { id?: string }).id ?? '');
  if (!newAdsetId) throw new FbError('Facebook не вернул id копии адсета');
  for (const adId of adIds) {
    await sleep(400);
    await call(`/${adId}/copies`, token, { adset_id: newAdsetId, status_option: 'PAUSED' }, net, 'POST');
  }
  return newAdsetId;
}

/**
 * Дубль объявления 1:1 в НОВЫЙ адсет с РУЧНОЙ ставкой за результат (cost cap).
 *
 * Ставка в Facebook живёт на адсете, а не на объявлении, поэтому: копируем
 * адсет-оболочку исходного объявления (без объявлений), ставим на копию ручную
 * ставку (bid_strategy=COST_CAP + bid_amount в центах), затем переносим в неё
 * копию этого объявления. Всё на паузе — баер проверит и включит. bidCents — в
 * минорных единицах валюты кабинета (напр. $3.50 → 350).
 */
export async function duplicateAdWithBid(token: string, adId: string, bidCents: number, net: FbNet = {}): Promise<string> {
  const info = await call(`/${adId}`, token, { fields: 'adset_id' }, net) as { adset_id?: string };
  const adsetId = String(info.adset_id ?? '');
  if (!adsetId) throw new FbError('Не нашёл адсет объявления для дубля со ставкой');

  // Копия адсета-оболочки (без объявлений), на паузе.
  const asB = await call(`/${adsetId}/copies`, token, { deep_copy: 'false', status_option: 'PAUSED' }, net, 'POST');
  const newAdsetId = String((asB as { copied_adset_id?: string; id?: string }).copied_adset_id ?? (asB as { id?: string }).id ?? '');
  if (!newAdsetId) throw new FbError('Facebook не вернул id копии адсета');

  // Ручная ставка за результат на новом адсете. Если кабинет/кампания не дают
  // сменить стратегию (напр. бюджет на кампании — CBO), FB вернёт понятную
  // ошибку — пробрасываем её наверх, копию-адсет оставляем на паузе.
  await call(`/${newAdsetId}`, token, { bid_strategy: 'COST_CAP', bid_amount: String(Math.round(bidCents)) }, net, 'POST');

  // Переносим копию этого объявления в новый адсет.
  await sleep(400);
  await call(`/${adId}/copies`, token, { adset_id: newAdsetId, status_option: 'PAUSED' }, net, 'POST');
  return newAdsetId;
}

/** Справка по кампании — имя, цель и спец-категории. Нужна, чтобы объяснить,
 *  почему копия могла не пройти (спец-категорию FB копировать не даёт). */
export async function campaignInfo(token: string, campaignId: string, net: FbNet = {}) {
  const body = await call(
    `/${campaignId}`,
    token,
    { fields: 'name,objective,special_ad_categories' },
    net,
  );
  const b = body as { name?: string; objective?: string; special_ad_categories?: unknown };
  const cats = Array.isArray(b.special_ad_categories)
    ? (b.special_ad_categories as unknown[]).map(String).filter((c) => c && c !== 'NONE')
    : [];
  return { name: b.name ?? '', objective: b.objective ?? '', specialAdCategories: cats };
}

export async function checkToken(
  raw: string,
  opts: { proxyUrl?: string | null; cookie?: string | null } = {},
) {
  const { token, ua } = extractFbToken(raw);
  const net: FbNet = { ua, proxyUrl: opts.proxyUrl, cookie: opts.cookie };

  // /me падает — проблема в самом токене (не тот, протух, обрезан). Помечаем
  // шаг, чтобы отличать это от «токен рабочий, но нет доступа к кабинетам».
  let me: Record<string, unknown>;
  try {
    me = await call('/me', token, { fields: 'id,name' }, net);
  } catch (e) {
    if (e instanceof FbError) {
      throw new FbError(`${e.message} (шаг: проверка токена)`);
    }
    throw e;
  }

  let accounts: FbAccount[];
  try {
    accounts = await listAccounts(token, net);
  } catch (e) {
    if (e instanceof FbError) {
      throw new FbError(`${e.message} (шаг: список кабинетов — токен рабочий, но кабинеты не отдал)`);
    }
    throw e;
  }

  return {
    name: (me.name as string) || (me.id as string) || 'без имени',
    accounts,
  };
}

// ============================================================================
// АВТОЗАЛИВ — create-примитивы. Всё создаётся под конкретный кабинет
// (externalId уже с префиксом act_). Токен сессионный, поэтому net
// (ua/cookie/proxy) обязателен — как и в чтении. Всё создаём по умолчанию на
// ПАУЗЕ: реальный запуск отдельным действием.
// ВНИМАНИЕ: форматы параметров ФБ капризны — обкатываем на живом кабинете.
// ============================================================================

/** Пиксели кабинета — выбрать существующий при заливе ({pixel}). */
export async function listPixels(token: string, externalId: string, net: FbNet = {}) {
  const body = await call(`/${externalId}/adspixels`, token, { fields: 'id,name', limit: '100' }, net);
  const data = (body.data ?? []) as { id?: string; name?: string }[];
  return data.filter((p) => p.id).map((p) => ({ id: p.id as string, name: p.name || (p.id as string) }));
}

/** Создать новый пиксель в кабинете. Возвращает id. */
export async function createPixel(token: string, externalId: string, name: string, net: FbNet = {}) {
  const body = await call(`/${externalId}/adspixels`, token, { name }, net, 'POST');
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Пиксель не создан: FB не вернул id');
  return id;
}

/**
 * Страницы (ФП), от имени которых публикуется реклама.
 *  • is_published — опубликована ли (неопубликованные нельзя рекламировать);
 *  • promotion_eligible / promotion_ineligible_reason — можно ли ВООБЩЕ
 *    рекламировать эту ФП (забаненную/ограниченную FB не даёт выбрать в
 *    Ads Manager — ловим это тем же полем).
 */
export async function listPages(token: string, net: FbNet = {}) {
  // Расширенные поля (promotion_eligible и пр.) часть токенов читать не даёт и
  // роняет весь запрос — тогда откатываемся на базовые, чтобы список ФП всё
  // равно подтянулся (просто без пометки «нельзя рекламировать»).
  let body: Record<string, unknown>;
  try {
    body = await call(
      '/me/accounts',
      token,
      { fields: 'id,name,is_published,promotion_eligible,promotion_ineligible_reason', limit: '200' },
      net,
    );
  } catch {
    body = await call('/me/accounts', token, { fields: 'id,name,is_published', limit: '200' }, net);
  }
  const data = (body.data ?? []) as {
    id?: string; name?: string; is_published?: boolean;
    promotion_eligible?: boolean; promotion_ineligible_reason?: string;
  }[];
  return data
    .filter((p) => p.id)
    .map((p) => ({
      id: p.id as string,
      name: p.name || (p.id as string),
      isPublished: p.is_published !== false,
      // FB отдаёт признак не всегда; трактуем только явный false как «нельзя».
      promotionEligible: p.promotion_eligible !== false,
      ineligibleReason: p.promotion_ineligible_reason || '',
    }));
}

/**
 * Страницы, которые РАЗРЕШЕНО продвигать с ЭТОГО кабинета. Часть арендных
 * кабинетов привязана к одной конкретной ФП: реклама с чужой страницы отбивается
 * кодом 100/1815645 «The Page or app this ad is promoting doesn't match the one
 * specified during ad account creation». Тогда берём ФП отсюда.
 * externalId — с префиксом act_. Пустой массив = ограничения нет/не отдал.
 */
export async function listPromotePages(token: string, externalId: string, net: FbNet = {}) {
  try {
    const body = await call(`/${externalId}/promote_pages`, token, { fields: 'id,name', limit: '200' }, net);
    const data = (body.data ?? []) as { id?: string; name?: string }[];
    return data.filter((p) => p.id).map((p) => ({ id: p.id as string, name: p.name || (p.id as string) }));
  } catch {
    return [] as { id: string; name: string }[];
  }
}

/**
 * Создать новую страницу (ФП). Мета ограничила создание страниц через Graph
 * API: официального «create page» нет, но легаси-ручка `POST /me/accounts` на
 * полноценном пользовательском токене (в т.ч. сессионном из антидетекта) часто
 * ещё работает. На системном/урезанном токене Facebook откажет — тогда отдаём
 * его текст как есть. Категория обязательна для части кабинетов; по умолчанию
 * «страница-блог».
 */
export async function createPage(token: string, name: string, category: string, net: FbNet = {}) {
  const params: Record<string, string> = { name };
  if (category) params.category = category;
  const body = await call('/me/accounts', token, params, net, 'POST');
  const id = (body.id as string | undefined) ?? ((body as { page_id?: string }).page_id);
  if (!id) throw new FbError('Страница не создана: Facebook не вернул id. Создание ФП через API Мета ограничивает — заведи страницу вручную и обнови список.');
  return id;
}

export type CreateCampaignInput = {
  name: string;
  /** Конверсии = OUTCOME_SALES (современная цель). */
  objective?: string;
  status?: 'PAUSED' | 'ACTIVE';
  specialCategories?: string[];
  /** Бюджет на кампании (CBO/Advantage campaign budget), в центах. Если задан —
   *  бюджет делится между адсетами кампании, а на адсетах его НЕ ставим. Нужен
   *  для мульти-язычного залива: один ролик = один адсет, но бюджет общий. */
  dailyBudgetCents?: number;
  bidStrategy?: string; // LOWEST_COST_WITHOUT_CAP
};

export async function createCampaign(token: string, externalId: string, i: CreateCampaignInput, net: FbNet = {}) {
  const params: Record<string, string> = {
    name: i.name,
    objective: i.objective || 'OUTCOME_SALES',
    status: i.status || 'PAUSED',
    special_ad_categories: JSON.stringify(i.specialCategories ?? []),
  };
  // CBO: бюджет и стратегия ставок задаются на уровне кампании.
  if (i.dailyBudgetCents) {
    params.daily_budget = String(i.dailyBudgetCents);
    params.bid_strategy = i.bidStrategy || 'LOWEST_COST_WITHOUT_CAP';
  }
  const body = await call(`/${externalId}/campaigns`, token, params, net, 'POST', CREATE_API_VERSION);
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Кампания не создана: нет id');
  return id;
}

// ── Привязка карты к рекламному кабинету ───────────────────────────────────
// Публичного API для добавления способа оплаты у Меты нет. Это делается через
// приватный внутренний поток (iOS-приложение / браузерная форма / cookie).
// Точный запрос берём из захвата (код расширения или HAR) — до этого функция
// НАМЕРЕННО не отправляет карту в FB.

export type CardInput = {
  number: string; // PAN без пробелов
  month: string;  // MM
  year: string;   // YY или YYYY
  cvc: string;
  zip?: string;
};

/** Способ привязки (как в FBTOOL): iOS-API, повтор Ads Manager, через cookie. */
export type CardBindMethod = 'ios' | 'ads_manager' | 'cookie';

export type CardBindOptions = {
  method: CardBindMethod;
  billingCountry?: string; // ISO-2
  currency?: string;
  timezoneId?: number;
  rebind?: boolean;
};

export type CardBindResult = { ok: boolean; status: string };

/**
 * Автопривязка карты к кабинету НЕ реализована сознательно: она требует слать
 * полный номер карты + CVC на приватный платёжный эндпоинт FB под сессионными
 * куками и массово повторять это — паттерн, неотличимый от платёжного абьюза,
 * нарушающий правила FB и обращения с картами. Карты добавляй вручную в Ads
 * Manager или сторонним расширением; здесь можем только вести учёт (какая карта
 * на каком кабинете), не касаясь номеров.
 */
export async function bindCardToAccount(
  _token: string,
  _externalId: string,
  _card: CardInput,
  _opts: CardBindOptions,
  _net: FbNet = {},
): Promise<CardBindResult> {
  throw new FbError('Автопривязка карты не реализована — добавляй карту вручную в Ads Manager. Здесь можно вести учёт карт по кабинетам (без номеров).');
}

/** Имя страницы по её id (для DSA-бенефициара). Ошибка/пусто — ''. */
export async function getPageName(token: string, pageId: string, net: FbNet = {}): Promise<string> {
  try {
    const body = await call(`/${pageId}`, token, { fields: 'name' }, net);
    return String((body as { name?: unknown }).name ?? '');
  } catch {
    return '';
  }
}

/**
 * Instagram-идентичность для объявления. Если реклама попадает в плейсменты
 * Instagram, а к ФП не привязан IG-аккаунт, ФБ отбивает креатив (код 100/1772103
 * «Select an Instagram account or Facebook Page…»). Решаем как в Ads Manager
 * «использовать страницу Facebook в Instagram»:
 *  1) берём привязанный к ФП IG (business/connected), если есть;
 *  2) иначе — уже созданный page-backed IG (PBIA);
 *  3) иначе — создаём PBIA (страница представляет бизнес в Instagram).
 * Пусто — не удалось (тогда IG-плейсменты могут отвалиться).
 */
export async function resolveInstagramActor(token: string, pageId: string, net: FbNet = {}): Promise<{ id: string; error?: string }> {
  try {
    const b = await call(`/${pageId}`, token, { fields: 'instagram_business_account,connected_instagram_account' }, net) as {
      instagram_business_account?: { id?: string };
      connected_instagram_account?: { id?: string };
    };
    const id = b.instagram_business_account?.id || b.connected_instagram_account?.id;
    if (id) return { id: String(id) };
  } catch { /* нет доступа/поля — идём дальше */ }

  // Операции с page-backed IG (список/создание) ФБ обычно разрешает с ТОКЕНОМ
  // СТРАНИЦЫ. Берём его; если не дали — пробуем пользовательским.
  let pageToken = token;
  try {
    const pt = await call(`/${pageId}`, token, { fields: 'access_token' }, net) as { access_token?: string };
    if (pt.access_token) pageToken = String(pt.access_token);
  } catch { /* нет прав на токен страницы — пробуем пользовательским */ }

  // Сначала уже существующий PBIA (обоими токенами — что сработает).
  for (const tk of pageToken === token ? [token] : [pageToken, token]) {
    try {
      const l = await call(`/${pageId}/page_backed_instagram_accounts`, tk, { fields: 'id' }, net) as { data?: { id?: string }[] };
      const id = (l.data ?? [])[0]?.id;
      if (id) return { id: String(id) };
    } catch { /* пробуем следующий токен / создание */ }
  }
  // Создание PBIA — пробуем обоими токенами, на актуальной версии создания.
  // Реальную причину сбоя возвращаем наружу (в журнал), чтобы было видно, что
  // именно не даёт создать IG-идентичность (права, версия, статус страницы).
  let lastErr = '';
  for (const tk of pageToken === token ? [token] : [pageToken, token]) {
    try {
      const c = await call(`/${pageId}/page_backed_instagram_accounts`, tk, {}, net, 'POST', CREATE_API_VERSION) as { id?: string };
      if (c.id) return { id: String(c.id) };
    } catch (e) { lastErr = (e as Error).message; }
  }
  return { id: '', error: lastErr };
}

/** Регион FB для исключения: ключ + человекочитаемое имя со страной. */
export type FbRegion = { key: string; name: string; cc: string };

/**
 * Поиск регионов (областей/штатов) у Facebook по названию. Регионы FB принимает
 * только по внутреннему ключу (region key), не по имени — поэтому сперва ищем.
 * Отдаём до 20 совпадений: ключ + имя + код страны для показа.
 */
export async function searchRegions(token: string, q: string, net: FbNet = {}): Promise<FbRegion[]> {
  const query = q.trim();
  if (!query) return [];
  const body = await call(
    '/search',
    token,
    {
      type: 'adgeolocation',
      location_types: JSON.stringify(['region']),
      q: query,
      limit: '20',
    },
    net,
  );
  const data = (body.data as Array<Record<string, unknown>> | undefined) ?? [];
  return data
    .map((r) => ({
      key: String(r.key ?? ''),
      name: String(r.name ?? ''),
      cc: String(r.country_code ?? ''),
    }))
    .filter((r) => r.key && r.name);
}

/** Город FB для исключения: ключ + имя + страна + регион (для показа/разбора). */
export type FbCity = { key: string; name: string; cc: string; region: string };

/**
 * Поиск городов (комун/муниципалитетов) у Facebook по названию. Как и регионы,
 * города FB принимает только по внутреннему ключу (city key), не по имени —
 * поэтому сперва ищем. Возвращаем регион, чтобы различать одноимённые города.
 */
export async function searchCities(token: string, q: string, net: FbNet = {}): Promise<FbCity[]> {
  const query = q.trim();
  if (!query) return [];
  const body = await call(
    '/search',
    token,
    {
      type: 'adgeolocation',
      location_types: JSON.stringify(['city']),
      q: query,
      limit: '25',
    },
    net,
  );
  const data = (body.data as Array<Record<string, unknown>> | undefined) ?? [];
  return data
    .map((r) => ({
      key: String(r.key ?? ''),
      name: String(r.name ?? ''),
      cc: String(r.country_code ?? ''),
      region: String(r.region ?? ''),
    }))
    .filter((r) => r.key && r.name);
}

export type CreateAdsetInput = {
  name: string;
  campaignId: string;
  /** Конверсии: пиксель + событие. */
  pixelId: string;
  event?: string; // PURCHASE по умолчанию
  countries: string[]; // ['US']
  /** Числовые FB locale ID для таргета по языку (targeting.locales). Пусто — без
   *  языкового фильтра. Резолвятся через resolveLocaleId. */
  locales?: number[];
  /** Исключаемые страны (excluded_geo_locations). Пусто — не передаём. */
  excludedCountries?: string[];
  /** Исключаемые регионы (области/штаты) — ключи FB (region key). Пусто — не передаём. */
  excludedRegions?: string[];
  /** Исключаемые города (комуны) — ключи FB (city key). Пусто — не передаём. */
  excludedCities?: string[];
  /** DSA (ЕС): кто продвигается и кто платит. Требуется при таргете на ЕС/ЕЭЗ,
   *  иначе ФБ: код 100/3858081 «Укажите человека или организацию…». */
  dsaBeneficiary?: string;
  dsaPayer?: string;
  /** Бюджет на адсете, в центах. Если бюджет на кампании — не передаём. */
  dailyBudgetCents?: number;
  bidStrategy?: string; // LOWEST_COST_WITHOUT_CAP
  billingEvent?: string; // IMPRESSIONS
  ageMin?: number;
  ageMax?: number;
  genders?: number[]; // []/undefined = все, [1]=муж, [2]=жен
  status?: 'PAUSED' | 'ACTIVE';
  /** ISO-время планового старта (для запланированного запуска). */
  startTime?: string;
  /** Ключи плейсментов (см. lib/placements). Пусто — авто-плейсменты. */
  placements?: string[];
};

export async function createAdset(token: string, externalId: string, i: CreateAdsetInput, net: FbNet = {}) {
  const targeting: Record<string, unknown> = {
    geo_locations: { countries: i.countries },
    age_min: i.ageMin ?? 18,
    age_max: i.ageMax ?? 65,
  };
  if (
    (i.excludedCountries && i.excludedCountries.length) ||
    (i.excludedRegions && i.excludedRegions.length) ||
    (i.excludedCities && i.excludedCities.length)
  ) {
    const ex: Record<string, unknown> = {};
    if (i.excludedCountries && i.excludedCountries.length) ex.countries = i.excludedCountries;
    if (i.excludedRegions && i.excludedRegions.length) ex.regions = i.excludedRegions.map((key) => ({ key }));
    if (i.excludedCities && i.excludedCities.length) ex.cities = i.excludedCities.map((key) => ({ key }));
    targeting.excluded_geo_locations = ex;
  }
  if (i.genders && i.genders.length) targeting.genders = i.genders;
  // Языковой таргет: показываем только тем, у кого интерфейс на этих языках.
  if (i.locales && i.locales.length) targeting.locales = i.locales;
  // Плейсменты: если в шаблоне выбраны — задаём вручную, иначе авто (Advantage+).
  if (i.placements && i.placements.length) {
    const pt = buildPlacementTargeting(i.placements);
    if (pt) Object.assign(targeting, pt);
  }

  const params: Record<string, string> = {
    name: i.name,
    campaign_id: i.campaignId,
    optimization_goal: 'OFFSITE_CONVERSIONS',
    billing_event: i.billingEvent || 'IMPRESSIONS',
    bid_strategy: i.bidStrategy || 'LOWEST_COST_WITHOUT_CAP',
    promoted_object: JSON.stringify({ pixel_id: i.pixelId, custom_event_type: i.event || 'PURCHASE' }),
    targeting: JSON.stringify(targeting),
    status: i.status || 'PAUSED',
    // Окно атрибуции 7-1-1: 7 дней по клику, 1 день по просмотру и 1 день по
    // просмотру видео — как ставим руками.
    attribution_spec: JSON.stringify([
      { event_type: 'CLICK_THROUGH', window_days: 7 },
      { event_type: 'VIEW_THROUGH', window_days: 1 },
      { event_type: 'ENGAGED_VIDEO_VIEW', window_days: 1 },
    ]),
  };
  if (i.dailyBudgetCents) params.daily_budget = String(i.dailyBudgetCents);
  if (i.startTime) params.start_time = i.startTime;
  // DSA-декларация (ЕС): бенефициар и плательщик рекламы. Ставим только когда
  // заданы (для не-ЕС гео не нужны и могут мешать).
  if (i.dsaBeneficiary && i.dsaPayer) {
    // Внимание: у Меты поле называется dsa_payor (амер. написание), НЕ dsa_payer —
    // с неверным ключом ФБ молча игнорировал плательщика и ругался на DSA.
    params.dsa_beneficiary = i.dsaBeneficiary;
    params.dsa_payor = i.dsaPayer;
  }

  const body = await call(`/${externalId}/adsets`, token, params, net, 'POST', CREATE_API_VERSION);
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Адсет не создан: нет id');
  return id;
}

/**
 * Читаем обратно, какие площадки FB РЕАЛЬНО сохранил в адсете. Нужно для
 * диагностики: Мета молча выкидывает плейсмент, если значение/платформа не
 * подходят (частый случай — Threads), ошибку при этом не отдаёт. Возвращаем
 * publisher_platforms и *_positions как есть; null — если прочитать не вышло.
 */
export async function getAdsetPlacements(
  token: string,
  adsetId: string,
  net: FbNet = {},
): Promise<{
  publisher_platforms?: string[];
  facebook_positions?: string[];
  instagram_positions?: string[];
  threads_positions?: string[];
  messenger_positions?: string[];
  audience_network_positions?: string[];
} | null> {
  try {
    const body = await call(`/${adsetId}`, token, { fields: 'targeting' }, net, 'GET');
    const t = (body as { targeting?: Record<string, unknown> }).targeting;
    if (!t) return null;
    const arr = (k: string) => (Array.isArray(t[k]) ? (t[k] as string[]) : undefined);
    return {
      publisher_platforms: arr('publisher_platforms'),
      facebook_positions: arr('facebook_positions'),
      instagram_positions: arr('instagram_positions'),
      threads_positions: arr('threads_positions'),
      messenger_positions: arr('messenger_positions'),
      audience_network_positions: arr('audience_network_positions'),
    };
  } catch {
    return null;
  }
}

/**
 * Убрать из адсета плейсменты Instagram и Threads. Нужно как само-хил, когда у
 * объявления нет IG-идентичности и FB отбивает ad кодом 100/1772103 «Select an
 * Instagram account or Facebook Page…»: читаем таргетинг, вырезаем instagram/
 * threads из publisher_platforms и *_positions, пишем обратно. true — изменили и
 * обновили; false — менять было нечего либо не вышло.
 */
export async function stripAdsetInstagram(token: string, adsetId: string, net: FbNet = {}): Promise<boolean> {
  try {
    const body = await call(`/${adsetId}`, token, { fields: 'targeting' }, net, 'GET');
    const t = (body as { targeting?: Record<string, unknown> }).targeting;
    if (!t || typeof t !== 'object') return false;
    const tg = { ...(t as Record<string, unknown>) };
    let changed = false;
    if (Array.isArray(tg.publisher_platforms)) {
      const kept = (tg.publisher_platforms as string[]).filter((p) => p !== 'instagram' && p !== 'threads');
      if (kept.length !== (tg.publisher_platforms as string[]).length) { tg.publisher_platforms = kept; changed = true; }
    }
    for (const k of ['instagram_positions', 'threads_positions']) {
      if (tg[k] !== undefined) { delete tg[k]; changed = true; }
    }
    if (!changed) return false;
    await call(`/${adsetId}`, token, { targeting: JSON.stringify(tg) }, net, 'POST');
    return true;
  } catch {
    return false;
  }
}

/**
 * Загрузка картинки в кабинет → image_hash. FB принимает base64 в параметре
 * `bytes`, но он большой, поэтому шлём его ТЕЛОМ POST (form-urlencoded), а не в
 * query. Возвращаем hash для креатива.
 */
export async function uploadAdImage(token: string, externalId: string, bytes: Buffer, net: FbNet = {}) {
  const form = new URLSearchParams();
  form.set('access_token', token);
  form.set('bytes', bytes.toString('base64'));

  const url = `${API}/${externalId}/adimages`;
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (net.ua) headers['User-Agent'] = net.ua;
  if (net.cookie) headers['Cookie'] = net.cookie;
  const payload = form.toString();

  // Через прокси картинка (base64 в теле) грузится медленно — 30с не хватало и
  // залив падал «timeout of 30000ms exceeded». Даём 2 минуты и 3 попытки с
  // паузой: сетевой сбой на одном кабе больше не рушит весь залив.
  const TIMEOUT = 120000;
  const TRIES = 3;
  let status = 0;
  let text = '';
  let sent = false;
  let lastNetErr = '';
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    try {
      if (net.proxyUrl) {
        const agent = proxyAgent(net.proxyUrl);
        const res = await axios.request({
          method: 'POST', url, headers, data: payload,
          httpAgent: agent, httpsAgent: agent,
          maxContentLength: 5_000_000, maxBodyLength: Infinity, timeout: TIMEOUT,
          responseType: 'text', transformResponse: [(d) => d], validateStatus: () => true,
        });
        status = res.status; text = String(res.data ?? '');
      } else {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), TIMEOUT);
        try {
          const res = await fetch(url, { method: 'POST', headers, body: payload, cache: 'no-store', signal: ctrl.signal });
          status = res.status; text = await res.text();
        } finally { clearTimeout(t); }
      }
      sent = true;
      break;
    } catch (e) {
      lastNetErr = (e as Error).message;
      if (attempt < TRIES) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    }
  }
  if (!sent) throw new FbError(`Не загрузили картинку в FB (после ${TRIES} попыток): ${lastNetErr}`);

  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new FbError(`FB ответил не по-json (${status}) на загрузку картинки`); }
  const err = (body as { error?: { message?: string; code?: number } }).error;
  if (err) throw new FbError(fbErrorMessage(err, status));
  const images = ((body as Record<string, unknown>).images ?? {}) as Record<string, { hash?: string }>;
  const first = Object.values(images)[0];
  if (!first?.hash) throw new FbError('Картинка загружена, но FB не вернул hash');
  return first.hash;
}

/**
 * Загрузка ролика в кабинет → video_id. Видео FB принимает только multipart-ом
 * (поле `source`), base64 в body не годится (это для картинок). Тело большое,
 * поэтому лимиты axios снимаем и таймаут увеличиваем. Возвращаем id видео;
 * дальше его нужно дождаться в обработке (waitVideoReady).
 */
export async function uploadVideo(token: string, externalId: string, bytes: Buffer, filename: string, net: FbNet = {}): Promise<string> {
  const url = `${API}/${externalId}/advideos`;
  const agent = net.proxyUrl ? proxyAgent(net.proxyUrl) : undefined;
  // Ролики бывают тяжёлыми, а через прокси канал узкий — даём щедрый таймаут
  // (10 мин) и повторяем при обрыве/таймауте сети (не при ошибке самого FB).
  const TIMEOUT = 600000;
  const TRIES = 3;

  let status = 0;
  let text = '';
  let lastNetErr = '';
  let sent = false;
  for (let attempt = 1; attempt <= TRIES; attempt += 1) {
    // FormData одноразовая (это поток) — пересобираем на каждую попытку.
    const form = new FormDataNode();
    form.append('access_token', token);
    form.append('source', bytes, { filename: filename || 'video.mp4' });
    const headers: Record<string, string> = { ...form.getHeaders() };
    if (net.ua) headers['User-Agent'] = net.ua;
    if (net.cookie) headers['Cookie'] = net.cookie;
    try {
      const res = await axios.request({
        method: 'POST', url, headers, data: form,
        ...(agent ? { httpAgent: agent, httpsAgent: agent } : {}),
        maxContentLength: Infinity, maxBodyLength: Infinity, timeout: TIMEOUT,
        responseType: 'text', transformResponse: [(d) => d], validateStatus: () => true,
      });
      status = res.status; text = String(res.data ?? '');
      sent = true;
      break;
    } catch (e) {
      // Сетевой сбой/таймаут — повторяем; на последней попытке отдаём ошибку.
      lastNetErr = (e as Error).message;
      if (attempt < TRIES) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    }
  }
  if (!sent) throw new FbError(`Не загрузили видео в FB (после ${TRIES} попыток): ${lastNetErr}`);

  let body: unknown;
  try { body = JSON.parse(text); } catch { throw new FbError(`FB ответил не по-json (${status}) на загрузку видео`); }
  const err = (body as { error?: { message?: string; code?: number } }).error;
  if (err) throw new FbError(fbErrorMessage(err, status));
  const id = (body as { id?: string }).id;
  if (!id) throw new FbError('Видео загружено, но FB не вернул id');
  return id;
}

/**
 * Ждём, пока FB обработает ролик (video_status = ready). Без этого креатив с
 * video_id падает. Опрашиваем со сдержанным интервалом; по таймауту — понятная
 * ошибка (можно повторить залив позже, видео уже загружено).
 */
export async function waitVideoReady(token: string, videoId: string, net: FbNet = {}, opts: { tries?: number; intervalMs?: number } = {}): Promise<void> {
  const tries = opts.tries ?? 40;
  const intervalMs = opts.intervalMs ?? 4000;
  for (let i = 0; i < tries; i += 1) {
    const body = await call(`/${videoId}`, token, { fields: 'status' }, net);
    const st = ((body as { status?: { video_status?: string } }).status) ?? {};
    if (st.video_status === 'ready') return;
    if (st.video_status === 'error') throw new FbError('FB не смог обработать видео (ошибка кодирования)');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new FbError('Видео не обработалось вовремя (таймаут). Ролик уже загружен — повтори залив чуть позже.');
}

/** Кадр-превью обработанного ролика (video_data требует image_url/hash). Берём
 *  предпочтительный (is_preferred) или первый доступный. Пусто — не нашли. */
export async function videoThumbnailUrl(token: string, videoId: string, net: FbNet = {}): Promise<string> {
  try {
    const body = await call(`/${videoId}/thumbnails`, token, { fields: 'uri,is_preferred' }, net);
    const data = ((body as { data?: { uri?: string; is_preferred?: boolean }[] }).data) ?? [];
    const preferred = data.find((t) => t.is_preferred) ?? data[0];
    return preferred?.uri ?? '';
  } catch {
    return '';
  }
}

/** FB locale ID по названию языка. customization_spec.locales требует числовой
 *  ID (не код), берём его поиском /search?type=adlocale. Не нашли — 0. */
export async function resolveLocaleId(token: string, name: string, net: FbNet = {}): Promise<number> {
  const q = (name || '').trim();
  if (!q) return 0;
  try {
    const body = await call('/search', token, { type: 'adlocale', q, limit: '20' }, net);
    const data = ((body as { data?: { key?: number; name?: string }[] }).data) ?? [];
    const exact = data.find((d) => (d.name ?? '').toLowerCase() === q.toLowerCase());
    const pick = exact ?? data[0];
    return Number(pick?.key ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** Загрузка ролика по прямой ссылке (file_url) — для языков, у которых видео
 *  задано ссылкой, а не файлом. Возвращает video_id. */
export async function uploadVideoByUrl(token: string, externalId: string, fileUrl: string, net: FbNet = {}): Promise<string> {
  const body = await call(`/${externalId}/advideos`, token, { file_url: fileUrl }, net, 'POST');
  const id = (body as { id?: string }).id;
  if (!id) throw new FbError('Видео по ссылке не принято FB (нет id)');
  return id;
}

/** Один языковой вариант для мультиязычного видео-креатива. */
export type LangVariant = {
  localeId: number;
  videoId: string;
  thumb?: string;
  message: string;
  headline?: string;
  description?: string;
  link?: string;
};

export type CreateMultiLangVideoInput = {
  name: string;
  pageId: string;
  cta?: string;
  urlTags?: string;
  optOutKeys?: string[];
  /** Целевые страны (ISO-2) — только для журнала/справки; в правила НЕ идут
   *  (языковая кастомизация по locale гео не требует). */
  countries: string[];
  // Основной вариант — идёт в дефолтное правило под свой (основной) язык.
  main: { videoId: string; thumb?: string; message: string; headline?: string; description?: string; link: string };
  /** locale ID языка основного ролика — ОБЯЗАТЕЛЕН: идёт в дефолтное правило
   *  (customization_spec.locales на is_default). Без него FB считает правила
   *  плейсментными и требует гео (код 2446501). */
  mainLocaleId: number;
  langs: LangVariant[];
  /** IG-идентичность для Instagram-плейсментов (см. resolveInstagramActor). */
  instagramActorId?: string;
};

/**
 * Мультиязычный видео-креатив: основной ролик + доп-языки в ОДНОМ объявлении
 * (нативная фича FB «Добавить языки») через asset_feed_spec +
 * asset_customization_rules по locale. Каждый ассет помечаем adlabels, правило
 * связывает язык (customization_spec.locales) с его роликом/текстом.
 *
 * КЛЮЧЕВОЕ: дефолтное правило (is_default) обязано нести locale ОСНОВНОГО языка
 * в customization_spec.locales — как в примере из офиц. доков Меты. Пустой
 * customization_spec:{} на дефолте ломал всё: FB считал правила плейсментными и
 * требовал гео (код 2446501). Гео в правилах НЕ нужно вовсе — только locales.
 * Никаких priority. Форма один-в-один с документированным примером.
 */
export async function createMultiLangVideoCreative(token: string, externalId: string, i: CreateMultiLangVideoInput, net: FbNet = {}) {
  if (!i.mainLocaleId) throw new FbError('Мультиязычный креатив: не задан locale основного языка');
  const videos: Record<string, unknown>[] = [];
  const bodies: Record<string, unknown>[] = [];
  const titles: Record<string, unknown>[] = [];
  const descriptions: Record<string, unknown>[] = [];
  const linkUrls: Record<string, unknown>[] = [];
  const rules: Record<string, unknown>[] = [];

  const pushVariant = (tag: string, v: { videoId: string; thumb?: string; message: string; headline?: string; description?: string; link: string }) => {
    const vid: Record<string, unknown> = { video_id: v.videoId, adlabels: [{ name: `vid_${tag}` }] };
    if (v.thumb) vid.thumbnail_url = v.thumb;
    videos.push(vid);
    bodies.push({ text: v.message, adlabels: [{ name: `body_${tag}` }] });
    if (v.headline) titles.push({ text: v.headline, adlabels: [{ name: `title_${tag}` }] });
    if (v.description) descriptions.push({ text: v.description, adlabels: [{ name: `desc_${tag}` }] });
    // link_url для каждого варианта свой (у языка может быть свой лендинг).
    linkUrls.push({ website_url: v.link, adlabels: [{ name: `link_${tag}` }] });
  };

  // Основной вариант (пойдёт в дефолтное правило под свой язык).
  pushVariant('def', { ...i.main });
  // Языковые варианты — по одному не-дефолтному правилу на каждый (только locale).
  i.langs.forEach((l, idx) => {
    pushVariant(`l${idx}`, { videoId: l.videoId, thumb: l.thumb, message: l.message, headline: l.headline, description: l.description, link: l.link || i.main.link });
    const rule: Record<string, unknown> = {
      customization_spec: { locales: [l.localeId] },
      video_label: { name: `vid_l${idx}` },
      body_label: { name: `body_l${idx}` },
      link_url_label: { name: `link_l${idx}` },
    };
    if (l.headline) rule.title_label = { name: `title_l${idx}` };
    if (l.description) rule.description_label = { name: `desc_l${idx}` };
    rules.push(rule);
  });
  // Дефолтное правило: is_default + locale ОСНОВНОГО языка (не пустой спек!).
  const defRule: Record<string, unknown> = {
    is_default: true,
    customization_spec: { locales: [i.mainLocaleId] },
    video_label: { name: 'vid_def' },
    body_label: { name: 'body_def' },
    link_url_label: { name: 'link_def' },
  };
  if (i.main.headline) defRule.title_label = { name: 'title_def' };
  if (i.main.description) defRule.description_label = { name: 'desc_def' };
  rules.push(defRule);

  const assetFeedSpec: Record<string, unknown> = {
    ad_formats: ['SINGLE_VIDEO'],
    videos,
    bodies,
    link_urls: linkUrls,
    call_to_action_types: [i.cta || 'LEARN_MORE'],
    asset_customization_rules: rules,
  };
  if (titles.length) assetFeedSpec.titles = titles;
  if (descriptions.length) assetFeedSpec.descriptions = descriptions;

  const storySpec: Record<string, unknown> = { page_id: i.pageId };
  if (i.instagramActorId) storySpec.instagram_actor_id = i.instagramActorId;
  const params: Record<string, string> = {
    name: i.name,
    object_story_spec: JSON.stringify(storySpec),
    asset_feed_spec: JSON.stringify(assetFeedSpec),
  };
  const optOut = i.optOutKeys ?? ['standard_enhancements'];
  if (optOut.length) {
    const spec: Record<string, { enroll_status: 'OPT_OUT' }> = {};
    for (const k of optOut) spec[k] = { enroll_status: 'OPT_OUT' };
    params.degrees_of_freedom_spec = JSON.stringify({ creative_features_spec: spec });
  }
  // Multi-advertiser ads выключаем на КРЕАТИВЕ (не адсете): contextual_multi_ads
  // ФБ принимает как JSON-ОБЪЕКТ {enroll_status:'OPT_OUT'} (на строку отвечает
  // «must be a JSON object»). Так объявление не идёт в общую ленту с чужими.
  params.contextual_multi_ads = JSON.stringify({ enroll_status: 'OPT_OUT' });
  if (i.urlTags && i.urlTags.trim()) params.url_tags = i.urlTags.trim();

  // Языковая кастомизация по locale поддержана в актуальных версиях. Если кабинет
  // на новой версии вдруг отобьёт как «сегментную» (код 2715) — повторяем на v21.
  const post = async (ver: string) => {
    const body = await call(`/${externalId}/adcreatives`, token, params, net, 'POST', ver);
    const id = body.id as string | undefined;
    if (!id) throw new FbError('Мультиязычный креатив не создан: нет id');
    return id;
  };
  try {
    return await post(CREATE_API_VERSION);
  } catch (e) {
    if (/\b2715\b|Segment Asset Customization/i.test((e as Error).message)) {
      return await post('v21.0');
    }
    throw e;
  }
}

export type CreateVideoCreativeInput = {
  name: string;
  pageId: string;
  videoId: string;
  message: string; // основной текст
  link: string;
  cta?: string;
  urlTags?: string;
  headline?: string;
  description?: string;
  imageUrl?: string; // кадр-превью ролика
  optOutKeys?: string[];
  /** IG-идентичность для Instagram-плейсментов (см. resolveInstagramActor). */
  instagramActorId?: string;
};

/** Видео-креатив (object_story_spec.video_data). Аналог createAdCreative, но с
 *  роликом вместо картинки. Превью обязательно — иначе FB отбивает креатив. */
export async function createVideoAdCreative(token: string, externalId: string, i: CreateVideoCreativeInput, net: FbNet = {}) {
  const videoData: Record<string, unknown> = {
    video_id: i.videoId,
    message: i.message,
    call_to_action: { type: i.cta || 'LEARN_MORE', value: { link: i.link } },
  };
  if (i.imageUrl) videoData.image_url = i.imageUrl;
  if (i.headline) videoData.title = i.headline;
  if (i.description) videoData.link_description = i.description;
  const objectStorySpec: Record<string, unknown> = { page_id: i.pageId, video_data: videoData };
  if (i.instagramActorId) objectStorySpec.instagram_actor_id = i.instagramActorId;
  const params: Record<string, string> = {
    name: i.name,
    object_story_spec: JSON.stringify(objectStorySpec),
  };
  const optOut = i.optOutKeys ?? ['standard_enhancements'];
  if (optOut.length) {
    const spec: Record<string, { enroll_status: 'OPT_OUT' }> = {};
    for (const k of optOut) spec[k] = { enroll_status: 'OPT_OUT' };
    params.degrees_of_freedom_spec = JSON.stringify({ creative_features_spec: spec });
  }
  // Multi-advertiser ads выключаем на КРЕАТИВЕ (не адсете): contextual_multi_ads
  // ФБ принимает как JSON-ОБЪЕКТ {enroll_status:'OPT_OUT'} (на строку отвечает
  // «must be a JSON object»). Так объявление не идёт в общую ленту с чужими.
  params.contextual_multi_ads = JSON.stringify({ enroll_status: 'OPT_OUT' });
  if (i.urlTags && i.urlTags.trim()) params.url_tags = i.urlTags.trim();
  const body = await call(`/${externalId}/adcreatives`, token, params, net, 'POST', CREATE_API_VERSION);
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Видео-креатив не создан: нет id');
  return id;
}

/**
 * Свежая ссылка-превью объявления. thumbnail_url из Graph короткоживущий —
 * если сохранённый протух, дёргаем актуальный одним лёгким запросом.
 */
export async function adThumbnailUrl(token: string, adId: string, net: FbNet = {}) {
  const body = await call(`/${adId}`, token, { fields: 'creative{thumbnail_url}' }, net);
  const c = (body as { creative?: { thumbnail_url?: string } }).creative;
  return c?.thumbnail_url ?? '';
}

/**
 * Скачать картинку с fbcdn через прокси/UA кабинета и вернуть байты. Прямые
 * thumbnail_url по хотлинку из <img> отдают 403 и протухают — поэтому тянем их
 * на сервере (как FB Tool) и раздаём уже со своего домена. null — не удалось.
 */
export async function fetchImageBytes(
  url: string,
  net: FbNet = {},
): Promise<{ buffer: Buffer; contentType: string } | null> {
  if (!url) return null;
  const headers: Record<string, string> = {};
  if (net.ua) headers['User-Agent'] = net.ua;
  try {
    if (net.proxyUrl) {
      const agent = proxyAgent(net.proxyUrl);
      const res = await axios.request({
        method: 'GET', url, headers,
        httpAgent: agent, httpsAgent: agent,
        responseType: 'arraybuffer', timeout: 20000,
        maxContentLength: 8_000_000, validateStatus: () => true,
      });
      if (res.status < 200 || res.status >= 300) return null;
      return { buffer: Buffer.from(res.data as ArrayBuffer), contentType: String(res.headers['content-type'] ?? 'image/jpeg') };
    }
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (!res.ok) return null;
    return { buffer: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/jpeg' };
  } catch {
    return null;
  }
}

/**
 * Ключи авто-улучшений креатива для OPT_OUT. v22 их ВАЛИДИРУЕТ и отбивает весь
 * креатив на неизвестном ключе — поэтому оркестратор шлёт этот список, ловит
 * «Param key 'X' … must be one of …», выкидывает X и повторяет (самолечение).
 * Часть имён — предположения (комментарии/спотлайты); неверные отсеются сами.
 */
export const ENHANCEMENT_OPTOUT_KEYS = [
  'standard_enhancements',
  'enhance_cta',
  'image_brightness_and_contrast',
  'text_optimizations',
  'text_improvements',
  'image_templates',
  'image_touchups',
  'image_animation',
  'profile_card',
  'text_overlay_translation',
  'product_metadata_automation',
  'product_browsing',
  'relevant_audience_comments',
  'pinned_relevant_comment',
  'inline_comment',
  'catalog_feed_tags',
  'description_automation',
  'adapt_to_placement',
  'media_type_automation',
  // multi-advertiser ads НЕ отключается через creative_features_spec (Мета
  // отвергала ключ) — отключаем на уровне АДСЕТА через contextual_multi_ads:
  // OPT_OUT (см. createAdset). Поэтому здесь этих ключей нет.
];

/**
 * Видео-специфичные авто-улучшения (в UI: «Video touch-ups», «Add video effects»).
 * Для картинок эти ключи не подходят, поэтому держим отдельно и добавляем только
 * к видео-креативу. Часть имён — кандидаты; неверные самолечение отсеет.
 */
export const VIDEO_ENHANCEMENT_OPTOUT_KEYS = [
  'video_auto_crop',
  'video_touchups',
  'video_touch_ups',
  'video_uncrop',
  'add_video_effects',
  'video_effects',
  'video_filtering',
  'video_highlight',
];

export type CreateCreativeInput = {
  name: string;
  pageId: string;
  message: string; // текст объявления
  imageHash: string;
  link: string; // лендинг
  cta?: string; // LEARN_MORE / SHOP_NOW ...
  /** Метки к ссылке (url_tags): «sub_id4={{ad.id}}&...». Пусто — не шлём. */
  urlTags?: string;
  /** Заголовок и описание под ссылкой (необязательны). */
  headline?: string;
  description?: string;
  /** Ключи авто-улучшений в OPT_OUT. Пусто — degrees_of_freedom_spec не шлём. */
  optOutKeys?: string[];
  /** IG-идентичность для Instagram-плейсментов (см. resolveInstagramActor). */
  instagramActorId?: string;
};

export async function createAdCreative(token: string, externalId: string, i: CreateCreativeInput, net: FbNet = {}) {
  const linkData: Record<string, unknown> = {
    message: i.message,
    link: i.link,
    image_hash: i.imageHash,
    call_to_action: { type: i.cta || 'LEARN_MORE' },
  };
  if (i.headline) linkData.name = i.headline;
  if (i.description) linkData.description = i.description;
  const objectStorySpec: Record<string, unknown> = { page_id: i.pageId, link_data: linkData };
  if (i.instagramActorId) objectStorySpec.instagram_actor_id = i.instagramActorId;
  const params: Record<string, string> = {
    name: i.name,
    object_story_spec: JSON.stringify(objectStorySpec),
  };
  // Отключаем авто-улучшения по списку ключей. v22 валидирует ключи и отбивает
  // весь креатив на неизвестном — оркестратор ловит это и подрезает список.
  const optOut = i.optOutKeys ?? ['standard_enhancements'];
  if (optOut.length) {
    const spec: Record<string, { enroll_status: 'OPT_OUT' }> = {};
    for (const k of optOut) spec[k] = { enroll_status: 'OPT_OUT' };
    params.degrees_of_freedom_spec = JSON.stringify({ creative_features_spec: spec });
  }
  // Multi-advertiser ads выключаем на КРЕАТИВЕ (не адсете): contextual_multi_ads
  // ФБ принимает как JSON-ОБЪЕКТ {enroll_status:'OPT_OUT'} (на строку отвечает
  // «must be a JSON object»). Так объявление не идёт в общую ленту с чужими.
  params.contextual_multi_ads = JSON.stringify({ enroll_status: 'OPT_OUT' });
  if (i.urlTags && i.urlTags.trim()) params.url_tags = i.urlTags.trim();
  const body = await call(`/${externalId}/adcreatives`, token, params, net, 'POST', CREATE_API_VERSION);
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Креатив не создан: нет id');
  return id;
}

export async function createAd(
  token: string,
  externalId: string,
  i: { name: string; adsetId: string; creativeId: string; status?: 'PAUSED' | 'ACTIVE' },
  net: FbNet = {},
) {
  const body = await call(`/${externalId}/ads`, token, {
    name: i.name,
    adset_id: i.adsetId,
    creative: JSON.stringify({ creative_id: i.creativeId }),
    status: i.status || 'PAUSED',
  }, net, 'POST', CREATE_API_VERSION);
  const id = body.id as string | undefined;
  if (!id) throw new FbError('Объявление не создано: нет id');
  return id;
}
