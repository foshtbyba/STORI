'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { checkToken, setAdStatus, setAdsetBudget, duplicateAd, duplicateAdset, duplicateCampaign, adCampaignId, campaignInfo, renameAd, getAdCreative, applyAdText, fbAccess, fbErrorKind, FbError, type FbNet, type AdText } from '@/lib/fb';
import { extractTokenFromCookies, readCookieBlob, cookieHeaderOf } from '@/lib/fb-engine';
import { parseProxy, type ProxyKind } from '@/lib/proxy';
import { checkTracker, KeitaroError } from '@/lib/keitaro';
import { checkBrocard, probeBalances, listAccounts, createTransfer, BrocardError, type BrocardAccount } from '@/lib/brocard';
import { BROCARD_OVERHEAD } from '@/lib/brocard-const';
import { syncAll, syncFacebookCampaigns, syncFacebookAds, refreshTokenFromCookies } from '@/lib/sync';

/**
 * Настройка интеграций. Всё здесь — только для админа: под этими ключами
 * лежит доступ к рекламным кабинетам и к трекеру команды.
 */

const Token = z.object({
  buyerId: z.string().min(1),
  label: z.string().trim().max(80).default(''),
  // Токен и куки — два входа в один кабинет, поэтому оба необязательны по
  // отдельности: что именно вставили, проверяем ниже.
  token: z.string().trim().default(''),
  cookiesJson: z.string().trim().default(''),
  proxyUrl: z.string().trim().max(300).default(''),
  proxyKind: z.enum(['http', 'socks5']).default('http'),
});

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

export async function addToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = Token.safeParse({
    buyerId: form.get('buyerId'),
    label: form.get('label') ?? '',
    token: form.get('token') ?? '',
    cookiesJson: form.get('cookiesJson') ?? '',
    proxyUrl: form.get('proxyUrl') ?? '',
    proxyKind: form.get('proxyKind') ?? 'http',
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поля' };
  }
  const { buyerId, label, cookiesJson } = parsed.data;

  // Прокси приходит в том виде, в каком его дал провайдер: списком
  // `ip:порт:логин:пароль`, с собакой или готовым URL. Приводим к URL один раз
  // здесь и дальше по коду ходит уже нормализованная строка.
  const proxy = parseProxy(parsed.data.proxyUrl, parsed.data.proxyKind as ProxyKind);
  if (proxy && 'error' in proxy) return { ok: false, error: proxy.error };
  const proxyUrl = proxy?.url ?? '';

  // Вход либо готовым мультитокеном, либо отдельными куками.
  //
  // Мультитокен из антидетекта — это `{cookies, ua, token}`: в нём есть всё
  // сразу. Именно куками (плюс user-agent и прокси того же аккаунта) публичный
  // Graph API и принимает сессионный токен — без них на рабочий ключ приходит
  // «код 1». Поэтому куки не выбрасываем, а храним и подставляем в каждый
  // запрос к Facebook.
  //
  // Режим «Cookies» — когда токена на руках нет: открываем куками Ads Manager
  // и достаём ключ оттуда. Дальше всё то же самое.
  let raw = parsed.data.token;
  let cookies: unknown[] = [];

  if (raw) {
    // В поле токена мог прилететь и мультитокен целиком — вытащим из него куки.
    try {
      const blob = readCookieBlob(raw);
      if (Array.isArray(blob.cookies)) cookies = blob.cookies;
    } catch {
      // Плоский токен без кук — это допустимо (System User, свежий ключ).
    }
  } else if (cookiesJson) {
    try {
      const blob = readCookieBlob(cookiesJson);
      cookies = Array.isArray(blob.cookies) ? blob.cookies : [];
      raw = await extractTokenFromCookies(cookiesJson, proxyUrl || null);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  } else {
    return { ok: false, error: 'Вставь токен или куки — без одного из них подключать нечего' };
  }

  if (raw.length < 20) {
    return { ok: false, error: 'Токен слишком короткий — похоже, скопировался не весь' };
  }

  const cookieHeader = cookies.length
    ? cookieHeaderOf(cookies as { name?: unknown; value?: unknown }[])
    : null;

  // Токен проверяем сразу, ровно тем же способом, каким потом ходит
  // синхронизация: тот же токен, те же куки, тот же прокси. Если проверка
  // прошла — значит и цифры потянутся.
  let found;
  try {
    found = await checkToken(raw, { proxyUrl: proxyUrl || null, cookie: cookieHeader });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }

  const created = await prisma.adToken.create({
    data: {
      buyerId,
      label: label || found.name,
      token: raw,
      // Куки — часть доступа, а не удобство: без них токен не работает.
      // Храним нормализованным JSON-массивом, чтобы синхронизация собрала из
      // них тот же заголовок.
      cookiesJson: cookies.length ? JSON.stringify(cookies) : null,
      proxyUrl: proxyUrl || null,
    },
  });

  // Кабинеты записываем сразу — иначе до первой синхронизации в настройках
  // пусто, и непонятно, сработало вообще или нет.
  for (const acc of found.accounts) {
    await prisma.adAccount.create({
      data: {
        tokenId: created.id,
        externalId: acc.externalId,
        name: acc.name,
        currency: acc.currency,
        accountStatus: acc.accountStatus,
        disableReason: acc.disableReason,
      },
    });
  }

  revalidatePath('/admin');
  revalidatePath('/ads');
  return { ok: true, message: `${found.name}: кабинетов найдено ${found.accounts.length}` };
}

/**
 * Баер привязывает СВОЙ кабинет сам, из раздела «Реклама». Никакого выбора
 * баера тут нет — токен всегда вешается на того, кто его добавляет.
 */
export async function addMyToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.buyer) return { ok: false, error: 'У аккаунта нет профиля баера' };

  const token = String(form.get('token') ?? '').trim();
  const label = String(form.get('label') ?? '').trim().slice(0, 80);
  const proxy = parseProxy(String(form.get('proxyUrl') ?? ''), (form.get('proxyKind') as ProxyKind) ?? 'http');
  if (proxy && 'error' in proxy) return { ok: false, error: proxy.error };
  const proxyUrl = proxy?.url ?? '';
  if (token.length < 20) {
    return { ok: false, error: 'Токен слишком короткий — похоже, скопировался не весь' };
  }

  // Мультитокен из антидетекта несёт куки — они и есть доступ к арендованному
  // кабинету, храним и подставляем их так же, как в админской форме.
  let cookies: unknown[] = [];
  try {
    const blob = readCookieBlob(token);
    if (Array.isArray(blob.cookies)) cookies = blob.cookies;
  } catch {
    // плоский токен без кук — допустимо
  }
  const cookieHeader = cookies.length
    ? cookieHeaderOf(cookies as { name?: unknown; value?: unknown }[])
    : null;

  let found;
  try {
    found = await checkToken(token, { proxyUrl: proxyUrl || null, cookie: cookieHeader });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }

  const created = await prisma.adToken.create({
    data: {
      buyerId: user.buyer.id,
      label: label || found.name,
      token,
      cookiesJson: cookies.length ? JSON.stringify(cookies) : null,
      proxyUrl: proxyUrl || null,
    },
  });
  for (const acc of found.accounts) {
    await prisma.adAccount.create({
      data: {
        tokenId: created.id,
        externalId: acc.externalId,
        name: acc.name,
        currency: acc.currency,
        accountStatus: acc.accountStatus,
        disableReason: acc.disableReason,
      },
    });
  }

  revalidatePath('/ads');
  revalidatePath('/admin');
  revalidatePath('/ads');
  return { ok: true, message: `${found.name}: кабинетов найдено ${found.accounts.length}` };
}

