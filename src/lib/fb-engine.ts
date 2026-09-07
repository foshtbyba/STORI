import axios from 'axios';

import { proxyAgent } from './proxy-agent';

// Функция отправки запросов к FB через Прокси аккаунта
export async function makeFbRequest(url: string, params: Record<string, any> = {}, proxyUrl?: string | null, method = 'GET') {
  const config: any = {
    method,
    url,
    params: method === 'GET' ? params : undefined,
    data: method !== 'GET' ? params : undefined,
    timeout: 15000,
  };

  if (proxyUrl) {
    const agent = proxyAgent(proxyUrl);
    config.httpsAgent = agent;
    config.httpAgent = agent;
  }

  try {
    const response = await axios(config);
    return response.data;
  } catch (error: any) {
    const errorMsg = error.response?.data?.error?.message || error.message;
    throw new Error(`FB API Error: ${errorMsg}`);
  }
}

// Авто-парсинг EAAB токена из Cookies
/**
 * Заголовок `Cookie` из выгрузки антидетекта.
 *
 * Класть в него всё подряд нельзя. В выгрузке попадаются куки со значением-JSON
 * (`presence` — это `C{"t3":[],…}`), а кавычки, скобки и запятые в значении
 * заголовок ломают: Facebook отвечает `400 Bad Request` на любой адрес, и
 * снаружи это выглядит как мёртвая сессия, хотя `c_user` и `xs` в порядке.
 *
 * Поэтому пропускаем только значения, допустимые по RFC 6265. Для входа важны
 * `c_user` и `xs`, а отброшенные `presence`, `wd`, `dpr` — про онлайн-статус и
 * размер окна, к авторизации отношения не имеют.
 */
function cookieHeaderOf(cookies: { name?: unknown; value?: unknown }[]): string {
  const safe = /^[!#-+\--:<-[\]-~]*$/; // печатные ASCII без пробела, кавычек, запятой, точки с запятой и обратной косой
  return cookies
    .filter((c) => typeof c.name === 'string' && typeof c.value === 'string')
    .filter((c) => (c.name as string).length > 0 && safe.test(c.value as string))
    .map((c) => `${c.name as string}=${c.value as string}`)
    .join('; ');
}

/**
 * Что вставил человек: голый список кук, объект с полем `cookies` или
 * мультитокен антидетекта целиком (base64 от такого объекта).
 *
 * Принимаем всё три вида: мультитокен у баера уже в руках, и требовать, чтобы
 * он сначала выковырял оттуда массив кук, — лишний шаг, на котором теряются
 * скобки. Заодно из него достаётся `ua`: ходить в Facebook тем же
 * user-agent, что и профиль, надёжнее, чем зашитым в код.
 */
function readCookieBlob(raw: string): { cookies: unknown[]; ua?: string } {
  const asObject = (o: any) => {
    const cookies = Array.isArray(o) ? o : o?.cookies;
    if (!Array.isArray(cookies)) return null;
    const ua = typeof o?.ua === 'string' ? o.ua : undefined;
    return { cookies, ua };
  };

  const s = raw.trim();
  if (s.startsWith('[') || s.startsWith('{')) {
    const direct = asObject(JSON.parse(s));
    if (direct) return direct;
    throw new Error('ожидался список кук — массив объектов с полями name и value');
  }

  // Не JSON — пробуем мультитокен: base64 от объекта с cookies и ua.
  const compact = s.replace(/\s+/g, '');
  for (const variant of new Set([compact, compact.replace(/-/g, '+').replace(/_/g, '/')])) {
    try {
      const decoded = asObject(JSON.parse(Buffer.from(variant, 'base64').toString('utf8')));
      if (decoded) return decoded;
    } catch {
      // не этот вариант кодирования — пробуем следующий
    }
  }
  throw new Error('не разобрал: жду список кук в JSON или мультитокен из антидетекта целиком');
}

export async function extractTokenFromCookies(cookiesJsonStr: string, proxyUrl?: string | null): Promise<string> {
  try {
    const { cookies, ua } = readCookieBlob(cookiesJsonStr);
    const cookieHeader = cookieHeaderOf(cookies as { name?: unknown; value?: unknown }[]);
    if (!/(^|; )c_user=/.test(cookieHeader) || !/(^|; )xs=/.test(cookieHeader)) {
      throw new Error('в куках нет c_user или xs — без них сессии нет, выгрузи их заново');
    }

    const config: any = {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent':
          ua ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    };

    if (proxyUrl) {
      const agent = proxyAgent(proxyUrl);
      config.httpsAgent = agent;
      config.httpAgent = agent;
    }

    const response = await axios.get('https://adsmanager.facebook.com/adsmanager/manage/campaigns', config);
    const tokenMatch = response.data.match(/(EAAB\w+)/);

    if (tokenMatch && tokenMatch[0]) {
      return tokenMatch[0];
    }
    throw new Error('Токен EAAB не найден в коде страницы Ads Manager.');
  } catch (err: any) {
    throw new Error(`Ошибка парсинга кук: ${err.message}`);
  }
}

// Переключение статуса кампании (ACTIVE / PAUSED)
export async function toggleFbCampaign(campaignId: string, status: 'ACTIVE' | 'PAUSED', accessToken: string, proxyUrl?: string | null) {
  const url = `https://graph.facebook.com/v19.0/${campaignId}`;
  return await makeFbRequest(url, { access_token: accessToken, status }, proxyUrl, 'POST');
}