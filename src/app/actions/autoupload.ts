'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { validPlacementKeys, placementSummary, stripPlacementValue } from '@/lib/placements';
import { isLocale } from '@/lib/locales';
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
  FbError,
  type FbNet,
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
 * Названия регионов из текста «Madeira, Azores» → ['Madeira', 'Azores'].
 * Только по запятой (в названии региона бывают пробелы: «Community of Madrid»),
 * регистр сохраняем. Пусто/мусор — [].
 */
function regionNames(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 50);
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
  const ageMin = Math.max(13, Math.min(65, Math.round(Number(form.get('ageMin')) || 18)));
  const ageMax = Math.max(ageMin, Math.min(65, Math.round(Number(form.get('ageMax')) || 65)));
  const genderRaw = String(form.get('genders') ?? ''); // ''|'1'|'2'
  const genders = genderRaw === '1' ? '1' : genderRaw === '2' ? '2' : '';
  const budget = Math.max(1, Number(String(form.get('budget') ?? '').replace(',', '.')) || 20);
  const dailyBudgetCents = Math.round(budget * 100);
  const event = EVENT_OPTIONS.includes(String(form.get('event'))) ? String(form.get('event')) : 'LEAD';
  const cta = CTA_OPTIONS.includes(String(form.get('cta'))) ? String(form.get('cta')) : 'LEARN_MORE';
  const placements = validPlacementKeys(form.getAll('placements').map(String)).join(',');

  const data = { name, countries, excluded, excludedRegions, ageMin, ageMax, genders, dailyBudgetCents, event, cta, placements };
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