/** Свой токен баер может и удалить — только свой. */
export async function deleteMyToken(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  const token = id ? await prisma.adToken.findUnique({ where: { id } }) : null;
  // Чужой токен не трогаем: удалять можно только то, что привязано к себе.
  if (token && user.buyer && token.buyerId === user.buyer.id) {
    await prisma.adToken.delete({ where: { id } });
  }
  revalidatePath('/ads');
}

export async function deleteToken(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (id) await prisma.adToken.delete({ where: { id } });
  revalidatePath('/admin');
  revalidatePath('/ads');
}

export async function toggleToken(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const token = await prisma.adToken.findUnique({ where: { id } });
  if (token) {
    await prisma.adToken.update({ where: { id }, data: { enabled: !token.enabled } });
  }
  revalidatePath('/admin');
  revalidatePath('/ads');
}

/**
 * Переименовать подпись токена. Имя профиля подставляется автоматически при
 * добавлении, но человек всегда может поправить — прямо в строке кабинета,
 * без переподключения и без лишних запросов к Facebook.
 */
export async function renameToken(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const label = String(form.get('label') ?? '').trim().slice(0, 80);
  if (id) await prisma.adToken.update({ where: { id }, data: { label } });
  revalidatePath('/admin');
  revalidatePath('/ads');
}

/**
 * Подкинуть НОВЫЙ токен существующему профилю, не отвязывая его.
 *
 * Сессионный ключ из антидетекта живёт недолго и слетает. Раньше приходилось
 * отвязывать профиль и заводить заново — терялись подписи, флаги агентских,
 * привязки. Теперь просто вставляем свежий мультитокен: куки/ua/прокси берём из
 * него (или оставляем прежний прокси), проверяем и обновляем на месте, снимая
 * пометку об ошибке и паузу. Кабинеты доосвежаем, не трогая их флаги.
 */
