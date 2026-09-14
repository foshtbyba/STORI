/**
 * Разбор строки прокси.
 *
 * Провайдеры отдают прокси кто во что горазд: одни списком `ip:порт:логин:пароль`,
 * другие `логин:пароль@ip:порт`, третьи готовым URL. Заставлять человека
 * переписывать сотню строк в один формат — верный способ получить опечатку в
 * пароле и потом гадать, почему кабинет не отвечает. Поэтому принимаем всё
 * перечисленное и приводим к URL, который понимает агент.
 *
 * Наружу выходит `схема://логин:пароль@хост:порт`. Схему в списках не пишут,
 * а на глаз HTTP от SOCKS не отличить — порт бывает один и тот же. Поэтому её
 * выбирают в форме, а `kind` сюда приходит оттуда; явно написанная в строке
 * схема сильнее выбранной.
 */

export type ProxyParse = { url: string } | { error: string };

/** Что выбрано в форме рядом с полем прокси. */
export type ProxyKind = 'http' | 'socks5';

/**
 * Обратно из хранимого URL (`схема://логин:пароль@хост:порт`) в вид для поля
 * формы `хост:порт:логин:пароль` и выбранную схему. Нужно, чтобы при обновлении
 * токена показать прежний прокси профиля вписанным. Логин/пароль раскодируем —
 * тогда повторный parseProxy закодирует их снова без задвоения. Пусто/не
 * разобрали — пустая строка.
 */
export function proxyUrlToInput(url: string | null | undefined): { text: string; kind: ProxyKind } {
  const s = (url ?? '').trim();
  if (!s) return { text: '', kind: 'http' };
  const m = s.match(/^([a-z0-9]+):\/\/(?:([^:@]*):([^@]*)@)?([^:/]+):(\d+)/i);
  if (!m) return { text: '', kind: 'http' };
  const kind: ProxyKind = /^socks/i.test(m[1]) ? 'socks5' : 'http';
  const dec = (v?: string) => { try { return decodeURIComponent(v ?? ''); } catch { return v ?? ''; } };
  const user = dec(m[2]);
  const pass = dec(m[3]);
  const text = user || pass ? `${m[4]}:${m[5]}:${user}:${pass}` : `${m[4]}:${m[5]}`;
  return { text, kind };
}

const isPort = (s: string) => /^\d{1,5}$/.test(s) && Number(s) >= 1 && Number(s) <= 65535;

/** Хост — это домен или IP: буквы, цифры, точки и дефисы, без пробелов. */
const isHost = (s: string) => /^[a-z0-9.-]+$/i.test(s) && s.length > 0 && !isPort(s);

/**
 * Строку из четырёх чисел через точку разбирают как IPv4, и октет больше 255
 * делает адрес несуществующим. Ловим это здесь: иначе ошибка всплывает уже
 * внутри агента безымянным «Invalid URL», по которому не догадаться, что дело
 * в опечатке в адресе.
 */
function badIPv4(host: string): string | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((x) => /^\d+$/.test(x))) return null;
  const bad = parts.find((x) => Number(x) > 255);
  return bad ? `${host} — не адрес: ${bad} больше 255` : null;
}

/**
 * Логин и пароль уезжают в URL, а там `:`, `@` и `/` — служебные символы.
 * Кодируем их всегда: пароли у провайдеров бывают с любой пунктуацией, и
 * незакодированный `@` посреди пароля разрезает URL не там, где надо.
 */
function creds(user: string, pass: string) {
  return `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`;
}

/**
 * Пустая строка — это «без прокси», а не ошибка: поле необязательное.
 * Возвращает нормализованный URL либо текст того, что не так.
 */
export function parseProxy(raw: string, kind: ProxyKind = 'http'): ProxyParse | null {
  const s = raw.trim();
  if (!s) return null;
  if (/\s/.test(s)) return { error: 'В строке прокси есть пробел — вставь её одной строкой' };

  // Схема, если её написали явно.
  let rest = s;
  const allowed = ['http', 'https', 'socks', 'socks4', 'socks5', 'socks5h'];
  const scheme = s.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    const name = scheme[1].toLowerCase();
    if (!allowed.includes(name)) {
      return { error: `Схема ${name}:// не поддержана — нужен http, https или socks5` };
    }
    rest = s.slice(scheme[0].length);
  }
  const prefix = scheme
    ? `${scheme[1].toLowerCase()}://`
    : kind === 'socks5'
      ? 'socks5://'
      : 'http://';
  rest = rest.replace(/\/+$/, '');
  if (!rest) return { error: 'Не хватает адреса и порта' };

  // Форма с собакой: логин:пароль@хост:порт. Режем по ПОСЛЕДНЕЙ собаке —
  // пароль вполне может содержать свою.
  //
  // Разбор именно пробуем, а не навязываем: собака встречается и внутри пароля
  // в списочном формате (`ip:порт:логин:p@ss`), и если упереться в неё, такая
  // строка отвергалась бы с жалобой на конец, которого в ней нет. Не сошлось —
  // молча идём разбирать двоеточиями.
  const at = rest.lastIndexOf('@');
  if (at !== -1) {
    const auth = rest.slice(0, at);
    const hostPort = rest.slice(at + 1).split(':');
    const colon = auth.indexOf(':');
    if (hostPort.length === 2 && isHost(hostPort[0]) && isPort(hostPort[1]) && colon !== -1) {
      const ip = badIPv4(hostPort[0]);
      if (ip) return { error: ip };
      return {
        url: `${prefix}${creds(auth.slice(0, colon), auth.slice(colon + 1))}${hostPort[0]}:${hostPort[1]}`,
      };
    }
  }

  const parts = rest.split(':');

  // Порт числом, но не из диапазона — самая частая опечатка, и о ней стоит
  // сказать прямо, а не общим «не разобрал».
  const portish = parts.length >= 2 && /^\d+$/.test(parts[1]) && !isPort(parts[1]);
  if (portish) return { error: `Порт ${parts[1]} вне диапазона 1–65535` };

  // Без пароля: хост:порт.
  if (parts.length === 2) {
    if (!isHost(parts[0]) || !isPort(parts[1])) {
      return { error: 'Ожидается хост:порт — проверь адрес и номер порта' };
    }
    const ip = badIPv4(parts[0]);
    if (ip) return { error: ip };
    return { url: `${prefix}${parts[0]}:${parts[1]}` };
  }

  if (parts.length >= 4) {
    // Самый частый список: хост:порт:логин:пароль. Узнаём по порту на втором
    // месте. Пароль забираем «до конца» — в нём попадаются двоеточия.
    if (isHost(parts[0]) && isPort(parts[1])) {
      const ip = badIPv4(parts[0]);
      if (ip) return { error: ip };
      return {
        url: `${prefix}${creds(parts[2], parts.slice(3).join(':'))}${parts[0]}:${parts[1]}`,
      };
    }
    // Обратный порядок: логин:пароль:хост:порт. Тут хост и порт стоят в конце,
    // поэтому пароль однозначен только при ровно четырёх частях.
    if (parts.length === 4 && isHost(parts[2]) && isPort(parts[3])) {
      const ip = badIPv4(parts[2]);
      if (ip) return { error: ip };
      return { url: `${prefix}${creds(parts[0], parts[1])}${parts[2]}:${parts[3]}` };
    }
    return {
      error: 'Не разобрал строку: жду хост:порт:логин:пароль, логин:пароль@хост:порт или полный URL',
    };
  }

  return {
    error: 'Не разобрал строку: жду хост:порт:логин:пароль, логин:пароль@хост:порт или полный URL',
  };
}