// ── Оркестратор ────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type UploadResult = {
  ok: boolean;
  error?: string;
  jobId?: string;
  log?: string[];
  campaignFbId?: string;
  adsCreated?: number;
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
  const mode = String(form.get('mode') ?? 'paused'); // paused | active | scheduled
  let startTime: string | undefined;
  if (mode === 'scheduled') {
    const at = String(form.get('startAt') ?? '');
    const d = at ? new Date(at) : null;
    if (!d || Number.isNaN(d.getTime())) return { ok: false, error: 'Укажи дату и время планового старта' };
    if (d.getTime() < Date.now() + 60_000) return { ok: false, error: 'Время старта должно быть в будущем' };
    startTime = d.toISOString();
  }
  const objectStatus: 'ACTIVE' | 'PAUSED' = mode === 'paused' ? 'PAUSED' : 'ACTIVE';

  // Картинки: каждая — отдельное объявление (уникализация креативов).
  const files = form.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { ok: false, error: 'Добавь хотя бы одну картинку' };
  if (files.length > 20) return { ok: false, error: 'За раз не больше 20 картинок' };

  const genders = tpl.genders === '1' ? [1] : tpl.genders === '2' ? [2] : undefined;
  const countries = csvUpper(tpl.countries);
  const excludedCountries = csvUpper(tpl.excluded);
  const excludedRegionNames = regionNames(tpl.excludedRegions ?? '');
  const cta = tpl.cta;

  const log: string[] = [];
  const append = (line: string) => log.push(line);

  const job = await prisma.uploadJob.create({
    data: {
      buyerId: ctx.buyerId,
      accountId: ctx.acc.id,
      accountName: ctx.acc.name,
      campaignName,
      mode,
      status: 'running',
      adsPlanned: files.length,
    },
  });

  const finish = async (patch: { status: string; error?: string; campaignFbId?: string; adsCreated?: number }) => {
    await prisma.uploadJob.update({
      where: { id: job.id },
      data: { ...patch, log: log.join('\n') },
    });
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

    // 1. Кампания. Цель — под событие пикселя (лиды/продажи), иначе ФБ не даёт
    //    оптимизироваться на выбранное событие.
    const objective = objectiveForEvent(tpl.event);
    const campaignId = await createCampaign(token, ext, {
      name: campaignName,
      objective,
      status: objectStatus,
    }, net);
    append(`✓ Кампания создана: ${campaignId} · цель ${objective}`);
    await sleep(700);

    // 2. Адсет с бюджетом и таргетом. Плейсменты, которые кабинет/цель не
    //    принимают (ФБ: «Invalid value X for the placement field …»), сами
    //    выкидываем и повторяем — залив не должен падать из-за одной галки.
    let placements = tpl.placements ? tpl.placements.split(',') : [];
    let adsetId = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        adsetId = await createAdset(token, ext, {
          name: campaignName,
          campaignId,
          pixelId,
          event: tpl.event,
          countries,
          excludedCountries,
          excludedRegions,
          dailyBudgetCents,
          ageMin: tpl.ageMin,
          ageMax: tpl.ageMax,
          genders,
          placements,
          status: objectStatus,
          startTime,
        }, net);
        break;
      } catch (e) {
        const m = (e as Error).message.match(/Invalid value (\S+?)[.,\s]*for the placement field/i);
        if (m && placements.length) {
          const badVal = m[1];
          const next = stripPlacementValue(placements, badVal);
          if (next.length < placements.length) {
            append(`⚠ Плейсмент «${badVal}» кабинет не принял — убрал и повторяю`);
            placements = next;
            await sleep(400);
            continue;
          }
        }
        throw e;
      }
    }
    if (!adsetId) throw new FbError('Адсет не создан после снятия неподдержанных плейсментов');
    append(`✓ Адсет создан: ${adsetId} · бюджет $${(dailyBudgetCents / 100).toFixed(2)}/день · событие ${tpl.event} · ${placements.length ? placementSummary(placements.join(',')) : 'плейсменты: авто'}`);
    await sleep(700);

    // 3. Для каждой картинки — креатив и объявление. Список ключей авто-улучшений
    //    подрезаем самолечением: неизвестный ключ ФБ отбивает весь креатив, тогда
    //    выкидываем его и повторяем. Подрезанный список переиспользуем дальше.
    let optOut = [...ENHANCEMENT_OPTOUT_KEYS];
    let created = 0;
    for (let idx = 0; idx < files.length; idx += 1) {
      const file = files[idx];
      const buf = Buffer.from(await file.arrayBuffer());
      let imageHash: string;
      try {
        imageHash = await uploadAdImage(token, ext, buf, net);
      } catch (e) {
        append(`✗ Картинка ${idx + 1}: не загрузилась — ${(e as Error).message}`);
        continue;
      }
      await sleep(500);
      let creativeId = '';
      for (let a = 0; a < optOut.length + 2; a += 1) {
        try {
          creativeId = await createAdCreative(token, ext, {
            name: files.length > 1 ? `${campaignName} · cr ${idx + 1}` : campaignName,
            pageId,
            message,
            imageHash,
            link,
            cta,
            urlTags: urlTags || undefined,
            headline: headline || undefined,
            description: description || undefined,
            optOutKeys: optOut,
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
      await sleep(500);
      const adId = await createAd(token, ext, {
        name: files.length > 1 ? `${campaignName} · ${idx + 1}` : campaignName,
        adsetId,
        creativeId,
        status: objectStatus,
      }, net);
      created += 1;
      append(`✓ Объявление ${idx + 1}/${files.length}: ${adId}`);
      await sleep(600);
    }

    if (created === 0) {
      await finish({ status: 'error', error: 'Ни одно объявление не создано', campaignFbId: campaignId });
      return { ok: false, error: 'Ни одно объявление не создано (см. журнал)', jobId: job.id, log, campaignFbId: campaignId };
    }

    const modeLabel = mode === 'active' ? 'В АКТИВЕ' : mode === 'scheduled' ? `ПО РАСПИСАНИЮ (${startTime})` : 'НА ПАУЗЕ';
    append(`Готово: ${created} объявлений · режим ${modeLabel}`);
    await finish({ status: 'done', campaignFbId: campaignId, adsCreated: created });
    revalidatePath('/ads/upload');
    revalidatePath('/ads/campaigns');
    return { ok: true, jobId: job.id, log, campaignFbId: campaignId, adsCreated: created };
  } catch (e) {
    const msg = e instanceof FbError ? e.message : (e as Error).message;
    append(`✗ Ошибка: ${msg}`);
    await finish({ status: 'error', error: msg });
    return { ok: false, error: msg, jobId: job.id, log };
  }
}