async function applyNewToken(
  tokenId: string,
  rawIn: string,
  proxyOverride: { url: string } | null,
): Promise<ActionState> {
  const raw = rawIn.trim();
  if (raw.length < 20) {
    return { ok: false, error: 'Токен слишком короткий — похоже, скопировался не весь' };
  }
  const existing = await prisma.adToken.findUnique({ where: { id: tokenId } });
  if (!existing) return { ok: false, error: 'Профиль не найден' };

  // Куки достаём из мультитокена; плоский ключ без кук — оставим прежние куки.
  let cookies: unknown[] = [];
  try {
    const blob = readCookieBlob(raw);
    if (Array.isArray(blob.cookies)) cookies = blob.cookies;
  } catch {
    // плоский токен без кук — допустимо
  }
  const proxyUrl = proxyOverride ? proxyOverride.url : existing.proxyUrl ?? '';
  const cookieHeader = cookies.length
    ? cookieHeaderOf(cookies as { name?: unknown; value?: unknown }[])
    : null;

  let found;
  try {
    found = await checkToken(raw, { proxyUrl: proxyUrl || null, cookie: cookieHeader });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }

  await prisma.adToken.update({
    where: { id: tokenId },
    data: {
      token: raw,
      cookiesJson: cookies.length ? JSON.stringify(cookies) : existing.cookiesJson,
      proxyUrl: proxyUrl || null,
      status: 'ACTIVE',
      lastError: '',
      pausedUntil: null,
      enabled: true,
    },
  });

  // Кабинеты доосвежаем upsert-ом: новые добавятся, у старых обновится статус, а
  // флаги (в трекинге / агентский) не тронутся.
  for (const acc of found.accounts) {
    await prisma.adAccount.upsert({
      where: { tokenId_externalId: { tokenId, externalId: acc.externalId } },
      update: {
        name: acc.name,
        currency: acc.currency,
        accountStatus: acc.accountStatus,
        disableReason: acc.disableReason,
      },
      create: {
        tokenId,
        externalId: acc.externalId,
        name: acc.name,
        currency: acc.currency,
        accountStatus: acc.accountStatus,
        disableReason: acc.disableReason,
      },
    });
  }

  revalidatePath('/ads');
  revalidatePath('/admin');
  return { ok: true, message: `${found.name}: кабинетов ${found.accounts.length} — токен обновлён` };
}

/** Админ: обновить токен любого профиля. */
export async function replaceToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const token = String(form.get('token') ?? '');
  const proxy = parseProxy(String(form.get('proxyUrl') ?? ''), (form.get('proxyKind') as ProxyKind) ?? 'http');
  if (proxy && 'error' in proxy) return { ok: false, error: proxy.error };
  return applyNewToken(id, token, proxy ?? null);
}

/** Баер: обновить токен только своего профиля. */
export async function replaceMyToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.buyer) return { ok: false, error: 'У аккаунта нет профиля баера' };
  const id = String(form.get('id') ?? '');
  const t = id ? await prisma.adToken.findUnique({ where: { id } }) : null;
  if (!t || t.buyerId !== user.buyer.id) return { ok: false, error: 'Это не твой профиль' };
  const token = String(form.get('token') ?? '');
  const proxy = parseProxy(String(form.get('proxyUrl') ?? ''), (form.get('proxyKind') as ProxyKind) ?? 'http');
  if (proxy && 'error' in proxy) return { ok: false, error: proxy.error };
  return applyNewToken(id, token, proxy ?? null);
}

/** Админ-диагностика Brocard: сырой ответ по балансу/счетам/картам. */
export async function brocardProbe(): Promise<{ ok: boolean; error?: string; data?: Record<string, string> }> {
  await requireAdmin();
  const cfg = await prisma.brocardConfig.findFirst();
  if (!cfg?.apiKey) return { ok: false, error: 'Ключ Brocard не задан.' };
  try {
    const data = await probeBalances(cfg.apiKey);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e instanceof BrocardError ? e.message : `Сбой: ${(e as Error).message}` };
  }
}

/** Счета Brocard с балансами (для админской панели переводов). */
export async function brocardAccounts(): Promise<{ ok: boolean; error?: string; accounts?: BrocardAccount[] }> {
  await requireAdmin();
  const cfg = await prisma.brocardConfig.findFirst();
  if (!cfg?.apiKey) return { ok: false, error: 'Ключ Brocard не задан.' };
  try {
    const accounts = await listAccounts(cfg.apiKey);
    return { ok: true, accounts };
  } catch (e) {
    return { ok: false, error: e instanceof BrocardError ? e.message : `Сбой: ${(e as Error).message}` };
  }
}

