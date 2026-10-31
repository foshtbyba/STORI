'use server';

import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { validPlacementKeys, placementSummary, stripPlacementValue, stripInstagramFamily } from '@/lib/placements';
import { isLocale, localeName, geoDefaultLocale } from '@/lib/locales';
import { logActivity } from '@/lib/activity';
import {
  fbAccess,
  listPages,
  pagesOwnerBusiness,
  listAdAccountCreativePageIds,
  listPromotePages,
  listPixels,
  createPixel,
  createPage,
  createCampaign,
  createAdset,
  uploadAdImage,
  createAdCreative,
  ENHANCEMENT_OPTOUT_KEYS,
  createAd,
  setAdStatus,
  getAdsetPlacements,
  stripAdsetInstagram,
  searchRegions,
  searchCities,
  getPageName,
  resolveInstagramActor,
  bindCardToAccount,
  uploadVideo,
  isVideoReady,
  uploadVideoByUrl,
  waitVideoReady,
  videoThumbnailUrl,
  createVideoAdCreative,
  createMultiLangVideoCreative,
  resolveLocaleId,
  VIDEO_ENHANCEMENT_OPTOUT_KEYS,
  FbError,
  type LangVariant,
  type FbNet,
  type CardInput,
  type CardBindMethod,
} from '@/lib/fb';

/**
 * Автозалив — оркестрация создания кампании в Facebook по шаблону гео.
 *
 * Собирает всю цепочку из примитивов fb.ts: кампания → адсет → (для каждого
 * креатива) картинка → креатив → объявление. По умолчанию всё создаётся НА
 * ПАУЗЕ; «сразу в актив» и «по расписанию» — осознанный выбор в форме, деньги
 * трогает только он.
 *
 * Право: админ — на любой кабинет, баер — только на свои (токен его). Шаблоны
 * гео заводит и правит админ.
 */

const CTA_OPTIONS = [
  'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'SUBSCRIBE', 'GET_OFFER', 'DOWNLOAD',
  'BOOK_TRAVEL', 'CONTACT_US', 'APPLY_NOW', 'ORDER_NOW', 'GET_QUOTE',
];
const EVENT_OPTIONS = [
  'LEAD', 'PURCHASE', 'COMPLETE_REGISTRATION', 'SUBSCRIBE', 'ADD_TO_CART',
  'INITIATE_CHECKOUT', 'SUBMIT_APPLICATION', 'CONTACT',
];

/**
 * Цель кампании под событие пикселя. ФБ не даёт оптимизироваться на LEAD внутри
 * OUTCOME_SALES (код 100/2446814) — лид-события живут в OUTCOME_LEADS, покупки
 * и корзина — в OUTCOME_SALES. Всё остальное по умолчанию — лиды.
 */
function objectiveForEvent(event: string): string {
  const sales = ['PURCHASE', 'ADD_TO_CART', 'INITIATE_CHECKOUT', 'ADD_PAYMENT_INFO', 'SUBSCRIBE', 'START_TRIAL'];
  return sales.includes(event) ? 'OUTCOME_SALES' : 'OUTCOME_LEADS';
}

/**
 * «Кабинету нужно подтвердить телефон» (код 31/3858013). ФБ блокирует не создание,
 * а запуск в актив. Ловим по субкоду и по тексту, чтобы создать на паузе и не
 * ронять залив — телефон подтверждают в кабинете один раз, потом включают.
 */
function isPhoneError(e: unknown): boolean {
  const sub = e instanceof FbError ? e.subcode : undefined;
  if (sub === 3858013) return true;
  const msg = (e as Error)?.message ?? '';
  return /подтверд\w*\s+(номер\s+)?телефон|confirm\s+\w*\s*phone|phone number for this ad account/i.test(msg);
}

/** Короткий случайный суффикс: уникализирует имена, чтобы ФБ не считал заливки
 *  дублями и не резал их. */
function rand(n = 4) {
  return Math.random().toString(36).slice(2, 2 + n);
}

