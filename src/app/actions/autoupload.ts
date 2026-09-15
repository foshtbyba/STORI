'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { validPlacementKeys, placementSummary, stripPlacementValue } from '@/lib/placements';
import { isLocale, localeName } from '@/lib/locales';
import {
  fbAccess,
  listPages,
  listPixels,
  createPixel,
  createPage,
  createCampaign,
  createAdset,
  uploadAdImage,
  createAdCreative,
  ENHANCEMENT_OPTOUT_KEYS,
  createAd,
  searchRegions,
  searchCities,
  getPageName,
  resolveInstagramActor,
  bindCardToAccount,
  uploadVideo,
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
  const budget = Math.max(1, Number(String(form.get('budget') ?? '').replace(',', '.')) || 20);
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

export type CabinetAssets = {
  ok: boolean;
  error?: string;
  pages?: { id: string; name: string }[];
  pixels?: { id: string; name: string }[];
};

/** Подтянуть живьём страницы (ФП) и пиксели кабинета — для выпадашек формы. */
export async function loadCabinetAssets(accountId: string): Promise<CabinetAssets> {
  const ctx = await accountAccessFor(accountId);
  if ('error' in ctx) return { ok: false, error: ctx.error };
  try {
    const [pages, pixels] = await Promise.all([
      listPages(ctx.token, ctx.net),
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
    await createPixel(ctx.token, ctx.acc.externalId, clean, ctx.net);
    const pixels = await listPixels(ctx.token, ctx.acc.externalId, ctx.net);
    return { ok: true, pixels };
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
    await createPage(ctx.token, clean, 'BRAND', ctx.net);
    const pages = await listPages(ctx.token, ctx.net);
    return { ok: true, pages };
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

  const pageId = String(form.get('pageId') ?? '').trim();
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
  const budgetRaw = String(form.get('budget') ?? '').replace(',', '.');
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
  // Видео-метод: вместо картинок — один основной ролик файлом.
  const videoFile = form.get('video');
  const video = videoFile instanceof File && videoFile.size > 0 ? videoFile : null;
  // Видео + языки: добавить доп-языки из личного пака в одно объявление.
  const withLanguages = String(form.get('withLanguages') ?? '') === '1';
  // Язык основного ролика — в режиме языков это язык ДЕФОЛТНОГО варианта.
  const mainLocale = String(form.get('mainLocale') ?? '').trim();
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

  // Замок от дубля НА СЕРВЕРЕ: даже если клиент как-то дёрнул залив дважды
  // (дабл-клик, ретрай запроса), второй запуск того же залива (тот же баер +
  // кабинет + имя кампании) на время исполнения пропускаем — второго job'а не
  // будет. Ключ снимаем в finish (терминал любого исхода). Метка времени —
  // страховка от «зависшего» ключа: старше 10 мин считаем протухшим.
  const dedupKey = `${ctx.buyerId}:${accountId}:${campaignName}`;
  const prevTs = inFlightUploads.get(dedupKey);
  if (prevTs && Date.now() - prevTs < 10 * 60_000) {
    return { ok: false, error: 'Этот залив уже запущен на этом кабинете — дубль пропущен' };
  }
  inFlightUploads.set(dedupKey, Date.now());

  // Тип залива — для раздельных журналов: видео (ролик/языки) vs сторис/фото.
  const jobKind = (video || withLanguages) ? 'video' : 'static';
  const job = await prisma.uploadJob.create({
    data: {
      buyerId: ctx.buyerId,
      accountId: ctx.acc.id,
      accountName: ctx.acc.name,
      campaignName,
      mode,
      status: 'running',
      kind: jobKind,
      adsPlanned: files.length,
    },
  });

  const finish = async (patch: { status: string; error?: string; campaignFbId?: string; adsCreated?: number }) => {
    inFlightUploads.delete(dedupKey); // залив завершён — снимаем замок от дубля
    await prisma.uploadJob.update({
      where: { id: job.id },
      // stage чистим — статус (готово/ошибка) теперь сам говорит за себя.
      data: { ...patch, stage: '', log: log.join('\n') },
    });
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
    const pageName = await getPageName(token, pageId, net);
    let dsaBeneficiary = pageName || ctx.acc.name || 'Advertiser';
    let dsaPayer = dsaBeneficiary;
    append(`DSA: продвигается/платит — ${dsaBeneficiary}`);
    const igActor = await resolveInstagramActor(token, pageId, net);
    if (igActor) append(`Instagram: аккаунт ${igActor} (для IG-плейсментов)`);
    else append('⚠ IG-аккаунт к ФП не привязан и создать не вышло — Instagram-плейсменты могут не пройти');

    // Кампания и адсет со всем самолечением вынесены в помощники, чтобы звать их
    // по нужной структуре публикации (1-1-1 / 1-2-1 / 1-1-2) и для видео.
    let placements = tpl.placements ? tpl.placements.split(',') : [];
    let campaignId = ''; // первая созданная кампания — для finish (campaignFbId)

    const mkCampaign = async (name: string): Promise<string> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try { return await createCampaign(token, ext, { name, objective, status: effectiveStatus }, net); }
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
          return await createAdset(token, ext, {
            name, campaignId: campId, pixelId, event: tpl.event, countries, excludedCountries, excludedRegions, excludedCities,
            dsaBeneficiary: dsaBeneficiary || undefined, dsaPayer: dsaPayer || undefined, dailyBudgetCents,
            ageMin: tpl.ageMin, ageMax: tpl.ageMax, genders, placements, status: effectiveStatus, startTime,
          }, net);
        } catch (e) {
          const msg = (e as Error).message;
          const m = msg.match(/Invalid value (\S+?)[.,\s]*for the placement field/i);
          if (m && placements.length) {
            const badVal = m[1];
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
      await sleep(300);

      // Видео-специфичные ключи авто-улучшений (Video touch-ups / Add video
      // effects). Неверные самолечение отсеет.
      optOut = [...optOut, ...VIDEO_ENHANCEMENT_OPTOUT_KEYS];

      // Создание креатива с подрезкой неподдержанных ключей улучшений.
      const buildCreativeWithRetry = async (build: () => Promise<string>): Promise<string> => {
        for (let a = 0; a < optOut.length + 3; a += 1) {
          try { return await build(); }
          catch (e) {
            const m = (e as Error).message.match(/Param key '([^']+)' in degrees_of_freedom_spec/i);
            if (m && optOut.includes(m[1])) {
              optOut = optOut.filter((k) => k !== m[1]);
              append(`⚠ ключ улучшения «${m[1]}» не поддержан — убрал`);
              await sleep(300);
              continue;
            }
            throw e;
          }
        }
        return '';
      };

      // Грузим ВСЕ ролики (основной + языки) сразу, а обработки у FB ждём
      // ПАРАЛЛЕЛЬНО. Раньше ждали на каждый язык по очереди (до ~2-3 мин на ролик),
      // и это складывалось в долгие минуты «висения» на одном языке. Теперь ждём
      // столько, сколько занимает самый долгий ролик.
      let mainVideoId = '';
      let mainThumb = '';
      if (video) {
        await stage('Загружаю основной ролик…');
        const vbuf = Buffer.from(await video.arrayBuffer());
        mainVideoId = await uploadVideo(token, ext, vbuf, video.name || 'video.mp4', net);
        append(`✓ Основной ролик загружен: ${mainVideoId}`);
      }

      // Заготовки языков: грузим ролик + резолвим locale, БЕЗ ожидания обработки.
      type LangUp = { locale: string; localeId: number; videoId: string; message: string; headline?: string; description?: string; link?: string };
      const langUps: LangUp[] = [];
      if (wantLanguages) {
        const pack = await prisma.uploadLanguage.findMany({ where: { userId: ctx.userId, archived: false }, orderBy: { sort: 'asc' } });
        let li = 0;
        for (const lp of pack) {
          li += 1;
          await stage(`Загружаю ролики языков (${li}/${pack.length}): ${lp.locale}…`);
          try {
            let lvid = '';
            if (lp.videoData && lp.videoData.length) {
              lvid = await uploadVideo(token, ext, Buffer.from(lp.videoData), lp.videoName || 'lang.mp4', net);
            } else if (lp.videoUrl) {
              lvid = await uploadVideoByUrl(token, ext, lp.videoUrl, net);
            } else {
              append(`⚠ ${lp.locale}: нет видео — пропускаю`);
              continue;
            }
            const localeId = await resolveLocaleId(token, localeName(lp.locale), net);
            if (!localeId) { append(`⚠ ${lp.locale}: не нашёл locale ID у FB — пропускаю`); continue; }
            langUps.push({ locale: lp.locale, localeId, videoId: lvid, message: lp.primaryText || message, headline: lp.headline || undefined, description: lp.description || undefined, link: lp.link || undefined });
          } catch (e) {
            append(`⚠ ${lp.locale}: не загрузился — пропускаю (${(e as Error).message})`);
          }
        }
      }

      // Ждём обработки всех роликов ПАРАЛЛЕЛЬНО.
      const readyOf = new Map<string, boolean>();
      const allIds = [...(mainVideoId ? [mainVideoId] : []), ...langUps.map((l) => l.videoId)];
      if (allIds.length) {
        await stage(`Обработка роликов на стороне FB (${allIds.length})…`);
        const waits = await Promise.allSettled(allIds.map((id) => waitVideoReady(token, id, net)));
        allIds.forEach((id, i) => readyOf.set(id, waits[i].status === 'fulfilled'));
        if (mainVideoId && !readyOf.get(mainVideoId)) {
          throw new FbError('FB не обработал основной ролик вовремя — повтори залив позже (ролик уже загружен)');
        }
      }

      // Превью и сборка языковых вариантов (только для обработанных роликов).
      await stage('Собираю превью и объявление…');
      if (mainVideoId) mainThumb = await videoThumbnailUrl(token, mainVideoId, net);
      const readyLangs = langUps.filter((l) => readyOf.get(l.videoId));
      const notReady = langUps.length - readyLangs.length;
      if (notReady) append(`⚠ ${notReady} язык(ов) FB не успел обработать — пропускаю`);
      const langThumbs = await Promise.all(readyLangs.map((l) => videoThumbnailUrl(token, l.videoId, net)));
      const langVariants: LangVariant[] = readyLangs.map((l, i) => {
        append(`✓ Язык ${l.locale} (locale ${l.localeId})`);
        return { localeId: l.localeId, videoId: l.videoId, thumb: langThumbs[i] || undefined, message: l.message, headline: l.headline, description: l.description, link: l.link };
      });

      // Определяем ДЕФОЛТНЫЙ вариант и список остальных языков.
      // ВАЖНО (по просьбе): в языковом режиме ДЕФОЛТ берём ИЗ ЯЗЫКОВ, а не из
      // отдельно введённого основного текста/ролика. Дефолтом идёт язык из пака,
      // совпавший с «Язык основного ролика», иначе первый; остальные — доп-языки.
      // Отдельный основной ролик используем только как фолбэк, если языков нет.
      let mainVar: { videoId: string; thumb?: string; message: string; headline?: string; description?: string; link: string; localeId: number } | null = null;
      let restLangs: LangVariant[] = [];
      if (langVariants.length) {
        const wantId = mainLocale ? await resolveLocaleId(token, localeName(mainLocale), net) : 0;
        const idx = wantId ? Math.max(0, langVariants.findIndex((l) => l.localeId === wantId)) : 0;
        const chosen = langVariants[idx] ?? langVariants[0];
        restLangs = langVariants.filter((_, i) => i !== langVariants.indexOf(chosen));
        mainVar = { videoId: chosen.videoId, thumb: chosen.thumb, message: chosen.message, headline: chosen.headline, description: chosen.description, link: chosen.link || link, localeId: chosen.localeId };
        append(`Дефолт объявления — язык locale ${chosen.localeId} (данные с языка, не с основного текста)`);
        if (mainVideoId) append('Основной ролик приложен, но в языковом режиме он не используется — дефолт берётся с языка');
      } else if (mainVideoId) {
        // Языков нет — обычное видео из основного ролика/текста.
        const mainLocaleId = mainLocale ? await resolveLocaleId(token, localeName(mainLocale), net) : 0;
        mainVar = { videoId: mainVideoId, thumb: mainThumb || undefined, message, headline: headline || undefined, description: description || undefined, link, localeId: mainLocaleId };
      }

      if (!mainVar) throw new FbError('Нет ни основного ролика, ни языков с видео — нечего заливать');

      await stage('Собираю объявление…');
      let creativeId = '';
      if (restLangs.length && mainVar.localeId) {
        // Мультиязычное объявление: дефолт (mainVar) + остальные языки.
        creativeId = await buildCreativeWithRetry(() => createMultiLangVideoCreative(token, ext, {
          name: campaignName, pageId, cta, urlTags: urlTags || undefined, optOutKeys: optOut, countries,
          main: { videoId: mainVar!.videoId, thumb: mainVar!.thumb, message: mainVar!.message, headline: mainVar!.headline, description: mainVar!.description, link: mainVar!.link },
          mainLocaleId: mainVar.localeId,
          langs: restLangs,
          instagramActorId: igActor || undefined,
        }, net));
        if (creativeId) {
          await sleep(200);
          const adId = await createAd(token, ext, { name: campaignName, adsetId, creativeId, status: effectiveStatus }, net);
          created = 1;
          append(`✓ Одно объявление с языками: ${adId} · языков ${restLangs.length + 1}`);
        } else {
          append('⚠ Мультиязычный креатив не собрался — делаю обычное видео-объявление');
        }
      }
      if (!creativeId) {
        // Обычное видео-объявление из дефолтного варианта.
        if (wantLanguages && !restLangs.length) append('Языков для кастомизации не набралось — заливаю один ролик');
        creativeId = await buildCreativeWithRetry(() => createVideoAdCreative(token, ext, {
          name: campaignName, pageId, videoId: mainVar!.videoId, message: mainVar!.message, link: mainVar!.link, cta,
          urlTags: urlTags || undefined, headline: mainVar!.headline,
          description: mainVar!.description, imageUrl: mainVar!.thumb, optOutKeys: optOut,
          instagramActorId: igActor || undefined,
        }, net));
        if (!creativeId) throw new FbError('Видео-креатив не создан (после подрезки ключей улучшений)');
        await sleep(200);
        const adId = await createAd(token, ext, { name: campaignName, adsetId, creativeId, status: effectiveStatus }, net);
        created = 1;
        append(`✓ Видео-объявление: ${adId}`);
      }
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
        for (let a = 0; a < optOut.length + 2; a += 1) {
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
            throw e;
          }
        }
        if (!creativeId) throw new FbError('Креатив не создан (после подрезки ключей улучшений)');
        await sleep(200);
        const adId = await createAd(token, ext, { name: label, adsetId: adsetForImage, creativeId, status: effectiveStatus }, net);
        created += 1;
        append(`✓ Объявление ${idx + 1}/${files.length}: ${adId}`);
        await sleep(300);
      }
    }

    if (created === 0) {
      await finish({ status: 'error', error: 'Ни одно объявление не создано', campaignFbId: campaignId });
      return { ok: false, error: 'Ни одно объявление не создано (см. журнал)', jobId: job.id, log, campaignFbId: campaignId };
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