/**
 * Перевод денег Brocard: Общак → счёт баера. Живые деньги, поэтому:
 * тянем свежие счета, проверяем что источник = общий (team), сумма > 0 и не
 * больше доступного на Общаке, пишем лог. Возвращаем результат для UI.
 */
export async function brocardTransfer(form: FormData): Promise<{ ok: boolean; error?: string; message?: string }> {
  const user = await requireAdmin();
  const fromAcc = String(form.get('fromAcc') ?? '').trim();
  const toAcc = String(form.get('toAcc') ?? '').trim();
  const amount = Math.round(Number(form.get('amount') ?? 0) * 100) / 100;
  const comment = String(form.get('comment') ?? '').trim();
  if (!fromAcc) return { ok: false, error: 'Не выбран счёт-источник.' };
  if (!toAcc) return { ok: false, error: 'Не выбран счёт получателя.' };
  if (fromAcc === toAcc) return { ok: false, error: 'Счета источника и получателя совпадают.' };
  if (!Number.isFinite(amount) || amount < 0.01) return { ok: false, error: 'Сумма должна быть от $0.01.' };

  const cfg = await prisma.brocardConfig.findFirst();
  if (!cfg?.apiKey) return { ok: false, error: 'Ключ Brocard не задан.' };

  // Свежие счета — чтобы проверять по реальному балансу, а не по кэшу.
  let accounts: BrocardAccount[];
  try {
    accounts = await listAccounts(cfg.apiKey);
  } catch (e) {
    return { ok: false, error: e instanceof BrocardError ? e.message : `Сбой чтения счетов: ${(e as Error).message}` };
  }

  // Источник и получатель — любые выбранные счета.
  const source = accounts.find((a) => a.id === fromAcc);
  if (!source) return { ok: false, error: 'Счёт-источник не найден.' };
  const target = accounts.find((a) => a.id === toAcc);
  if (!target) return { ok: false, error: 'Счёт получателя не найден.' };

  const amountCents = Math.round(amount * 100);
  if (amountCents > source.availableCents) {
    return { ok: false, error: `На Общаке только $${(source.availableCents / 100).toFixed(2)} — меньше запрошенного.` };
  }

  // Сопоставим получателя с баером по команде — для лога и будущей плитки.
  const teamLink = target.teamId
    ? await prisma.brocardTeam.findUnique({ where: { externalId: target.teamId }, select: { buyerId: true } })
    : null;

  try {
    const { raw } = await createTransfer(cfg.apiKey, {
      from: source.id,
      to: target.id,
      amount,
      // currency не передаём — Brocard определяет по счетам (см. createTransfer).
      comment: comment || 'Пополнение с общего счёта',
    });
    await prisma.brocardTransfer.create({
      data: {
        fromAcc: source.id, toAcc: target.id, buyerId: teamLink?.buyerId ?? null,
        amountCents, currency: target.currency || 'USD', comment,
        status: 'ok', respJson: raw, actorId: user.id, actorName: user.name,
      },
    });
    revalidatePath('/admin');
    revalidatePath('/');
    const who = target.teamName || target.ownerEmail || target.id;
    return { ok: true, message: `Переведено $${amount.toFixed(2)} → ${who}.` };
  } catch (e) {
    const err = e instanceof BrocardError ? e.message : `Сбой перевода: ${(e as Error).message}`;
    await prisma.brocardTransfer.create({
      data: {
        fromAcc: source.id, toAcc: target.id, buyerId: teamLink?.buyerId ?? null,
        amountCents, currency: target.currency || 'USD', comment,
        status: 'error', error: err, actorId: user.id, actorName: user.name,
      },
    });
    return { ok: false, error: err };
  }
}

export async function toggleAccount(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const acc = await prisma.adAccount.findUnique({ where: { id } });
  if (acc) await prisma.adAccount.update({ where: { id }, data: { enabled: !acc.enabled } });
  revalidatePath('/admin');
  revalidatePath('/ads');
}

/**
 * Пометить кабинет агентским/основным среди дублей. Один act_ID виден под
 * несколькими профилями; помеченный считается за настоящий, дубли под другими
 * токенами уходят из подсчёта и сворачиваются.
 */
export async function toggleAgency(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const acc = id ? await prisma.adAccount.findUnique({ where: { id } }) : null;
  if (acc) await prisma.adAccount.update({ where: { id }, data: { agency: !acc.agency } });
  revalidatePath('/ads');
  revalidatePath('/admin');
}

