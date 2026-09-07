import 'server-only';

import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';

/**
 * Агент под прокси, выбранный по схеме в его адресе.
 *
 * Провайдеры антидетекта раздают и то, и другое, причём часто на одном порту:
 * `HttpsProxyAgent` на SOCKS-прокси не ругается, а молча ждёт ответа, которого
 * не будет, — запрос просто висит до таймаута. Поэтому выбираем агента строго
 * по схеме, а схему пользователь задаёт явно в форме.
 */
export function proxyAgent(url: string) {
  return /^socks/i.test(url) ? new SocksProxyAgent(url) : new HttpsProxyAgent(url);
}
