import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
    const agent = new HttpsProxyAgent(proxyUrl);
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
export async function extractTokenFromCookies(cookiesJsonStr: string, proxyUrl?: string | null): Promise<string> {
  try {
    const cookies = JSON.parse(cookiesJsonStr);
    const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

    const config: any = {
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      timeout: 15000,
    };

    if (proxyUrl) {
      const agent = new HttpsProxyAgent(proxyUrl);
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