const TrackerInput = z.object({
  baseUrl: z.string().trim().url('Адрес трекера должен быть полным: https://…'),
  apiKey: z.string().trim().min(8, 'Ключ слишком короткий'),
});

export async function saveTracker(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = TrackerInput.safeParse({
    baseUrl: form.get('baseUrl'),
    apiKey: form.get('apiKey'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поля' };
  }

  let found;
  try {
    found = await checkTracker(parsed.data.baseUrl, parsed.data.apiKey);
  } catch (e) {
    return { ok: false, error: e instanceof KeitaroError ? e.message : (e as Error).message };
  }

  const existing = await prisma.tracker.findFirst();
  if (existing) {
    await prisma.tracker.update({ where: { id: existing.id }, data: { ...parsed.data, lastError: '' } });
  } else {
    await prisma.tracker.create({ data: parsed.data });
  }

  // Группы заводим сразу, чтобы было что привязывать к баерам.
  for (const g of found.groups) {
    await prisma.trackerGroup.upsert({
      where: { externalId: g.id },
      update: { name: g.name, lastSeenAt: new Date() },
      create: { externalId: g.id, name: g.name, lastSeenAt: new Date() },
    });
  }

  revalidatePath('/admin');
  revalidatePath('/ads');
  return {
    ok: true,
    message: `Кампаний ${found.campaigns}, групп ${found.groups.length}`,
  };
}

export async function linkGroup(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const buyerId = String(form.get('buyerId') ?? '');
  if (id) {
    await prisma.trackerGroup.update({
      where: { id },
      data: { buyerId: buyerId || null },
    });
  }
  revalidatePath('/admin');
  revalidatePath('/ads');
}

const BrocardInput = z.object({
  apiKey: z.string().trim().min(8, 'Ключ слишком короткий'),
});

export async function saveBrocard(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = BrocardInput.safeParse({ apiKey: form.get('apiKey') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поле' };
  }

  let found;
  try {
    found = await checkBrocard(parsed.data.apiKey);
  } catch (e) {
    return { ok: false, error: e instanceof BrocardError ? e.message : (e as Error).message };
  }

  const existing = await prisma.brocardConfig.findFirst();
  if (existing) {
    await prisma.brocardConfig.update({
      where: { id: existing.id },
      data: { apiKey: parsed.data.apiKey, enabled: true, lastError: '' },
    });
  } else {
    await prisma.brocardConfig.create({ data: { apiKey: parsed.data.apiKey } });
  }

  // Команды заводим сразу — будет что привязывать к баерам.
  for (const t of found.teams) {
    await prisma.brocardTeam.upsert({
      where: { externalId: t.id },
      update: { name: t.name, lastSeenAt: new Date() },
      create: { externalId: t.id, name: t.name, lastSeenAt: new Date() },
    });
  }

  revalidatePath('/admin');
  revalidatePath('/ads');
  return { ok: true, message: `Команд найдено: ${found.teams.length}` };
}

export async function linkBrocardTeam(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const buyerId = String(form.get('buyerId') ?? '');
  if (id) {
    // «Расходники на команду» — общак: расход не идёт баеру, а копится отдельно.
    // Обычный баер снимает флаг общака; пусто — ни того, ни другого.
    const overhead = buyerId === BROCARD_OVERHEAD;
    await prisma.brocardTeam.update({
      where: { id },
      data: { buyerId: overhead ? null : buyerId || null, overhead },
    });
  }
  revalidatePath('/admin');
  revalidatePath('/ads');
  revalidatePath('/');
}

/**
 * Обновить ТОЛЬКО кампании с Facebook — без Keitaro и Brocard. Кнопка на
 * странице кампаний: когда нужна свежая картина по рекламе, а доход/расход
 * дёргать незачем.
 */
export async function runCampaignSync() {
  await requireAdmin();
  const result = await syncFacebookCampaigns();
  revalidatePath('/ads/campaigns');
  return result;
}

/**
 * Обновить расход по объявлениям и привязку к потокам Keitaro — для экрана ROI.
 * Лишние запросы к ФБ, поэтому это отдельная кнопка, а не часть общего синка.
 */
/**
 * Статус фонового обновления статы. Лежит в Setting одной JSON-строкой, чтобы
 * кнопка на экране могла опрашивать прогресс, а сам заход шёл в фоне и не держал
 * http-запрос (иначе браузер рвёт соединение по таймауту — «NetworkError»).
 */
const ADS_SYNC_KEY = 'ads_sync_status';
// Заход завис/сервер перезапустился — через это время считаем «running» протухшим
// и разрешаем новый запуск, иначе кнопка залипнет навсегда.
const ADS_SYNC_STALE_MS = 20 * 60 * 1000;

export type AdsSyncStatus = {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  touched: number;
  skipped: number;
  problems: string[];
  info: string[];
};

const emptyAdsStatus = (): AdsSyncStatus => ({
  running: false, startedAt: null, finishedAt: null, touched: 0, skipped: 0, problems: [], info: [],
});

async function readAdsStatus(): Promise<AdsSyncStatus> {
  const row = await prisma.setting.findUnique({ where: { key: ADS_SYNC_KEY } });
  if (!row) return emptyAdsStatus();
  try {
    return { ...emptyAdsStatus(), ...(JSON.parse(row.value) as AdsSyncStatus) };
  } catch {
    return emptyAdsStatus();
  }
}

async function writeAdsStatus(s: AdsSyncStatus) {
  await prisma.setting.upsert({
    where: { key: ADS_SYNC_KEY },
    create: { key: ADS_SYNC_KEY, value: JSON.stringify(s) },
    update: { value: JSON.stringify(s) },
  });
}

/** Текущий статус для опроса кнопкой. */
export async function adsSyncStatus(): Promise<AdsSyncStatus> {
  await requireAdmin();
  const s = await readAdsStatus();
  // Протухший «running» (сервер падал во время захода) показываем как не идущий.
  if (s.running && s.startedAt && Date.now() - s.startedAt > ADS_SYNC_STALE_MS) {
    return { ...s, running: false };
  }
  return s;
}

// Полная синхронизация (Brocard + Keitaro + Facebook) — тот же приём, что и у
// статы: работу уносим в фон, статус кладём в Setting, кнопка опрашивает. Иначе
// синхронный заход на минуты рвёт соединение и роняет страницу («ошибка
// отрисовки»).
const FULL_SYNC_KEY = 'full_sync_status';

async function readFullStatus(): Promise<AdsSyncStatus> {
  const row = await prisma.setting.findUnique({ where: { key: FULL_SYNC_KEY } });
  if (!row) return emptyAdsStatus();
  try {
    return { ...emptyAdsStatus(), ...(JSON.parse(row.value) as AdsSyncStatus) };
  } catch {
    return emptyAdsStatus();
  }
}

async function writeFullStatus(s: AdsSyncStatus) {
  await prisma.setting.upsert({
    where: { key: FULL_SYNC_KEY },
    create: { key: FULL_SYNC_KEY, value: JSON.stringify(s) },
    update: { value: JSON.stringify(s) },
  });
}

export async function fullSyncStatus(): Promise<AdsSyncStatus> {
  await requireAdmin();
  const s = await readFullStatus();
  if (s.running && s.startedAt && Date.now() - s.startedAt > ADS_SYNC_STALE_MS) {
    return { ...s, running: false };
  }
  return s;
}

/**
 * Запустить обновление статы В ФОНЕ и сразу отпустить браузер.
 *
 * Раньше это был синхронный server action: клиент ждал ответа минуты, а полный
 * заход (14 дней × десятки кабинетов с паузами против чекпоинта) не укладывался
 * в таймаут соединения — браузер рвал запрос с «NetworkError», а сам заход
 * прерывался на полпути (оттого и расход не долетал до Keitaro). Теперь запуск
 * мгновенный: работу уносим в `after()` (выполнится после ответа, на живом
 * Node-сервере доходит до конца), а прогресс и итог кладём в Setting — кнопка
 * их опрашивает через `adsSyncStatus()`.
 *
 * Тянем последние 3 дня и с `allAds` (и объявления без открута): полную базу
 * за 14 дней уже загрузили, а свежий расход меняется только в хвосте — глубже
 * дни залиты и перезаписывать их каждый раз незачем, так заход быстрый и не
 * рвётся. Разовую глубокую догрузку делаем кроном `/api/sync?only=ads&days=14`.
 */
const ADS_REFRESH_DAYS = 3;

export async function runAdsSync(): Promise<{ started: boolean; running: boolean }> {
  await requireAdmin();

  const prev = await readAdsStatus();
  const stale = prev.startedAt ? Date.now() - prev.startedAt > ADS_SYNC_STALE_MS : true;
  if (prev.running && !stale) {
    // Уже идёт — второй заход не плодим (два синка на одни кабинеты = чекпоинт).
    return { started: false, running: true };
  }

  await writeAdsStatus({ ...emptyAdsStatus(), running: true, startedAt: Date.now() });

  after(async () => {
    let result;
    try {
      result = await syncFacebookAds(ADS_REFRESH_DAYS, { allAds: true });
    } catch (e) {
      result = { touched: 0, skipped: 0, problems: [`Сбой обновления статы: ${(e as Error).message}`], info: [], orphanCents: 0 };
    }
    await writeAdsStatus({
      running: false,
      startedAt: prev.startedAt ?? Date.now(),
      finishedAt: Date.now(),
      touched: result.touched,
      skipped: result.skipped,
      problems: result.problems,
      info: result.info,
    });
    revalidatePath('/ads/campaigns');
  });

  return { started: true, running: true };
}

/**
 * Управление рекламой из таблицы кампаний. Находим объявление, поднимаем доступ
 * его токена (ключ+куки+прокси) и шлём команду в Facebook. Право: админ — любые,
 * баер — только свои объявления.
 */
async function adAccessFor(adId: string) {
  const user = await requireUser();
  const ad = await prisma.fbAd.findUnique({
    where: { id: adId },
    include: { adAccount: { include: { adToken: { include: { buyer: true } } } } },
  });
  if (!ad) return { error: 'Объявление не найдено' as const };
  const tok = ad.adAccount.adToken;
  const admin = (user.role as string) === 'ADMIN';
  const own = user.buyer && tok.buyerId === user.buyer.id;
  if (!admin && !own) return { error: 'Это не твоё объявление' as const };
  const { token: access, net } = fbAccess(tok.token, { cookiesJson: tok.cookiesJson, proxyUrl: tok.proxyUrl });
  return { ad, access, net, tok };
}

/**
 * Выполнить действие в Facebook с авто-восстановлением протухшей сессии.
 *
 * Сессионный ключ антидетекта живёт недолго; на «код 1» (сессия кончилась) или
 * протухший токен достаём свежий ключ из кук того же профиля (как в синке) и
 * повторяем один раз. Так пауза/бюджет/дубли не падают на живом кабинете
 * только потому, что ключ устарел между заходами.
 */
async function withFreshToken<T>(
  ctx: { access: string; net: FbNet; tok: { id: string; token: string; cookiesJson: string | null; proxyUrl: string | null } },
  fn: (access: string, net: FbNet) => Promise<T>,
): Promise<T> {
  try {
    return await fn(ctx.access, ctx.net);
  } catch (e) {
    const refreshable = (e instanceof FbError && e.code === 1) || fbErrorKind(e) === 'token';
    if (refreshable && ctx.tok.cookiesJson) {
      // Рефреш может сам упасть (куки тоже мертвы, 400 при извлечении ключа).
      // Тогда НЕ показываем ошибку рефреша — она сбивает с толку; отдаём
      // исходную («сессия кончилась»), она подсказывает обновить токен.
      try {
        if (await refreshTokenFromCookies(ctx.tok)) {
          const { token: access, net } = fbAccess(ctx.tok.token, { cookiesJson: ctx.tok.cookiesJson, proxyUrl: ctx.tok.proxyUrl });
          return await fn(access, net);
        }
      } catch {
        /* рефреш не удался — ниже бросаем исходную ошибку */
      }
    }
    throw e;
  }
}

export type AdActionState = { ok: boolean; error?: string } | null;

/** Пауза/запуск объявления. `status` приходит из формы. */
export async function setAdRunning(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const status = String(form.get('status') ?? '') === 'ACTIVE' ? 'ACTIVE' : 'PAUSED';
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    await withFreshToken(ctx, async (a, n) => {
      // При ЗАПУСКЕ поднимаем и родителей: у дубля кампания и адсет на паузе,
      // и объявление числится «запущено», но не крутится. setAdStatus шлёт
      // status на любой объект, поэтому им же включаем кампанию и адсет.
      // На ПАУЗЕ трогаем только само объявление — соседние в адсете/кампании
      // должны продолжать работать.
      if (status === 'ACTIVE') {
        const campId = ctx.ad.campaignId || (await adCampaignId(a, ctx.ad.adId, n));
        if (campId) await setAdStatus(a, campId, 'ACTIVE', n);
        if (ctx.ad.adsetId) await setAdStatus(a, ctx.ad.adsetId, 'ACTIVE', n);
      }
      await setAdStatus(a, ctx.ad.adId, status, n);
    });
    await prisma.fbAd.update({ where: { id }, data: { status } });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

/** Сменить дневной бюджет адсета объявления (в долларах из формы). */
export async function setAdBudget(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const dollars = Number(String(form.get('budget') ?? '').replace(',', '.'));
  if (!Number.isFinite(dollars) || dollars <= 0) return { ok: false, error: 'Некорректный бюджет' };
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const target = ctx.ad.budgetTargetId || ctx.ad.adsetId;
  if (!target) return { ok: false, error: 'Не найден объект бюджета (адсет/кампания)' };
  try {
    await withFreshToken(ctx, (a, n) => setAdsetBudget(a, target, Math.round(dollars * 100), n));
    await prisma.fbAd.update({ where: { id }, data: { dailyBudget: Math.round(dollars * 100) } });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

/**
 * Дублировать объект N раз (на паузе). `level` — что копируем: объявление,
 * адсет или всю кампанию. Кампания/адсет собираются по частям (обход лимита FB).
 */
export async function duplicateAction(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const level = String(form.get('level') ?? 'ad'); // ad | adset | campaign
  const cap = level === 'campaign' ? 3 : 20;
  const count = Math.min(cap, Math.max(1, Math.round(Number(String(form.get('count') ?? '1')) || 1)));
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  let campId = '';
  try {
    for (let i = 0; i < count; i += 1) {
      if (level === 'campaign') {
        campId = campId || (await withFreshToken(ctx, (a, n) => adCampaignId(a, ctx.ad.adId, n)));
        if (!campId) return { ok: false, error: 'Не нашёл кампанию объявления' };
        await withFreshToken(ctx, (a, n) => duplicateCampaign(a, campId, n));
      } else if (level === 'adset') {
        if (!ctx.ad.adsetId) return { ok: false, error: 'Не нашёл адсет объявления' };
        await withFreshToken(ctx, (a, n) => duplicateAdset(a, ctx.ad.adsetId, n));
      } else {
        await withFreshToken(ctx, (a, n) => duplicateAd(a, ctx.ad.adId, n));
      }
    }
  } catch (e) {
    let msg = e instanceof FbError ? e.message : (e as Error).message;
    // «код 1» на копии кампании обычно не про сессию — частая причина —
    // спец-категория: её FB копировать через API не даёт. Скажем прямо.
    if (level === 'campaign' && e instanceof FbError && e.code === 1 && campId) {
      try {
        const info = await campaignInfo(ctx.access, campId, ctx.net);
        if (info.specialAdCategories.length) {
          msg = `Кампания в спец-категории (${info.specialAdCategories.join(', ')}) — Facebook не даёт копировать её через API. Скопируй вручную в Ads Manager.`;
        }
      } catch { /* не уточнили — оставляем исходный текст */ }
    }
    return { ok: false, error: msg };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

/** Переименовать объявление. */
export async function renameAdAction(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Пустое имя' };
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    await withFreshToken(ctx, (a, n) => renameAd(a, ctx.ad.adId, name, n));
    await prisma.fbAd.update({ where: { id }, data: { name } });
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

/** Перемодерация: минимальная правка текста (переключить точку в конце) —
 *  Facebook отправит объявление на проверку заново. */
export async function remoderateAd(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    await withFreshToken(ctx, (a, n) => applyAdText(a, ctx.ad.adAccount.externalId, ctx.ad.adId, { mode: 'period' }, n));
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

/** Текущие тексты объявления — для префилла формы смены текста. */
export async function getAdText(id: string): Promise<{ ok: boolean; error?: string } & Partial<AdText>> {
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    const t = await withFreshToken(ctx, (a, n) => getAdCreative(a, ctx.ad.adId, n));
    return { ok: true, ...t };
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
}

/** Сменить тексты объявления (создаётся новый креатив → уходит на ре-модерацию). */
export async function setAdText(_prev: AdActionState, form: FormData): Promise<AdActionState> {
  const id = String(form.get('id') ?? '');
  const message = String(form.get('message') ?? '');
  const headline = String(form.get('headline') ?? '');
  const description = String(form.get('description') ?? '');
  const ctx = await adAccessFor(id);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    await withFreshToken(ctx, (a, n) =>
      applyAdText(a, ctx.ad.adAccount.externalId, ctx.ad.adId, { mode: 'text', message, headline, description }, n),
    );
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
  revalidatePath('/ads/campaigns');
  return { ok: true };
}

export async function runSync(): Promise<{ started: boolean; running: boolean }> {
  await requireAdmin();

  const prev = await readFullStatus();
  const stale = prev.startedAt ? Date.now() - prev.startedAt > ADS_SYNC_STALE_MS : true;
  if (prev.running && !stale) {
    return { started: false, running: true };
  }

  await writeFullStatus({ ...emptyAdsStatus(), running: true, startedAt: Date.now() });

  after(async () => {
    let result;
    try {
      result = await syncAll();
    } catch (e) {
      result = { touched: 0, skipped: 0, problems: [`Сбой синхронизации: ${(e as Error).message}`], info: [], orphanCents: 0 };
    }
    await writeFullStatus({
      running: false,
      startedAt: prev.startedAt ?? Date.now(),
      finishedAt: Date.now(),
      touched: result.touched,
      skipped: result.skipped,
      problems: result.problems,
      info: result.info,
    });
    revalidatePath('/admin');
    revalidatePath('/ads');
    revalidatePath('/days');
    revalidatePath('/');
  });

  return { started: true, running: true };
}