/** CSV «US, DE ,fr» → ['US','DE','FR']. Пусто/мусор — []. */
function csvUpper(s: string): string[] {
  return s
    .split(/[,\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * Названия мест (регионов/городов) из текста «Madeira, Azores» или
 * «LAS CONDES; PROVIDENCIA; NUNOA» → массив имён. Разделители — запятая, точка
 * с запятой и перевод строки (в названии бывают пробелы: «Community of Madrid»,
 * «Puente Alto»), регистр сохраняем. Пусто/мусор — [].
 */
function regionNames(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 100);
}

// ── Шаблоны гео (личные — у каждого свои) ──────────────────────────────────

export type TemplateState = { ok: boolean; error?: string } | null;

export async function saveTemplate(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const user = await requireUser();
  const id = String(form.get('id') ?? '').trim();
  const name = String(form.get('name') ?? '').trim();
  if (!name) return { ok: false, error: 'Название шаблона пустое' };
  const countries = csvUpper(String(form.get('countries') ?? '')).join(',');
  if (!countries) return { ok: false, error: 'Укажи хотя бы одну страну (напр. US)' };
  const excluded = csvUpper(String(form.get('excluded') ?? '')).join(',');
  // Регионы вписывают названиями («Madeira, Azores») — не коды. Ключи FB
  // подставим при заливе (резолвим имя → region key токеном кабинета). Регистр
  // не трогаем: имена регионов регистрозависимы для поиска.
  const excludedRegions = regionNames(String(form.get('excludedRegions') ?? '')).join(', ');
  // Города (комуны) — отдельным полем: FB исключает их иначе, чем регионы. Имена
  // храним, ключи FB (city key) резолвим при заливе токеном кабинета.
  const excludedCities = regionNames(String(form.get('excludedCities') ?? '')).join(', ');
  const ageMin = Math.max(13, Math.min(65, Math.round(Number(form.get('ageMin')) || 18)));
  const ageMax = Math.max(ageMin, Math.min(65, Math.round(Number(form.get('ageMax')) || 65)));
  const genderRaw = String(form.get('genders') ?? ''); // ''|'1'|'2'
  const genders = genderRaw === '1' ? '1' : genderRaw === '2' ? '2' : '';
  const budget = Math.max(1, Number(String(form.get('budget') ?? '').replace(/,/g, '.')) || 20);
  const dailyBudgetCents = Math.round(budget * 100);
  const event = EVENT_OPTIONS.includes(String(form.get('event'))) ? String(form.get('event')) : 'LEAD';
  const cta = CTA_OPTIONS.includes(String(form.get('cta'))) ? String(form.get('cta')) : 'LEARN_MORE';
  const placements = validPlacementKeys(form.getAll('placements').map(String)).join(',');

  const data = { name, countries, excluded, excludedRegions, excludedCities, ageMin, ageMax, genders, dailyBudgetCents, event, cta, placements };
  try {
    if (id) {
      // Правим только свой шаблон — updateMany с фильтром по владельцу.
      const r = await prisma.uploadTemplate.updateMany({ where: { id, userId: user.id }, data });
      if (r.count === 0) return { ok: false, error: 'Это не твой шаблон' };
    } else {
      await prisma.uploadTemplate.create({ data: { ...data, userId: user.id } });
    }
  } catch {
    return { ok: false, error: 'Не удалось сохранить шаблон' };
  }
  revalidatePath('/ads/upload');
  return { ok: true };
}

export async function deleteTemplate(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const user = await requireUser();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Нет id' };
  await prisma.uploadTemplate.updateMany({ where: { id, userId: user.id }, data: { archived: true } });
  revalidatePath('/ads/upload');
  return { ok: true };
}

// ── Языки для видео-залива (личные, по пользователю) ───────────────────────

export async function saveLanguage(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const user = await requireUser();
  const id = String(form.get('id') ?? '').trim();
  const locale = String(form.get('locale') ?? '').trim();
  if (!isLocale(locale)) return { ok: false, error: 'Выбери язык из списка' };
  const videoUrl = String(form.get('videoUrl') ?? '').trim();
  if (videoUrl && !/^https?:\/\//i.test(videoUrl)) return { ok: false, error: 'Ссылка на видео должна начинаться с http(s)://' };
  const data: Record<string, unknown> = {
    locale,
    videoUrl,
    headline: String(form.get('headline') ?? '').trim(),
    primaryText: String(form.get('primaryText') ?? '').trim(),
    description: String(form.get('description') ?? '').trim(),
    link: String(form.get('link') ?? '').trim(),
  };
  // Видео файлом: если приложили — сохраняем байты. Без файла на правке старое
  // видео не трогаем.
  const file = form.get('video');
  if (file instanceof File && file.size > 0) {
    if (!/^video\//i.test(file.type)) return { ok: false, error: 'Это не видеофайл' };
    if (file.size > 75 * 1024 * 1024) return { ok: false, error: 'Видео больше 75 МБ — сожми ролик' };
    data.videoData = Buffer.from(await file.arrayBuffer());
    data.videoMime = file.type;
    data.videoName = file.name;
  }
  try {
    if (id) {
      const r = await prisma.uploadLanguage.updateMany({ where: { id, userId: user.id }, data });
      if (r.count === 0) return { ok: false, error: 'Это не твой язык' };
    } else {
      const count = await prisma.uploadLanguage.count({ where: { userId: user.id, archived: false } });
      await prisma.uploadLanguage.create({ data: { ...(data as object), userId: user.id, sort: count } as never });
    }
  } catch {
    return { ok: false, error: 'Не удалось сохранить язык' };
  }
  revalidatePath('/ads/upload');
  return { ok: true };
}

export async function deleteLanguage(_prev: TemplateState, form: FormData): Promise<TemplateState> {
  const user = await requireUser();
  const id = String(form.get('id') ?? '').trim();
  if (!id) return { ok: false, error: 'Нет id' };
  // Жёсткое удаление: видео лежит у нас на сервере, поэтому вместе со строкой
  // уходят и байты — ничего не остаётся висеть.
  await prisma.uploadLanguage.deleteMany({ where: { id, userId: user.id } });
  revalidatePath('/ads/upload');
  return { ok: true };
}

// ── Живой доступ к кабинету: страницы и пиксели ────────────────────────────

/** Найти кабинет с проверкой права и поднять доступ его токена. */
async function accountAccessFor(accountId: string) {
  const user = await requireUser();
  const acc = await prisma.adAccount.findUnique({
    where: { id: accountId },
    include: { adToken: { include: { buyer: true } } },
  });
  if (!acc) return { error: 'Кабинет не найден' as const };
  const tok = acc.adToken;
  const own = Boolean(user.buyer && tok.buyerId === user.buyer.id);
  const team = canSeeTeam(user.role as Role);
  // Свой кабинет — всегда можно. Овнеры/менеджеры — только на овнерские
  // (SKO/MPR); на кабинеты баеров заливать нельзя даже админу.
  if (!own && !(team && tok.buyer.owner)) return { error: 'На этот кабинет заливать нельзя' as const };
  const { token, net } = fbAccess(tok.token, { cookiesJson: tok.cookiesJson, proxyUrl: tok.proxyUrl });
  return { acc, tok, token, net, buyerId: user.buyer?.id ?? null, userId: user.id };
}

export type AssetPage = {
  id: string;
  name: string;
  /** Годна ли ФП для залива с ЭТОГО кабинета (разрешена + опубликована). */
  valid: boolean;
  /** Почему нельзя выбрать (для негодных): «не разрешена кабинетом» / «не опубликована». */
  reason?: string;
};

export type CabinetAssets = {
  ok: boolean;
  error?: string;
  pages?: AssetPage[];
  pixels?: { id: string; name: string }[];
  /** id только что созданного ассета — чтобы клиент выбрал именно его, а не
   *  угадывал «последний в списке» (порядок у FB не гарантирован). */
  createdId?: string;
};

/**
 * Список ФП кабинета для выпадашки.
 *
 * ОБЫЧНЫЙ аккаунт — общий список ФП токена с пометками бан/активна.
 *
 * АГЕНТСКИЙ кабинет — Ads Manager показывает ФП из БИЗНЕС-ПОРТФЕЛЯ, которому
 * принадлежат страницы (owner_business), а НЕ из бизнеса самого кабинета (у
 * арендных кабинетов это разные бизнесы). Портфель ВЫЧИСЛЯЕМ из страниц, которые
 * точно относятся к кабинету (promote + крутившиеся в объявлениях): берём их
 * owner_business и показываем все страницы этого портфеля. Если токен не отдаёт
 * owner_business (у арендных кабинетов часто #10) — портфель не определить,
 * поэтому показываем полный чистый список токена (как на обычных): неверную ФП
 * FB отобьёт на заливе кодом 1815645 — mkAd переключит на разрешённую.
 */
async function gatherCabinetPages(
  token: string, externalId: string, net: FbNet, agency: boolean,
): Promise<AssetPage[]> {
  if (!agency) {
    const [globalPages, promote] = await Promise.all([
      listPages(token, net),
      listPromotePages(token, externalId, net),
    ]);
    return annotatePages(globalPages, promote);
  }

  const [globalPages, promote, creativePageIds] = await Promise.all([
    listPages(token, net),
    listPromotePages(token, externalId, net),
    listAdAccountCreativePageIds(token, externalId, net),
  ]);
  // owner_business из списка часто пуст → добираем мульти-гетом по нодам страниц.
  const ownerById = new Map(globalPages.map((p) => [p.id, p.ownerBusinessId]));
  const allIds = [...new Set([...globalPages.map((p) => p.id), ...creativePageIds])];
  const nodeOwner = await pagesOwnerBusiness(token, allIds, net);
  for (const [id, biz] of nodeOwner) if (biz) ownerById.set(id, biz);
  // Голосуем за бизнес-портфель по owner_business подтверждённых страниц.
  const confirmed = new Set<string>([...promote.map((p) => p.id), ...creativePageIds]);
  const votes = new Map<string, number>();
  for (const id of confirmed) {
    const biz = ownerById.get(id);
    if (biz) votes.set(biz, (votes.get(biz) ?? 0) + 1);
  }
  const portfolioBiz = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const ownedByBiz = portfolioBiz ? globalPages.filter((p) => ownerById.get(p.id) === portfolioBiz) : [];

  // Портфель определился → ровно его страницы; иначе — полный список токена.
  return annotatePages(ownedByBiz.length ? ownedByBiz : globalPages, promote);
}

/**
 * Разметить ФП на годные/негодные для залива с кабинета.
 *
 * ВАЖНО: /act_/promote_pages НЕ авторитетен — он отдаёт лишь уже ПОДКЛЮЧЁННЫЕ к
 * кабинету ФП (часто 1 штука), тогда как кабинет, как и Ads Manager, крутит рекламу
 * с ЛЮБОЙ доступной и не забаненной ФП: FB сам подцепляет её при запуске. Поэтому
 * НЕ блокируем страницы по членству в promote_pages (раньше почти все получали
 * ложное «не разрешена кабинетом»). Блокируем ТОЛЬКО реально негодные:
 *  • бан/ограничение рекламы (promotion_eligible === false);
 *  • неопубликованные.
 * Членство в promote_pages используем лишь для сортировки — подключённые выше.
 */
function annotatePages(
  pages: { id: string; name: string; isPublished?: boolean; promotionEligible?: boolean; ineligibleReason?: string }[],
  promote: { id: string; name: string }[],
): AssetPage[] {
  const connected = new Set(promote.map((p) => p.id));
  const map = new Map<string, AssetPage>();
  for (const p of pages) {
    const published = p.isPublished !== false;
    const eligible = p.promotionEligible !== false; // забаненную/ограниченную FB рекламировать не даёт
    const reason = !eligible ? 'нельзя рекламировать (бан/ограничение)'
      : !published ? 'не опубликована'
      : undefined;
    map.set(p.id, { id: p.id, name: p.name, valid: published && eligible, reason });
  }
  // Разрешённые кабинетом ФП, которых нет под токеном, — тоже годны.
  for (const p of promote) if (!map.has(p.id)) map.set(p.id, { id: p.id, name: p.name, valid: true });
  const sorted = [...map.values()].sort((a, b) =>
    Number(b.valid) - Number(a.valid)
    || (Number(connected.has(b.id)) - Number(connected.has(a.id)))
    || a.name.localeCompare(b.name, 'ru'));
  // Дедуп ТОЛЬКО по id (страница может законно повторяться по имени — это разные
  // ФП). Если у РАЗНЫХ страниц одно имя — оставляем обе, но дописываем хвост id,
  // чтобы их можно было различить в выпадашке (ничего не прячем).
  const nameCount = new Map<string, number>();
  for (const p of sorted) { const k = p.name.trim().toLowerCase(); nameCount.set(k, (nameCount.get(k) ?? 0) + 1); }
  return sorted.map((p) => {
    const dup = (nameCount.get(p.name.trim().toLowerCase()) ?? 0) > 1;
    return dup ? { ...p, name: `${p.name} · …${p.id.slice(-4)}` } : p;
  });
}

/** Подтянуть живьём страницы (ФП) и пиксели кабинета — для выпадашек формы. */
export async function loadCabinetAssets(accountId: string): Promise<CabinetAssets> {
  const ctx = await accountAccessFor(accountId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    const [pages, pixels] = await Promise.all([
      gatherCabinetPages(ctx.token, ctx.acc.externalId, ctx.net, ctx.acc.agency),
      listPixels(ctx.token, ctx.acc.externalId, ctx.net),
    ]);
    return { ok: true, pages, pixels };
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
}

/** Создать новый пиксель в кабинете и вернуть обновлённый список. */
export async function makePixel(accountId: string, name: string): Promise<CabinetAssets> {
  const ctx = await accountAccessFor(accountId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const clean = name.trim() || `pixel ${rand()}`;
  try {
    const createdId = await createPixel(ctx.token, ctx.acc.externalId, clean, ctx.net);
    const pixels = await listPixels(ctx.token, ctx.acc.externalId, ctx.net);
    return { ok: true, pixels, createdId };
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
}

/**
 * Создать новую страницу (ФП) и вернуть обновлённый список страниц. Мета
 * ограничивает создание ФП через API — на урезанном токене вернётся её ошибка.
 */
export async function makePage(accountId: string, name: string): Promise<CabinetAssets> {
  const ctx = await accountAccessFor(accountId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Впиши имя новой страницы' };
  try {
    const createdId = await createPage(ctx.token, clean, 'BRAND', ctx.net);
    const pages = await gatherCabinetPages(ctx.token, ctx.acc.externalId, ctx.net, ctx.acc.agency);
    return { ok: true, pages, createdId };
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }
}

// ── Привязка карт к кабинетам ──────────────────────────────────────────────

export type CardLinkResult = { cabinetId: string; label: string; ok: boolean; message: string };

/**
 * Массовая привязка карт к выбранным кабинетам. Карта берётся по кругу: карта №1 →
 * кабинет №1, карта №2 → кабинет №2 и т.д. (как в FBTOOL). Данные карт НЕ храним
 * в базе — прокидываем в FB и забываем. Сам сетевой запрос — в fb.ts
 * (bindCardToAccount); пока он не подключён, вернём понятный статус по каждому.
 */
export async function linkCards(input: {
  accountIds: string[];
  cards: CardInput[];
  method: CardBindMethod;
  billingCountry?: string;
  currency?: string;
  timezoneId?: number;
  delaySec?: number;
  rebind?: boolean;
}): Promise<CardLinkResult[]> {
  await requireUser();
  const accountIds = (input.accountIds ?? []).filter(Boolean);
  const cards = (input.cards ?? []).filter((c) => c && c.number && c.month && c.year && c.cvc);
  if (accountIds.length === 0) return [];
  if (cards.length === 0) return accountIds.map((id) => ({ cabinetId: id, label: id, ok: false, message: 'Нет данных карты' }));

  const delayMs = Math.max(0, Math.min(600, Math.round(input.delaySec ?? 0))) * 1000;
  const out: CardLinkResult[] = [];
  for (let i = 0; i < accountIds.length; i += 1) {
    const accountId = accountIds[i];
    const card = cards[i % cards.length]; // по кругу
    const ctx = await accountAccessFor(accountId);
    if ('error' in ctx) { out.push({ cabinetId: accountId, label: accountId, ok: false, message: ctx.error ?? 'нет доступа к кабинету' }); continue; }
    const label = ctx.acc.name || ctx.acc.externalId;
    try {
      const r = await bindCardToAccount(ctx.token, ctx.acc.externalId, card, {
        method: input.method,
        billingCountry: input.billingCountry,
        currency: input.currency,
        timezoneId: input.timezoneId,
        rebind: input.rebind,
      }, ctx.net);
      out.push({ cabinetId: accountId, label, ok: r.ok, message: r.status });
    } catch (e) {
      out.push({ cabinetId: accountId, label, ok: false, message: e instanceof FbError ? e.message : (e as Error).message });
    }
    if (delayMs && i < accountIds.length - 1) await sleep(delayMs);
  }
  return out;
}

// ── Оркестратор ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Хэш содержимого ролика — ключ кэша загруженных видео. */
function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Вернуть video_id из кэша, если тот же файл уже залит в ЭТОТ кабинет и всё ещё
 * готов (isVideoReady). Иначе null (и чистим протухшую запись). Так повторный
 * залив не грузит и не ждёт обработку одних и тех же роликов заново.
 */
async function cachedReadyVideo(accountExternalId: string, hash: string, token: string, net: FbNet): Promise<string | null> {
  try {
    const row = await prisma.uploadedVideo.findUnique({
      where: { accountExternalId_contentHash: { accountExternalId, contentHash: hash } },
    });
    if (!row) return null;
    if (await isVideoReady(token, row.fbVideoId, net)) return row.fbVideoId;
    await prisma.uploadedVideo.delete({ where: { id: row.id } }).catch(() => {}); // протух — убираем
  } catch { /* сбой кэша не критичен — считаем промахом */ }
  return null;
}

/**
 * Очередь заливов ПО КАБИНЕТУ: на один кабинет — строго по очереди (чтобы не
 * бомбить один аккаунт параллельными заливами), на разные кабинеты — параллельно.
 * Цепочка промисов на каждый accountId живёт в памяти процесса (self-hosted —
 * один процесс, этого достаточно).
 */
// Замок от дубля залива (см. runAutoupload): ключ «баер:кабинет:кампания» →
// метка времени старта. Живёт в памяти процесса (self-hosted — один процесс).
const inFlightUploads = new Map<string, number>();

const accountChains = new Map<string, Promise<unknown>>();
function runPerAccount(accountId: string, task: () => Promise<unknown>): Promise<unknown> {
  const prev = accountChains.get(accountId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => task());
  accountChains.set(accountId, next);
  // Подчистка, когда это последний в цепочке.
  next.finally(() => { if (accountChains.get(accountId) === next) accountChains.delete(accountId); }).catch(() => {});
  return next;
}

/**
 * Фоновый запуск залива: файлы читаем в память СЕЙЧАС (иначе после ответа они
 * пропадут), затем запускаем оркестратор без ожидания и сразу отвечаем. Прогресс
 * и результат — в UploadJob (см. loadRecentJobs / «Журнал заливов»). Так можно
 * уйти со страницы, залив продолжит крутиться на сервере.
 *
 * Несколько заливов на ОДИН кабинет идут по очереди, на разные — параллельно.
 */
export async function startUpload(form: FormData): Promise<{ ok: boolean; error?: string }> {
  // Ловим ошибку прелюдии и ВОЗВРАЩАЕМ её текст, а не бросаем: иначе прод-сборка
  // Next маскирует любое исключение экшена в «An error occurred in the Server
  // Components render… digest…», и в UI не видно настоящей причины.
  try {
    await requireUser();
    // Копия формы с файлами, вычитанными в буфер (переживёт ответ сервера).
    const cloned = new FormData();
    for (const [k, v] of form.entries()) {
      if (v instanceof File) {
        const buf = await v.arrayBuffer();
        cloned.append(k, new File([buf], v.name, { type: v.type }));
      } else {
        cloned.append(k, v);
      }
    }
    const accountId = String(cloned.get('accountId') ?? '') || 'unknown';
    // Не ждём: пусть крутится в фоне. Ошибки уедут в журнал самого залива.
    void runPerAccount(accountId, () => runAutoupload(cloned).catch(() => {}));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type JobRow = {
  id: string;
  accountName: string;
  campaignName: string;
  mode: string;
  status: string; // running | done | error
  stage: string;  // текущий этап (пока running)
  adsPlanned: number;
  adsCreated: number;
  error: string;
  log: string;
  createdAt: string;
};

/** Недавние заливы для «Журнала»: баер — свои, команда — все свежие.
 *  kind ('video'|'static') — раздельные журналы у видео и сторис/фото. */
export async function loadRecentJobs(kind?: 'video' | 'static'): Promise<JobRow[]> {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const where = {
    ...(team ? {} : { buyerId: user.buyer?.id ?? '__none__' }),
    ...(kind ? { kind } : {}),
  };
  const rows = await prisma.uploadJob.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 });
  return rows.map((r) => ({
    id: r.id,
    accountName: r.accountName,
    campaignName: r.campaignName,
    mode: r.mode,
    status: r.status,
    stage: r.stage,
    adsPlanned: r.adsPlanned,
    adsCreated: r.adsCreated,
    error: r.error,
    log: r.log,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Отменить «залипший» залив: если фоновый процесс оборвался (перезапуск
 * контейнера и т.п.), задача остаётся в статусе running навсегда. Кнопкой в
 * журнале помечаем её ошибкой. Право: команда — любой, баер — только свой.
 * Уже завершённые (done/error) не трогаем.
 */
export async function cancelJob(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const job = await prisma.uploadJob.findUnique({ where: { id } });
  if (!job) return { ok: false, error: 'Залив не найден' };
  if (!team && job.buyerId !== (user.buyer?.id ?? '__none__')) return { ok: false, error: 'Нет доступа' };
  if (job.status !== 'running') return { ok: true }; // уже завершён — ничего не делаем
  await prisma.uploadJob.update({
    where: { id },
    data: { status: 'error', stage: '', error: 'Отменено вручную', log: `${job.log}\n✗ Отменено вручную из журнала` },
  });
  return { ok: true };
}

export type UploadResult = {
  ok: boolean;
  error?: string;
  jobId?: string;
  log?: string[];
  campaignFbId?: string;
  adsCreated?: number;
  /** Создано, но НА ПАУЗЕ из-за неподтверждённого телефона кабинета — «запущен
   *  с проблемой»: структура есть, но в актив надо включить вручную. */
  phoneRequired?: boolean;
};

/**
 * Запустить автозалив. Читает форму, собирает цепочку под кабинет и пишет
 * журнал (UploadJob). Пейсинг между вызовами — чтобы не словить троттлинг ФБ на
 * серии создающих запросов.
 */
export async function runAutoupload(form: FormData): Promise<UploadResult> {
  const accountId = String(form.get('accountId') ?? '');
  const ctx = await accountAccessFor(accountId);
  if ('error' in ctx) return { ok: false, error: ctx.error };

  // Шаблон гео (обязателен — из него таргет).
  const templateId = String(form.get('templateId') ?? '');
  // Только свой шаблон — чужой id использовать нельзя.
  const tpl = templateId
    ? await prisma.uploadTemplate.findFirst({ where: { id: templateId, userId: ctx.userId } })
    : null;
  if (!tpl) return { ok: false, error: 'Выбери свой шаблон гео' };

  let pageId = String(form.get('pageId') ?? '').trim();
  const pixelId = String(form.get('pixelId') ?? '').trim();
  if (!pageId) return { ok: false, error: 'Выбери страницу (ФП)' };
  if (!pixelId) return { ok: false, error: 'Выбери или создай пиксель' };

  const campaignName = String(form.get('campaignName') ?? '').trim() || `auto ${rand(5)}`;
  const link = String(form.get('link') ?? '').trim();
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: 'Ссылка на лендинг должна начинаться с http(s)://' };
  const message = String(form.get('message') ?? '').trim();
  if (!message) return { ok: false, error: 'Текст объявления пустой' };
  const headline = String(form.get('headline') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  // Метки к ссылке. Плейсхолдер пикселя подставляем сами (у ФБ нет макроса для
  // pixel_id): {{pixel}} / ПИКСЕЛЬ / PIXEL_ID → id выбранного пикселя. Остальные
  // ({{ad.id}}, {{campaign.id}}, {{account.id}}) ФБ подставит сам при откруте.
  // Ручной номер fb_pixel — баер вводит его при заливе (из другого места),
  // подставляем в плейсхолдер {{fbpixel}}.
  const manualPixel = String(form.get('manualPixel') ?? '').trim();
  const urlTags = String(form.get('urlTags') ?? '')
    .trim()
    .replace(/\{\{\s*pixel(_id)?\s*\}\}/gi, pixelId)
    .replace(/ПИКСЕЛЬ/g, pixelId)
    .replace(/\bPIXEL_ID\b/gi, pixelId)
    .replace(/\{\{\s*fb_?pixel\s*\}\}/gi, manualPixel);

  // Бюджет: из формы (доллары) либо из шаблона.
  const budgetRaw = String(form.get('budget') ?? '').replace(/,/g, '.');
  const dailyBudgetCents = budgetRaw ? Math.round((Number(budgetRaw) || 0) * 100) : tpl.dailyBudgetCents;
  if (!dailyBudgetCents || dailyBudgetCents < 100) return { ok: false, error: 'Дневной бюджет слишком мал' };

  // Режим запуска.
  const mode = String(form.get('mode') ?? 'paused'); // paused | active | scheduled | midnight
  let startTime: string | undefined;
  if (mode === 'scheduled' || mode === 'midnight') {
    const at = String(form.get('startAt') ?? '');
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return { ok: false, error: 'Укажи дату и время планового старта' };
    if (d.getTime() < Date.now() + 60_000) return { ok: false, error: 'Время старта должно быть в будущем' };
    startTime = d.toISOString();
  }
  const objectStatus: 'ACTIVE' | 'PAUSED' = mode === 'paused' ? 'PAUSED' : 'ACTIVE';
  // Может смениться на PAUSED, если кабинет требует подтверждения телефона —
  // тогда создаём на паузе, а не роняем весь залив.
  let effectiveStatus: 'ACTIVE' | 'PAUSED' = objectStatus;
  let phoneForced = false;

  // Картинки: каждая — отдельное объявление (уникализация креативов).
  const files = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
  // Видео-метод: вместо картинок — один или НЕСКОЛЬКО роликов файлами. Каждый
  // ролик станет ОТДЕЛЬНЫМ объявлением (свой креатив); как их разложить по
  // кампаниям/адсетам — задаёт структура (1-1-1 / 1-2-1 / 1-1-2).
  const videos = form.getAll('video').filter((f): f is File => f instanceof File && f.size > 0);
  const video = videos[0] ?? null;
  // Видео + языки: добавить доп-языки из личного пака в одно объявление.
  // Язык целевого гео определяется по шаблону (см. ниже), вручную не задаётся.
  const withLanguages = String(form.get('withLanguages') ?? '') === '1';
  // В режиме языков основной ролик можно не прикладывать: дефолтным станет язык
  // из пака, FB сам соберёт объявление из языков. Поэтому пускаем и без файла,
  // если включены языки (пустой пак отсеется ниже понятной ошибкой).
  if (!video && files.length === 0 && !withLanguages) return { ok: false, error: 'Добавь картинку (сторис) или ролик (видео)' };
  if (files.length > 20) return { ok: false, error: 'За раз не больше 20 картинок' };

  const genders = tpl.genders === '1' ? [1] : tpl.genders === '2' ? [2] : undefined;
  const countries = csvUpper(tpl.countries);
  const excludedCountries = csvUpper(tpl.excluded);
  const excludedRegionNames = regionNames(tpl.excludedRegions ?? '');
  const excludedCityNames = regionNames(tpl.excludedCities ?? '');
  const cta = tpl.cta;

  const log: string[] = [];
  const append = (line: string) => log.push(line);

  // Замок от дубля НА СЕРВЕРЕ по КЛЮЧУ КОНКРЕТНОГО ЗАПУСКА (uploadKey =
  // id черновика:кабинет, приходит с клиента). Смысл: один и тот же запуск,
  // случайно ушедший дважды (дабл-клик, повторный вызов «в процессе»), второй
  // раз не создаст job. А вот НАМЕРЕННО залить 2-3 одинаковых залива можно —
  // это разные черновики в очереди, у каждого свой id → свой ключ → все пройдут.
  // Ключ снимаем в finish; метка времени — страховка от протухшего ключа.
  const uploadKey = String(form.get('uploadKey') ?? '').trim();
  const dedupKey = uploadKey || `${ctx.buyerId}:${accountId}:${campaignName}:${rand(6)}`;
  const prevTs = inFlightUploads.get(dedupKey);
  if (prevTs && Date.now() - prevTs < 10 * 60_000) {
    return { ok: false, error: 'Этот же запуск уже идёт — повторная отправка пропущена' };
  }
  inFlightUploads.set(dedupKey, Date.now());

  // Тип залива — для раздельных журналов: видео (ролик/языки) vs сторис/фото.
  const jobKind = (video || withLanguages) ? 'video' : 'static';
  let job;
  try {
    job = await prisma.uploadJob.create({
      data: {
        buyerId: ctx.buyerId,
        accountId: ctx.acc.id,
        accountName: ctx.acc.name,
        campaignName,
        mode,
        status: 'running',
        kind: jobKind,
        // План объявлений: картинки, либо ролики, либо (режим «только языки») ≥1 —
        // иначе для видео/языков в журнале «запланировано» показывало 0.
        adsPlanned: Math.max(files.length, videos.length, withLanguages ? 1 : 0),
      },
    });
  } catch (e) {
    inFlightUploads.delete(dedupKey); // не оставляем висеть замок от дубля на 10 мин
    throw e;
  }

  const finish = async (patch: { status: string; error?: string; campaignFbId?: string; adsCreated?: number }) => {
    inFlightUploads.delete(dedupKey); // залив завершён — снимаем замок от дубля
    // Если залив отменили вручную (cancelJob выставил 'error'), пока шла фоновая
    // задача — НЕ перетираем статус обратно на 'done'. Иначе отмена «отскакивает»
    // и в журнале появляется ✓ готово. Пишем только лог, отмену сохраняем.
    if (patch.status === 'done') {
      const cur = await prisma.uploadJob.findUnique({ where: { id: job.id }, select: { status: true } }).catch(() => null);
      if (cur?.status === 'error') {
        await prisma.uploadJob.update({ where: { id: job.id }, data: { stage: '', log: log.join('\n') } }).catch(() => {});
        return;
      }
    }
    await prisma.uploadJob.update({
      where: { id: job.id },
      // stage чистим — статус (готово/ошибка) теперь сам говорит за себя.
      data: { ...patch, stage: '', log: log.join('\n') },
    });
    // Успешный залив — в ленту уведомлений (автор видит свой, админы — все).
    if (patch.status === 'done') {
      let who = '';
      try {
        const b = ctx.buyerId ? await prisma.buyer.findUnique({ where: { id: ctx.buyerId }, select: { handle: true } }) : null;
        who = b?.handle ?? '';
      } catch { /* не критично */ }
      await logActivity({
        kind: 'autoupload',
        message: `Автозалив: ${patch.adsCreated ?? 0} объявл. в «${ctx.acc.name}» (${campaignName})`,
        actorUserId: ctx.userId,
        actorName: who,
      });
    }
  };

  // Живой этап: пишем в БД сразу, чтобы «Журнал заливов» показывал, где сейчас
  // залив (он опрашивает каждые 5с). Заодно сбрасываем накопленный лог, чтобы
  // его можно было раскрыть и следить в реальном времени. Сбой записи не валит
  // сам залив.
  const stage = async (s: string) => {
    log.push(s);
    try {
      await prisma.uploadJob.update({ where: { id: job.id }, data: { stage: s, log: log.join('\n') } });
    } catch { /* не критично */ }
  };

  const ext = ctx.acc.externalId;
  const token = ctx.token;
  const net: FbNet = ctx.net;

  try {
    append(`Кабинет: ${ctx.acc.name || ext}`);
    append(`Гео: ${countries.join(', ')}${excludedCountries.length ? ` (искл. страны ${excludedCountries.join(', ')})` : ''} · возраст ${tpl.ageMin}-${tpl.ageMax}`);

    // Регионы исключаем по названиям: FB принимает только region key, поэтому
    // резолвим каждое имя поиском (токеном этого же кабинета — он точно достаёт
    // до FB). При совпадении имени в нескольких странах берём регион в одной из
    // целевых стран шаблона. Что не нашлось — пишем в журнал и пропускаем.
    const excludedRegions: string[] = [];
    for (const nm of excludedRegionNames) {
      try {
        const hits = await searchRegions(token, nm, net);
        const pick = hits.find((h) => countries.includes(h.cc)) ?? hits[0];
        if (pick) {
          excludedRegions.push(pick.key);
          append(`Исключён регион: ${pick.name}${pick.cc ? ` (${pick.cc})` : ''}`);
        } else {
          append(`Регион не найден, пропущен: ${nm}`);
        }
      } catch {
        append(`Не удалось найти регион «${nm}» — пропущен`);
      }
    }

    // Города (комуны/муниципалитеты) исключаем так же по названиям: FB принимает
    // только city key, поэтому резолвим имя → ключ токеном кабинета. Из совпадений
    // берём город в целевой стране шаблона (иначе одноимённые из других стран).
    const excludedCities: string[] = [];
    for (const nm of excludedCityNames) {
      try {
        const hits = await searchCities(token, nm, net);
        const inCountry = hits.filter((h) => countries.includes(h.cc));
        const pool = inCountry.length ? inCountry : hits;
        const pick = pool.find((h) => h.name.toLowerCase() === nm.toLowerCase()) ?? pool[0];
        if (pick) {
          excludedCities.push(pick.key);
          append(`Исключён город: ${pick.name}${pick.region ? `, ${pick.region}` : ''}${pick.cc ? ` (${pick.cc})` : ''}`);
        } else {
          append(`Город не найден, пропущен: ${nm}`);
        }
      } catch {
        append(`Не удалось найти город «${nm}» — пропущен`);
      }
    }

    // Мультиязычный видео-залив: одно объявление с языками ВНУТРИ (нативная фича
    // FB «Добавить языки») через asset_feed_spec + asset_customization_rules по
    // locale. Бюджет и таргет — как обычно на адсете; FB сам показывает нужный
    // язык под язык интерфейса зрителя. Основной ролик можно не прикладывать —
    // тогда дефолтом станет язык из пака (см. видео-ветку ниже).
    const wantLanguages = withLanguages;

    // DSA (ЕС) + Instagram считаем один раз на кабинет — не зависят от кампании.
    // DSA: имя ФП (ФБ берёт как рекламодателя); IG: привязанный/созданный
    // page-backed аккаунт (иначе код 1772103 на IG-плейсментах).
    const objective = objectiveForEvent(tpl.event);

    // Часть кабинетов ПРИВЯЗАНА к конкретной ФП: реклама с другой отбивается кодом
    // 100/1815645. НО /act_/promote_pages не отражает весь доступный список (кабинет,
    // как Ads Manager, крутит и с не подключёнными заранее ФП — FB подцепляет их при
    // запуске). Поэтому выбранную баером Страницу заранее НЕ трогаем: список
    // разрешённых держим для РЕАКТИВНОГО отката — переключимся, только если креатив
    // реально отобьёт 1815645.
    // Кандидаты на замену Страницы при 1815645. Два источника, порядок важен:
    //  1) страницы из УЖЕ существующих креативов кабинета — на них тут уже
    //     крутили, значит они проходят проверку «та, что указана при создании
    //     аккаунта» (promote_pages у рент-кабинетов часто пустой);
    //  2) promote_pages — заявленный список разрешённых.
    // Перебираем по очереди, пока какая-то не зайдёт; текущую исключаем.
    const [promotable, creativePageIds] = await Promise.all([
      listPromotePages(token, ctx.acc.externalId, net),
      listAdAccountCreativePageIds(token, ctx.acc.externalId, net),
    ]);
    const pageQueue: { id: string; name: string }[] = [];
    const seenPage = new Set<string>([pageId]);
    for (const id of creativePageIds) if (!seenPage.has(id)) { seenPage.add(id); pageQueue.push({ id, name: id }); }
    for (const p of promotable) if (!seenPage.has(p.id)) { seenPage.add(p.id); pageQueue.push(p); }
    const switchPageOnMismatch = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      const raw = (err instanceof FbError ? err.raw : undefined) || '';
      // Код есть в .message; текст может быть локализован («не совпадают…»),
      // английский вариант ловим в raw.
      if (!/1815645|isn'?t allowed|not allowed to (?:promote|advertise)|не совпада/i.test(`${msg}\n${raw}`)) return false;
      const pick = pageQueue.shift();
      if (!pick) {
        append('⚠ Кабинет привязан к другой Странице (1815645), а подобрать замену не из чего — выбери в форме Страницу, разрешённую этому кабинету.');
        return false;
      }
      append(`⚠ Кабинет не принял выбранную Страницу (1815645) — переключаюсь на «${pick.name}» (${pick.id}) и повторяю.`);
      pageId = pick.id;
      return true;
    };

    const pageName = await getPageName(token, pageId, net);
    let dsaBeneficiary = pageName || ctx.acc.name || 'Advertiser';
    let dsaPayer = dsaBeneficiary;
    append(`DSA: продвигается/платит — ${dsaBeneficiary}`);
    const igRes = await resolveInstagramActor(token, pageId, net, ctx.acc.externalId);
    // Очередь кандидатов IG (авторитетные — первыми). Текущий — igActor; на 1815199
    // (каб не авторизован для него) берём следующего, а когда очередь пуста —
    // убираем IG совсем (FB представит Страницей; если адсет потребует IG — mkAd
    // снимет IG-плейсменты, останется Facebook).
    const igCandidates = [...igRes.ids];
    let igActor = igCandidates.shift() ?? '';
    const dropIgActorOnUnauthorized = (err: unknown): boolean => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/1815199|does not have access to this instagram|authoris?ed instagram account/i.test(msg)) return false;
      if (!igActor) return false;
      const next = igCandidates.shift() ?? '';
      if (next) {
        append(`⚠ Кабинет не авторизован для IG-аккаунта ${igActor} (1815199) — пробую следующего: ${next}`);
        igActor = next;
      } else {
        append('⚠ Кабинет не авторизован ни для одного найденного IG-аккаунта (1815199) — убираю IG-идентичность и пересобираю (FB представит Страницей / останется Facebook).');
        igActor = '';
      }
      return true;
    };
    // Плейсменты берём ИЗ ШАБЛОНА КАК ЕСТЬ и IG/Threads НЕ режем: если явного
    // IG-аккаунта нет, креатив уходит с use_page_actor_override — FB представляет
    // бизнес в Instagram самой Страницей (как галка «use Facebook Page» в Ads
    // Manager), и IG-плейсменты идут без 1772103/1815199. Явный IG-аккаунт (если
    // нашёлся и авторизован) используем как есть.
    let placements = tpl.placements ? validPlacementKeys(tpl.placements.split(',')) : [];
    if (igActor) {
      append(`Instagram: IG-идентичность (${igActor})${igCandidates.length ? ` +${igCandidates.length} запасных` : ''} — IG/Threads-плейсменты пойдут как при ручном запуске`);
    } else {
      append('Instagram: явного IG-аккаунта нет — FB представит бизнес Страницей (use_page_actor_override), IG-плейсменты пойдут через неё');
    }
    let campaignId = ''; // первая созданная кампания — для finish (campaignFbId)
    // Все созданные объекты — чтобы после залива при телефон-гейте попробовать
    // включить их в актив обновлением статуса (как включают руками).
    const createdCampaigns: string[] = [];
    const createdAdsets: string[] = [];
    const createdAds: string[] = [];

    const mkCampaign = async (name: string): Promise<string> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { const cid = await createCampaign(token, ext, { name, objective, status: effectiveStatus }, net); createdCampaigns.push(cid); return cid; }
        catch (e) {
          if (isPhoneError(e) && effectiveStatus === 'ACTIVE') {
            effectiveStatus = 'PAUSED'; phoneForced = true;
            append('⚠ Кабинету нужен подтверждённый телефон — создаю НА ПАУЗЕ (подтверди телефон и включи вручную)');
            continue;
          }
          throw e;
        }
      }
      throw new FbError('Кампания не создана');
    };

    const mkAdset = async (campId: string, name: string): Promise<string> => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const asid = await createAdset(token, ext, {
            name, campaignId: campId, pixelId, event: tpl.event, countries, excludedCountries, excludedRegions, excludedCities,
            dsaBeneficiary: dsaBeneficiary || undefined, dsaPayer: dsaPayer || undefined, dailyBudgetCents,
            ageMin: tpl.ageMin, ageMax: tpl.ageMax, genders, placements, status: effectiveStatus, startTime,
          }, net);
          createdAdsets.push(asid);
          return asid;
        } catch (e) {
          const msg = (e as Error).message;
          // Значение плохого плейсмента ищем И в человеческом сообщении (может
          // быть локализовано — «Недействительное значение threads_home в поле…»),
          // И в техническом raw (там английский «Invalid value X for the placement
          // field»). Раньше смотрели только англ. .message — на русском ответе FB
          // лечение не срабатывало и ошибка вылетала наружу (код 2490491).
          const raw = (e instanceof FbError ? e.raw : undefined) || '';
          const hay = `${raw}\n${msg}`;
          const m = hay.match(/Invalid value (\S+?)[.,\s]*for the placement field/i)
            || hay.match(/Недействительн\S*\s+значение\s+["']?(\S+?)["']?\s+(?:в поле|для поля)/i);
          if (m && placements.length) {
            const badVal = m[1].replace(/["'.,]+$/, '');
            const next = stripPlacementValue(placements, badVal);
            if (next.length < placements.length) { append(`⚠ Плейсмент «${badVal}» кабинет не принял — убрал и повторяю`); placements = next; await sleep(400); continue; }
          }
          const needsDsa = /385807\d|385808\d|человека или организацию|dsa_|beneficiary|payer/i.test(msg);
          if (needsDsa && !dsaBeneficiary) {
            const pn = await getPageName(token, pageId, net);
            dsaBeneficiary = pn || ctx.acc.name || 'Advertiser'; dsaPayer = dsaBeneficiary;
            append(`DSA (ЕС): ФБ запросил бенефициара — подставил «${dsaBeneficiary}» и повторяю`); await sleep(400); continue;
          }
          if (isPhoneError(e) && effectiveStatus === 'ACTIVE') {
            effectiveStatus = 'PAUSED'; phoneForced = true;
            append('⚠ Кабинету нужен подтверждённый телефон — адсет создаю НА ПАУЗЕ'); await sleep(300); continue;
          }
          throw e;
        }
      }
      throw new FbError('Адсет не создан после снятия неподдержанных плейсментов');
    };

    // Диагностика площадок: читаем адсет обратно и показываем, что FB РЕАЛЬНО
    // сохранил. Мета молча выкидывает неподдержанный плейсмент (типичный случай —
    // Threads), не отдавая ошибку, — так мы видим расхождение «просили vs. стоит».
    const reportPlacements = async (adsetId: string) => {
      if (!placements.length) return;
      const got = await getAdsetPlacements(token, adsetId, net);
      if (!got) return;
      const platforms = got.publisher_platforms?.join(', ') || '—';
      const parts: string[] = [];
      if (got.facebook_positions?.length) parts.push(`FB: ${got.facebook_positions.join('/')}`);
      if (got.instagram_positions?.length) parts.push(`IG: ${got.instagram_positions.join('/')}`);
      if (got.threads_positions?.length) parts.push(`Threads: ${got.threads_positions.join('/')}`);
      if (got.messenger_positions?.length) parts.push(`Messenger: ${got.messenger_positions.join('/')}`);
      if (got.audience_network_positions?.length) parts.push(`AN: ${got.audience_network_positions.join('/')}`);
      append(`ℹ FB сохранил площадки: платформы [${platforms}]${parts.length ? ` · ${parts.join(' · ')}` : ''}`);
      // Что просили, но FB не сохранил (по платформам) — подсветим.
      const wantThreads = placements.some((k) => k === 'threads_home');
      if (wantThreads && !(got.publisher_platforms || []).includes('threads')) {
        append('⚠ Threads запросили, но FB его не сохранил — кабинет/цель, похоже, не поддерживают Threads-плейсмент');
      }
    };

    // Создание объявления с тем же самолечением по телефону: ФБ гейт «нужен
    // подтверждённый телефон» (код 31/3858013) часто срабатывает именно на
    // создании ОБЪЯВЛЕНИЯ (кампания/адсет проходят). API не даёт «выбрать»
    // верифицированный номер — поэтому объявление создаём НА ПАУЗЕ, а не роняем
    // весь залив: номер подтверждён — баер включит объявление вручную.
    const mkAd = async (name: string, adsetIdArg: string, creativeId: string): Promise<string> => {
      // Создание с телефон-само-хилом (ACTIVE → PAUSED на телефон-гейте).
      const create = async (): Promise<string> => {
        try {
          const aid = await createAd(token, ext, { name, adsetId: adsetIdArg, creativeId, status: effectiveStatus }, net);
          createdAds.push(aid);
          return aid;
        } catch (e) {
          if (isPhoneError(e) && effectiveStatus === 'ACTIVE') {
            effectiveStatus = 'PAUSED'; phoneForced = true;
            append('⚠ Телефон-гейт на создании — объявление создаю НА ПАУЗЕ, ниже попробую включить в актив (обычно номер не нужен)');
            const aid = await createAd(token, ext, { name, adsetId: adsetIdArg, creativeId, status: 'PAUSED' }, net);
            createdAds.push(aid);
            return aid;
          }
          throw e;
        }
      };
      const isIgGate = (err: unknown) => /1772103|instagram account or facebook page/i.test(err instanceof Error ? err.message : String(err));
      try {
        return await create();
      } catch (e) {
        // Нет IG-идентичности (код 1772103): FB не крутит объявление на Instagram
        // без аккаунта, который представляет бизнес. Автоплейсменты тут НЕ спасают
        // — Advantage+ всё равно включает Instagram и требует ту же идентичность.
        // Единственный рабочий путь — снять IG/Threads с адсета (оставить только
        // Facebook) и повторить. Заодно вычищаем IG из общего списка плейсментов,
        // чтобы следующие адсеты этого залива сразу создавались без IG.
        if (!isIgGate(e)) throw e;
        if (await stripAdsetInstagram(token, adsetIdArg, net)) {
          placements = stripInstagramFamily(placements);
          append('⚠ FB не принял IG/Threads без IG-аккаунта (1772103) — оставил только Facebook и повторяю (следующие адсеты тоже без IG).');
          await sleep(400);
          return await create();
        }
        throw e;
      }
    };

    // 3. Для каждой картинки — креатив и объявление. Список ключей авто-улучшений
    //    подрезаем самолечением: неизвестный ключ ФБ отбивает весь креатив, тогда
    //    выкидываем его и повторяем. Подрезанный список переиспользуем дальше.
    let optOut = [...ENHANCEMENT_OPTOUT_KEYS];
    let created = 0;

    // Видео-метод. Грузим основной ролик, ждём обработки, берём кадр-превью.
    // Если включены языки — собираем мультиязычное объявление (основной + пак),
    // иначе обычное видео-объявление. В режиме языков основной ролик можно не
    // прикладывать — дефолтным станет язык из пака.
    if (video || wantLanguages) {
      // Видео: одна кампания + один адсет (мультиязычность собирается ВНУТРИ
      // одного объявления, отдельная структура не нужна).
      await stage('Создаю кампанию…');
      campaignId = await mkCampaign(campaignName);
      append(`✓ Кампания создана: ${campaignId} · цель ${objective}`);
      await sleep(300);
      await stage('Создаю адсет…');
      const adsetId = await mkAdset(campaignId, campaignName);
      append(`✓ Адсет создан: ${adsetId} · бюджет $${(dailyBudgetCents / 100).toFixed(2)}/день · событие ${tpl.event} · ${placements.length ? placementSummary(placements.join(',')) : 'плейсменты: авто'}`);
      await reportPlacements(adsetId);
      await sleep(300);

      // Структура публикации НЕСКОЛЬКИХ роликов — каждый ролик = отдельное
      // объявление (свой креатив), а структура задаёт, как их разложить:
      //  • 1-1-2 — 1 кампания / 1 адсет / по объявлению на каждый ролик;
      //  • 1-2-1 — 1 кампания / по адсету на ролик (свой бюджет) / объявление;
      //  • 1-1-1 — по кампании на ролик (свой бюджет) / адсет / объявление.
      // Первое объявление идёт в уже созданные кампанию+адсет, остальные —
      // добавляют адсеты/кампании по структуре.
      const vidStructure = String(form.get('structure') ?? '1-1-1');

      /** Разложить готовые видео-креативы (по одному на ролик) по структуре. */
      const placeVideoCreatives = async (creativeIds: string[]): Promise<number> => {
        const total = creativeIds.length;
        for (let i = 0; i < total; i += 1) {
          const nm = total > 1 ? `${campaignName} · ${i + 1}` : campaignName;
          let targetAdset = adsetId; // первый ролик — в уже созданный адсет
          if (i > 0) {
            await sleep(300);
            if (vidStructure === '1-2-1') {
              targetAdset = await mkAdset(campaignId, nm);
              append(`✓ Адсет для ролика ${i + 1}: ${targetAdset}`);
            } else if (vidStructure === '1-1-1') {
              const c = await mkCampaign(nm);
              targetAdset = await mkAdset(c, nm);
              append(`✓ Кампания+адсет для ролика ${i + 1}: ${c} / ${targetAdset}`);
            } // 1-1-2 — тот же adsetId
          }
          const aid = await mkAd(nm, targetAdset, creativeIds[i]);
          append(`✓ Объявление ${i + 1}/${total}: ${aid}`);
        }
        return total;
      };

      // Видео-специфичные ключи авто-улучшений (Video touch-ups / Add video
      // effects). Неверные самолечение отсеет.
      optOut = [...optOut, ...VIDEO_ENHANCEMENT_OPTOUT_KEYS];

      // Создание креатива с подрезкой неподдержанных ключей улучшений.
      const buildCreativeWithRetry = async (build: () => Promise<string>): Promise<string> => {
        // Бюджет попыток: подрезка ключей улучшений + перебор страниц (1815645)
        // + смена IG-идентичности + запас. Иначе на кабинете с кучей ключей
        // не осталось бы попыток на переключение Страницы.
        for (let a = 0; a < optOut.length + pageQueue.length + 6; a += 1) {
          try { return await build(); }
          catch (e) {
            const m = (e as Error).message.match(/Param key '([^']+)' in degrees_of_freedom_spec/i);
            if (m && optOut.includes(m[1])) {
              optOut = optOut.filter((k) => k !== m[1]);
              append(`⚠ ключ улучшения «${m[1]}» не поддержан — убрал`);
              await sleep(300);
              continue;
            }
            if (dropIgActorOnUnauthorized(e)) { await sleep(300); continue; }
            if (switchPageOnMismatch(e)) { await sleep(300); continue; }
            throw e;
          }
        }
        return '';
      };

      // Грузим ВСЕ ролики (основной + языки) сразу, а обработки у FB ждём
      // ПАРАЛЛЕЛЬНО. Раньше ждали на каждый язык по очереди (до ~2-3 мин на ролик),
      // и это складывалось в долгие минуты «висения» на одном языке. Теперь ждём
      // столько, сколько занимает самый долгий ролик.
      // Основные ролики: их может быть несколько — каждый станет отдельным
      // объявлением. Грузим все параллельно.
      const mainVideoIds: string[] = [];
      const mainThumbById = new Map<string, string>();
      // Кэш: video_id, которые НЕ надо грузить/ждать заново (взяты из кэша, уже
      // готовы). Плюс карта id→хэш для сохранения свежезалитых в кэш после
      // обработки.
      const freshIds = new Set<string>();
      const hashById = new Map<string, string>();
      if (videos.length) {
        // Ролики грузим ПО ОЧЕРЕДИ, а не параллельно: две тяжёлые загрузки разом
        // делят узкий канал (особенно через прокси) и обе ловят таймаут FB (408).
        // Последовательно каждая получает весь канал и проходит надёжно.
        for (let i = 0; i < videos.length; i += 1) {
          try {
            const vbuf = Buffer.from(await videos[i].arrayBuffer());
            const hash = sha256(vbuf);
            const hit = await cachedReadyVideo(ext, hash, token, net);
            if (hit) {
              mainVideoIds.push(hit);
              append(`✓ Ролик ${i + 1}: из кэша (уже был залит) — ${hit}`);
              continue;
            }
            await stage(videos.length > 1 ? `Загружаю ролик ${i + 1}/${videos.length}…` : 'Загружаю основной ролик…');
            const vid = await uploadVideo(token, ext, vbuf, videos[i].name || 'video.mp4', net);
            mainVideoIds.push(vid); freshIds.add(vid); hashById.set(vid, hash);
            append(`✓ Ролик ${i + 1} загружен: ${vid}`);
          } catch (e) {
            append(`⚠ Ролик ${i + 1} не загрузился — пропускаю (${(e as Error)?.message ?? 'ошибка'})`);
          }
        }
      }

      // Заготовки языков: грузим ролик + резолвим locale, БЕЗ ожидания обработки.
      type LangUp = { locale: string; localeId: number; videoId: string; message: string; headline?: string; description?: string; link?: string };
      const langUps: LangUp[] = [];
      if (wantLanguages) {
        const pack = await prisma.uploadLanguage.findMany({ where: { userId: ctx.userId, archived: false }, orderBy: { sort: 'asc' } });
        const withVideo = pack.filter((lp) => (lp.videoData && lp.videoData.length) || lp.videoUrl);
        for (const lp of pack) if (!((lp.videoData && lp.videoData.length) || lp.videoUrl)) append(`⚠ ${lp.locale}: нет видео — пропускаю`);
        if (withVideo.length) {
          await stage(`Готовлю ролики языков (${withVideo.length})…`);
          // Сначала locale'ы — ПОСЛЕДОВАТЕЛЬНО и ДО заливки роликов. Раньше их
          // резолвили внутри параллельной заливки: бурст /search дрался за канал
          // с загрузкой видео и ловил троттлинг — язык молча отваливался «нет
          // locale ID». Теперь /search идёт спокойно (и с кэшем в resolveLocaleId
          // второй заход вообще без сети), а роликами грузим только то, что с
          // определившимся locale.
          const ready: typeof withVideo = [];
          const lpLocale = new Map<(typeof withVideo)[number], number>();
          for (const lp of withVideo) {
            const localeId = await resolveLocaleId(token, localeName(lp.locale), net, (w) => append(`  · ${lp.locale}: ${w}`));
            if (!localeId) { append(`⚠ ${lp.locale}: FB не отдал locale — пропускаю язык`); continue; }
            lpLocale.set(lp, localeId);
            ready.push(lp);
          }
          // Ролики языков грузим ВСЕ СРАЗУ (параллельно) — это ускоряет залив.
          // Разные видео на один каб FB тянет спокойно; ошибка одного не рушит
          // остальные (allSettled).
          const ups = await Promise.allSettled(ready.map(async (lp) => {
            const localeId = lpLocale.get(lp)!;
            // Хэш содержимого языкового ролика — по байтам, либо по URL.
            const hash = lp.videoData && lp.videoData.length
              ? sha256(Buffer.from(lp.videoData))
              : sha256(Buffer.from(`url:${lp.videoUrl}`));
            const hit = await cachedReadyVideo(ext, hash, token, net);
            if (hit) return { lvid: hit, localeId, hash, cached: true };
            const lvid = lp.videoData && lp.videoData.length
              ? await uploadVideo(token, ext, Buffer.from(lp.videoData), lp.videoName || 'lang.mp4', net)
              : await uploadVideoByUrl(token, ext, String(lp.videoUrl), net);
            return { lvid, localeId, hash, cached: false };
          }));
          ups.forEach((r, i) => {
            const lp = ready[i];
            if (r.status === 'fulfilled') {
              langUps.push({ locale: lp.locale, localeId: r.value.localeId, videoId: r.value.lvid, message: lp.primaryText || message, headline: lp.headline || undefined, description: lp.description || undefined, link: lp.link || undefined });
              if (r.value.cached) {
                append(`✓ ${lp.locale}: из кэша (уже был залит)`);
              } else {
                freshIds.add(r.value.lvid); hashById.set(r.value.lvid, r.value.hash);
                append(`✓ ${lp.locale}: ролик загружен`);
              }
            } else {
              append(`⚠ ${lp.locale}: не загрузился — пропускаю (${(r.reason as Error)?.message ?? 'ошибка'})`);
            }
          });
        }
      }

      // Ждём обработки только СВЕЖИХ роликов (из кэша уже готовы). Параллельно.
      const readyOf = new Map<string, boolean>();
      const allIds = [...mainVideoIds, ...langUps.map((l) => l.videoId)];
      for (const id of allIds) if (!freshIds.has(id)) readyOf.set(id, true); // кэш → готов
      const toWait = allIds.filter((id) => freshIds.has(id));
      if (toWait.length) {
        await stage(`Обработка роликов на стороне FB (${toWait.length})…`);
        const waits = await Promise.allSettled(toWait.map((id) => waitVideoReady(token, id, net)));
        toWait.forEach((id, i) => readyOf.set(id, waits[i].status === 'fulfilled'));
        // Свежезалитые и готовые — кладём в кэш, чтобы следующий залив их не грузил.
        for (const id of toWait) {
          if (readyOf.get(id) && hashById.has(id)) {
            await prisma.uploadedVideo.upsert({
              where: { accountExternalId_contentHash: { accountExternalId: ext, contentHash: hashById.get(id)! } },
              create: { accountExternalId: ext, contentHash: hashById.get(id)!, fbVideoId: id },
              update: { fbVideoId: id },
            }).catch(() => {});
          }
        }
      }
      if (mainVideoIds.length && !mainVideoIds.some((id) => readyOf.get(id))) {
        throw new FbError('FB не обработал ни один основной ролик вовремя — повтори залив позже (ролики уже загружены)');
      }
      // Только обработанные основные ролики (в исходном порядке) — по объявлению.
      const readyMains = mainVideoIds.filter((id) => readyOf.get(id));
      if (mainVideoIds.length && readyMains.length < mainVideoIds.length) {
        append(`⚠ ${mainVideoIds.length - readyMains.length} ролик(ов) FB не успел обработать — пропускаю`);
      }

      // Превью и сборка языковых вариантов (только для обработанных роликов).
      await stage('Собираю превью и объявление…');
      const mainThumbs = await Promise.all(readyMains.map((id) => videoThumbnailUrl(token, id, net)));
      readyMains.forEach((id, i) => mainThumbById.set(id, mainThumbs[i] || ''));
      const readyLangs = langUps.filter((l) => readyOf.get(l.videoId));
      const notReady = langUps.length - readyLangs.length;
      if (notReady) append(`⚠ ${notReady} язык(ов) FB не успел обработать — пропускаю`);
      const langThumbs = await Promise.all(readyLangs.map((l) => videoThumbnailUrl(token, l.videoId, net)));
      const langVariants: LangVariant[] = readyLangs.map((l, i) => {
        append(`✓ Язык ${l.locale} (locale ${l.localeId})`);
        return { localeId: l.localeId, videoId: l.videoId, thumb: langThumbs[i] || undefined, message: l.message, headline: l.headline, description: l.description, link: l.link };
      });

      // Язык ЦЕЛЕВОГО ГЕО определяем ПО ШАБЛОНУ (страна шаблона): напр. шаблон BG
      // → болгарский. Это язык последнего (целевого) слоя с основным роликом.
      let mainLocaleId = 0;
      const geoCode = geoDefaultLocale(countries[0] || '');
      if (geoCode) {
        mainLocaleId = await resolveLocaleId(token, localeName(geoCode), net, (w) => append(`  · гео ${geoCode}: ${w}`));
        if (mainLocaleId) append(`Язык целевого гео по шаблону (${countries[0]}): ${localeName(geoCode)} → FB locale ${mainLocaleId}`);
        else append(`⚠ FB не отдал locale для языка гео (${localeName(geoCode)}) — повтори залив; если повторяется, скажи, проверю карту языков`);
      } else if (countries[0]) {
        append(`⚠ Язык страны ${countries[0]} неизвестен — целевой слой (основной ролик) не добавлю. Скажи, добавлю страну в карту языков.`);
      }

      // Структура языковых слоёв объявления:
      //  • ДЕФОЛТ (основной язык) = ПЕРВЫЙ язык ПАКА — намеренно нетипичный для
      //    гео (его почти никто не увидит).
      //  • СРЕДНИЕ слои = остальные языки пака (нейтральные).
      //  • ЦЕЛЕВОЙ слой = ПОСЛЕДНИМ добавляется язык ГЕО (напр. болгарский) с
      //    ОСНОВНЫМ роликом и всем контентом объявления (видео/текст/описание/
      //    ссылка — то, что заполнил баер в форме).
      // Если пака языков нет — обычное одно-роликовое объявление из основного.
      // Дефолт-слой (первый, нетипичный язык пака) и нейтральные слои пака —
      // ОБЩИЕ для всех роликов. Целевой слой (язык гео) у каждого ролика свой —
      // это сам ролик с контентом объявления.
      const packDefault = langVariants.length ? langVariants[0] : null;
      const packNeutral = langVariants.length ? langVariants.slice(1) : [];

      /** Собрать креатив под ОДИН основной ролик (мультиязычный, если есть пак). */
      const buildCreativeForMain = async (mv: string): Promise<string> => {
        const thumb = mainThumbById.get(mv) || undefined;
        if (packDefault) {
          // Языки ЗАПРОШЕНЫ (пак есть) → собираем ИМЕННО мультиязычное. Если язык
          // гео не определился — это ошибка, а НЕ повод молча залить одноязычное:
          // пользователь ждёт языки и должен увидеть, что чинить, а не получить
          // «просто ролик» втихаря.
          if (!mainLocaleId) {
            throw new FbError(
              `Язык целевого гео (${geoCode ? localeName(geoCode) : countries[0] || '—'}) не определился у FB — ` +
              `мультиязычное объявление не собрать. Повтори залив; если повторяется — скажи, проверю локаль.`,
            );
          }
          if (mainLocaleId === packDefault.localeId) {
            throw new FbError(
              'Язык гео совпал с первым (дефолтным) языком пака — поменяй первый язык пака на нетипичный для гео.',
            );
          }
          // Дефолт из пака + нейтральные слои + целевой слой (этот ролик на языке гео).
          const rest = packNeutral.filter((l) => l.localeId !== mainLocaleId);
          rest.push({ localeId: mainLocaleId, videoId: mv, thumb, message, headline: headline || undefined, description: description || undefined, link, primary: true });
          const cid = await buildCreativeWithRetry(() => createMultiLangVideoCreative(token, ext, {
            name: campaignName, pageId, cta, urlTags: urlTags || undefined, optOutKeys: optOut, countries,
            main: { videoId: packDefault.videoId, thumb: packDefault.thumb, message: packDefault.message, headline: packDefault.headline, description: packDefault.description, link: packDefault.link || link },
            // Дефолтное правило таргетит язык ДЕФОЛТНОГО контента (первый язык
            // пака), а НЕ гео: язык гео уже отдан целевому слою в `rest`. Иначе
            // locale гео попадал бы в два правила сразу (дефолт + целевой слой)
            // и FB отбивал креатив кодом 1885985 «unsupported targeting field».
            mainLocaleId: packDefault.localeId,
            langs: rest,
            instagramActorId: igActor || undefined,
            primaryHeadline: headline,
            primaryDescription: description,
            onDebug: (s) => append(s),
          }, net));
          // НЕ подменяем молча одноязычным: смысл залива — именно языки. Не
          // собралось — отдаём ошибку наверх, чтобы было видно, что чинить.
          if (!cid) throw new FbError('Мультиязычный креатив не собрался (после подрезки ключей улучшений)');
          return cid;
        }
        // Пак пуст (языки не запрашивались) — обычное одно-роликовое объявление.
        const cid = await buildCreativeWithRetry(() => createVideoAdCreative(token, ext, {
          name: campaignName, pageId, videoId: mv, message, link, cta,
          urlTags: urlTags || undefined, headline: headline || undefined,
          description: description || undefined, imageUrl: thumb, optOutKeys: optOut,
          instagramActorId: igActor || undefined,
        }, net));
        if (!cid) throw new FbError('Видео-креатив не создан (после подрезки ключей улучшений)');
        return cid;
      };

      await stage('Собираю объявления…');
      const creativeIds: string[] = [];
      if (readyMains.length) {
        if (packDefault && mainLocaleId) append(`Слои на каждый ролик: дефолт (locale ${packDefault.localeId}) + пак (${packNeutral.length}) + целевой ролик (locale ${mainLocaleId})`);
        else if (mainLocaleId) append('Язык гео определён, но пак пуст — заливаю ролики как одно-язычные объявления');
        for (const mv of readyMains) {
          creativeIds.push(await buildCreativeForMain(mv));
          await sleep(200);
        }
      } else if (packDefault) {
        // Роликов нет — режим «только языки»: одно мультиязычное объявление из
        // пака (дефолт + нейтральные). Не собралось — ошибка наверх, без молчащего
        // отката к одноязычному (смысл именно в языках).
        const cid = await buildCreativeWithRetry(() => createMultiLangVideoCreative(token, ext, {
          name: campaignName, pageId, cta, urlTags: urlTags || undefined, optOutKeys: optOut, countries,
          main: { videoId: packDefault.videoId, thumb: packDefault.thumb, message: packDefault.message, headline: packDefault.headline, description: packDefault.description, link: packDefault.link || link },
          mainLocaleId: packDefault.localeId,
          langs: packNeutral,
          instagramActorId: igActor || undefined,
          onDebug: (s) => append(s),
        }, net));
        if (!cid) throw new FbError('Мультиязычный креатив не собрался (после подрезки ключей улучшений)');
        creativeIds.push(cid);
      }

      if (!creativeIds.length) throw new FbError('Нет ни роликов, ни языков с видео — нечего заливать');

      await sleep(200);
      // Готовые креативы (по одному на ролик) раскладываем по структуре.
      created = await placeVideoCreatives(creativeIds);
    } else {
      // Структура публикации картинок:
      //  1-1-2 — 1 кампания / 1 адсет / N объявлений (бюджет общий);
      //  1-2-1 — 1 кампания / N адсетов (каждый со своим бюджетом) / по объявл.;
      //  1-1-1 — N кампаний / N адсетов (каждая со своим бюджетом) / по объявл.
      const structure = String(form.get('structure') ?? '1-1-2');
      append(`Структура публикации: ${structure}`);

      let sharedCampaign = '';
      let sharedAdset = '';
      if (structure !== '1-1-1') {
        await stage('Создаю кампанию…');
        sharedCampaign = await mkCampaign(campaignName);
        campaignId = sharedCampaign;
        append(`✓ Кампания создана: ${sharedCampaign} · цель ${objective}`);
        await sleep(300);
      }
      if (structure === '1-1-2') {
        await stage('Создаю адсет…');
        sharedAdset = await mkAdset(sharedCampaign, campaignName);
        append(`✓ Адсет создан: ${sharedAdset} · бюджет $${(dailyBudgetCents / 100).toFixed(2)}/день · событие ${tpl.event}`);
        await sleep(300);
      }

      for (let idx = 0; idx < files.length; idx += 1) {
        const label = files.length > 1 ? `${campaignName} · ${idx + 1}` : campaignName;
        await stage(`Создаю объявления (${idx + 1}/${files.length})…`);

        // Кампания/адсет под выбранную структуру.
        let adsetForImage = sharedAdset;
        if (structure === '1-1-1') {
          const c = await mkCampaign(label);
          if (!campaignId) campaignId = c;
          adsetForImage = await mkAdset(c, label);
          append(`✓ Кампания+адсет для «${label}»: ${c} / ${adsetForImage}`);
          await sleep(200);
        } else if (structure === '1-2-1') {
          adsetForImage = await mkAdset(sharedCampaign, label);
          append(`✓ Адсет для «${label}»: ${adsetForImage}`);
          await sleep(200);
        }
        // Диагностику площадок печатаем один раз на залив (по первому адсету).
        if (idx === 0 && adsetForImage) await reportPlacements(adsetForImage);

        const file = files[idx];
        const buf = Buffer.from(await file.arrayBuffer());
        let imageHash: string;
        try {
          imageHash = await uploadAdImage(token, ext, buf, net);
        } catch (e) {
          append(`✗ Картинка ${idx + 1}: не загрузилась — ${(e as Error).message}`);
          continue;
        }
        await sleep(200);
        let creativeId = '';
        for (let a = 0; a < optOut.length + 4; a += 1) {
          try {
            creativeId = await createAdCreative(token, ext, {
              name: label,
              pageId, message, imageHash, link, cta,
              urlTags: urlTags || undefined,
              headline: headline || undefined,
              description: description || undefined,
              optOutKeys: optOut,
              instagramActorId: igActor || undefined,
            }, net);
            break;
          } catch (e) {
            const m = (e as Error).message.match(/Param key '([^']+)' in degrees_of_freedom_spec/i);
            if (m && optOut.includes(m[1])) {
              optOut = optOut.filter((k) => k !== m[1]);
              if (idx === 0) append(`⚠ ключ улучшения «${m[1]}» не поддержан — убрал`);
              await sleep(300);
              continue;
            }
            if (dropIgActorOnUnauthorized(e)) { await sleep(300); continue; }
            if (switchPageOnMismatch(e)) { await sleep(300); continue; }
            throw e;
          }
        }
        if (!creativeId) throw new FbError('Креатив не создан (после подрезки ключей улучшений)');
        await sleep(200);
        const adId = await mkAd(label, adsetForImage, creativeId);
        created += 1;
        append(`✓ Объявление ${idx + 1}/${files.length}: ${adId}`);
        await sleep(300);
      }
    }

    if (created === 0) {
      await finish({ status: 'error', error: 'Ни одно объявление не создано', campaignFbId: campaignId });
      return { ok: false, error: 'Ни одно объявление не создано (см. журнал)', jobId: job.id, log, campaignFbId: campaignId };
    }

    // Телефон-гейт на СОЗДАНИИ часто ложный: объект создать в актив нельзя, а
    // включить обновлением статуса (как руками в Ads Manager) — можно, номер не
    // спрашивает. Поэтому если хотели АКТИВ и упёрлись в гейт — досоздания
    // включаем всё (кампании → адсеты → объявления) сменой статуса на ACTIVE.
    if (objectStatus === 'ACTIVE' && phoneForced) {
      await stage('Включаю в актив (телефон-гейт на создании обычно ложный)…');
      try {
        for (const id of [...createdCampaigns, ...createdAdsets, ...createdAds]) {
          await setAdStatus(token, id, 'ACTIVE', net);
        }
        phoneForced = false;
        append('✓ Включено в актив обновлением статуса — номер для запуска не понадобился');
      } catch (e) {
        append(`⚠ Включить в актив не вышло (${(e as Error).message}) — осталось на паузе, включи вручную`);
      }
    }

    const modeLabel = phoneForced
      ? 'НА ПАУЗЕ — кабинету нужен подтверждённый телефон, подтверди и включи вручную'
      : mode === 'active' ? 'В АКТИВЕ' : mode === 'midnight' ? `С 00:00 МСК (${startTime})` : mode === 'scheduled' ? `ПО РАСПИСАНИЮ (${startTime})` : 'НА ПАУЗЕ';
    append(`Готово: ${created} объявлений · режим ${modeLabel}`);
    await finish({ status: 'done', campaignFbId: campaignId, adsCreated: created });
    // ВНИМАНИЕ: revalidatePath здесь НЕ вызываем — runAutoupload крутится в фоне
    // (после возврата startUpload), а revalidatePath вне запроса роняет ошибку
    // «used during render». Журнал сам опрашивает loadRecentJobs, UI обновится.
    return { ok: true, jobId: job.id, log, campaignFbId: campaignId, adsCreated: created, phoneRequired: phoneForced };
  } catch (e) {
    const msg = e instanceof FbError ? e.message : (e as Error).message;
    append(`✗ Ошибка: ${msg}`);
    await finish({ status: 'error', error: msg });
    return { ok: false, error: msg, jobId: job.id, log };
  }
}
