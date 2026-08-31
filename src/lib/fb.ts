import 'server-only';

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
export function extractFbToken(raw: string): { token: string; ua?: string } {
  const s = raw.trim();
  if (!s) throw new FbError('Пусто — вставь токен или мультитокен');

  if (s.startsWith('eyJ')) {
    let parsed: { token?: unknown; ua?: unknown };
    try {
      parsed = JSON.parse(Buffer.from(s, 'base64').toString('utf8'));
    } catch {
      throw new FbError('Мультитокен не разобрался — похоже, скопирован не целиком');
    }
    if (typeof parsed.token !== 'string' || !parsed.token) {
      throw new FbError('В мультитокене нет поля token');
    }
    return { token: parsed.token, ua: typeof parsed.ua === 'string' ? parsed.ua : undefined };
  }

  return { token: s };
}

async function call(
  path: string,
  token: string,
  params: Record<string, string> = {},
  ua?: string,
) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: ua ? { 'User-Agent': ua } : undefined,
    });
  } catch (e) {
    throw new FbError(`Не достучались до Facebook: ${(e as Error).message}`);
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new FbError(`Facebook ответил не по-json (${res.status}): ${text.slice(0, 200)}`);
  }

  const err = (body as { error?: { message?: string; code?: number; error_user_msg?: string } }).error;
  if (err) {
    throw new FbError(fbErrorMessage(err, res.status));
  }
  if (!res.ok) throw new FbError(`Facebook ответил ${res.status}`);
  return body as Record<string, unknown>;
}

/**
 * Ошибки Facebook приходят голым кодом — «код 1: Invalid request» человеку
 * ничего не говорит и чинить нечего. Переводим частые коды в подсказку: что
 * именно не так с токеном и что проверить.
 */
function fbErrorMessage(
  err: { message?: string; code?: number; error_user_msg?: string },
  status: number,
) {
  const code = err.code ?? status;
  const why = err.error_user_msg || err.message || 'без объяснений';
  const hint = fbHint(code, why);
  const base = `Facebook отказал (код ${code}): ${why}`;
  return hint ? `${base} — ${hint}` : base;
}

function fbHint(code: number, why: string): string | null {
  const w = why.toLowerCase();
  // 190 — токен протух или отозван; самый частый случай на длинной дистанции.
  if (code === 190) {
    return 'токен недействителен или протух. Выпусти новый и вставь его целиком.';
  }
  // 1/2 «Invalid request» — Facebook вообще не разобрал строку как токен.
  // Обычно вставили не то: обрезанный ключ, логин-сессию, адрес кабинета.
  if (code === 1 || code === 2 || w.includes('invalid request')) {
    return 'похоже, это не рабочий ключ Graph API. Проверь, что строка скопирована целиком: это должен быть токен (EAA…) или мультитокен из антидетекта (eyJ…) полностью, а не логин, cookie или адрес кабинета.';
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
export async function listAccounts(token: string, ua?: string) {
  const out: FbAccount[] = [];
  let after = '';

  // Ограничение сверху на всякий случай: битая пагинация не должна вешать
  // синхронизацию навсегда.
  for (let page = 0; page < 40; page += 1) {
    const body = await call('/me/adaccounts', token, {
      fields: 'account_id,name,currency',
      limit: '100',
      ...(after ? { after } : {}),
    }, ua);
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
  ua?: string,
) {
  const body = await call(`/${externalId}/insights`, token, {
    fields: 'spend',
    level: 'account',
    time_increment: '1',
    time_range: JSON.stringify({ since: from, until: to }),
    limit: '500',
  }, ua);

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
export async function checkToken(raw: string) {
  const { token, ua } = extractFbToken(raw);
  const me = await call('/me', token, { fields: 'id,name' }, ua);
  const accounts = await listAccounts(token, ua);
  return {
    name: (me.name as string) || (me.id as string) || 'без имени',
    accounts,
  };
}
