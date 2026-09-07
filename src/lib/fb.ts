import 'server-only';

import axios from 'axios';

import { proxyAgent } from './proxy-agent';

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

export type FbAccount = {
  externalId: string;
  name: string;
  currency: string;
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
  constructor(message: string) {
    super(message);
    this.name = 'FbError';
  }
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
export type FbNet = { ua?: string; proxyUrl?: string | null };

/**
 * Один запрос к Graph, с прокси или без.
 *
 * Через прокси идём axios-ом: у него агент подключается одной строкой.
 * Напрямую — обычным fetch, без лишней зависимости в горячем пути. Наружу оба
 * пути отдают одно и то же — код ответа и тело строкой, — поэтому разбор
 * ошибок ниже общий и про транспорт ничего не знает.
 */
async function send(url: URL, net: FbNet): Promise<{ status: number; text: string }> {
  const headers = net.ua ? { 'User-Agent': net.ua } : undefined;

  if (net.proxyUrl) {
    const agent = proxyAgent(net.proxyUrl);
    const res = await axios.get(url.toString(), {
      headers,
      httpAgent: agent,
      httpsAgent: agent,
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

  const res = await fetch(url, { cache: 'no-store', headers });
  return { status: res.status, text: await res.text() };
}

async function call(
  path: string,
  token: string,
  params: Record<string, string> = {},
  net: FbNet = {},
) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: { status: number; text: string };
  try {
    res = await send(url, net);
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
    throw new FbError(fbErrorMessage(err, res.status));
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
  // 100 — плохие параметры; на нашем /me это тоже обычно битый токен.
  if (code === 100) {
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
      fields: 'account_id,name,currency',
      limit: '100',
      ...(after ? { after } : {}),
    }, net);
    const data = (body.data ?? []) as { account_id?: string; name?: string; currency?: string }[];
    for (const row of data) {
      if (!row.account_id) continue;
      out.push({
        externalId: `act_${row.account_id}`,
        name: row.name ?? '',
        currency: row.currency ?? 'USD',
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
export async function checkToken(raw: string, proxyUrl?: string | null) {
  const { token, ua } = extractFbToken(raw);
  const net: FbNet = { ua, proxyUrl };

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
