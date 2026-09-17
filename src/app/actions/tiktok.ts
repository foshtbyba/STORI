'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import {
  advertiserInfo, advertiserSpendDays, listAdvertisers, TiktokError,
  campaignsWithStats, setCampaignStatus, updateCampaignBudget,
  listIdentities, createCampaign, createAdGroup, uploadVideoFromFile, createAd,
  tiktokConfigured,
  type TiktokCampaignRow, type TiktokIdentity, type TiktokLaunchInput,
} from '@/lib/tiktok';

export type TiktokState = { ok: boolean; error?: string; info?: string } | null;

/** YYYY-MM-DD за N дней назад от сегодня (UTC). */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Токен принадлежит вызывающему? Баер — свой, команда/админ — овнерские тоже. */
async function assertOwnToken(tokenId: string) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const tok = await prisma.tiktokToken.findUnique({ where: { id: tokenId }, include: { buyer: true } });
  if (!tok) throw new Error('Токен не найден');
  const own = user.buyer && tok.buyerId === user.buyer.id;
  if (!own && !team) throw new Error('Нет доступа к этому токену');
  return tok;
}

/**
 * Синхронизация кабинетов TikTok под токеном: обновляем список advertiser'ов,
 * их инфо (имя/валюта/статус/баланс) и дневной расход за последние 30 дней.
 */
export async function syncTiktokToken(tokenId: string): Promise<TiktokState> {
  try {
    const tok = await assertOwnToken(tokenId);
    if (!tok.accessToken) return { ok: false, error: 'У токена нет access_token — переподключи кабинет' };

    // Список кабинетов под токеном (на случай, если появились новые).
    let ids: string[] = [];
    try {
      ids = await listAdvertisers(tok.accessToken);
    } catch {
      // Фолбэк — то, что уже сохранено.
      const saved = await prisma.tiktokAccount.findMany({ where: { tokenId }, select: { advertiserId: true } });
      ids = saved.map((a) => a.advertiserId);
    }

    const infos = await advertiserInfo(tok.accessToken, ids);
    // Апсертим кабинеты.
    for (const inf of infos) {
      await prisma.tiktokAccount.upsert({
        where: { tokenId_advertiserId: { tokenId, advertiserId: inf.advertiserId } },
        create: {
          tokenId,
          advertiserId: inf.advertiserId,
          name: inf.name,
          currency: inf.currency,
          timezone: inf.timezone,
          status: inf.status,
          statusReason: inf.statusReason,
          balanceCents: inf.balanceCents,
        },
        update: {
          name: inf.name,
          currency: inf.currency,
          timezone: inf.timezone,
          status: inf.status,
          statusReason: inf.statusReason,
          balanceCents: inf.balanceCents,
        },
      });
    }

    // Расход за 30 дней по каждому кабинету.
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
    const accounts = await prisma.tiktokAccount.findMany({ where: { tokenId } });
    for (const acc of accounts) {
      let days;
      try {
        days = await advertiserSpendDays(tok.accessToken, acc.advertiserId, ymd(from), ymd(to));
      } catch {
        continue; // один кабинет не должен рушить синк остальных
      }
      let lastSpend: Date | null = null;
      for (const d of days) {
        const date = new Date(`${d.date}T00:00:00.000Z`);
        await prisma.tiktokAccountDay.upsert({
          where: { accountId_date: { accountId: acc.id, date } },
          create: { accountId: acc.id, date, spendCents: d.cents, currency: acc.currency },
          update: { spendCents: d.cents, currency: acc.currency },
        });
        if (d.cents > 0) lastSpend = date;
      }
      if (lastSpend) await prisma.tiktokAccount.update({ where: { id: acc.id }, data: { lastSpendAt: lastSpend } });
    }

    await prisma.tiktokToken.update({
      where: { id: tokenId },
      data: { lastSyncAt: new Date(), status: 'ACTIVE', lastError: '' },
    });
    revalidatePath('/tiktok');
    return { ok: true, info: `Обновлено кабинетов: ${accounts.length}` };
  } catch (e) {
    const msg = e instanceof TiktokError ? e.message : (e as Error).message;
    await prisma.tiktokToken.update({ where: { id: tokenId }, data: { lastError: msg } }).catch(() => {});
    revalidatePath('/tiktok');
    return { ok: false, error: msg };
  }
}

// ── Доступ к кабинету по id (для кампаний/автозалива) ───────────────────────

/** Найти кабинет TikTok и его токен с проверкой доступа вызывающего. */
async function accountForUser(accountId: string) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const acc = await prisma.tiktokAccount.findUnique({
    where: { id: accountId },
    include: { token: { include: { buyer: true } } },
  });
  if (!acc) throw new TiktokError('Кабинет не найден');
  const own = user.buyer && acc.token.buyerId === user.buyer.id;
  if (!own && !team) throw new TiktokError('Нет доступа к этому кабинету');
  if (!acc.token.accessToken) throw new TiktokError('У токена нет access_token — переподключи кабинет');
  return acc;
}

export type TiktokCampaignsResult =
  | { ok: true; rows: TiktokCampaignRow[] }
  | { ok: false; error: string };

/** Кампании кабинета со статистикой за N дней (по умолчанию 7). */
export async function fetchTiktokCampaigns(accountId: string, days = 7): Promise<TiktokCampaignsResult> {
  try {
    const acc = await accountForUser(accountId);
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * 24 * 3600 * 1000);
    const rows = await campaignsWithStats(acc.token.accessToken, acc.advertiserId, ymd(from), ymd(to));
    return { ok: true, rows };
  } catch (e) {
    return { ok: false, error: e instanceof TiktokError ? e.message : (e as Error).message };
  }
}

/** Пауза/запуск кампании. */
export async function toggleTiktokCampaign(accountId: string, campaignId: string, enable: boolean): Promise<TiktokState> {
  try {
    const acc = await accountForUser(accountId);
    await setCampaignStatus(acc.token.accessToken, acc.advertiserId, campaignId, enable);
    return { ok: true, info: enable ? 'Кампания запущена' : 'Кампания на паузе' };
  } catch (e) {
    return { ok: false, error: e instanceof TiktokError ? e.message : (e as Error).message };
  }
}

/** Изменить бюджет кампании (в основных единицах валюты). */
export async function setTiktokCampaignBudget(accountId: string, campaignId: string, budget: number): Promise<TiktokState> {
  try {
    if (!(budget > 0)) return { ok: false, error: 'Бюджет должен быть больше нуля' };
    const acc = await accountForUser(accountId);
    await updateCampaignBudget(acc.token.accessToken, acc.advertiserId, campaignId, budget);
    return { ok: true, info: 'Бюджет обновлён' };
  } catch (e) {
    return { ok: false, error: e instanceof TiktokError ? e.message : (e as Error).message };
  }
}

export type TiktokIdentitiesResult =
  | { ok: true; list: TiktokIdentity[] }
  | { ok: false; error: string };

/** Список identity кабинета (от чьего имени публикуется объявление). */
export async function fetchTiktokIdentities(accountId: string): Promise<TiktokIdentitiesResult> {
  try {
    const acc = await accountForUser(accountId);
    const list = await listIdentities(acc.token.accessToken, acc.advertiserId);
    return { ok: true, list };
  } catch (e) {
    return { ok: false, error: e instanceof TiktokError ? e.message : (e as Error).message };
  }
}

/**
 * Автозалив: кампания → группа → загрузка ролика → объявление, одним нажатием.
 * Форма уже собирает все поля; здесь остаётся выполнить последовательность через
 * Marketing API. До одобрения приложения (нет app_id/secret) честно говорим, что
 * заработает после подключения — структура и валидация уже на месте.
 */
export async function launchTiktokUpload(_prev: TiktokState, fd: FormData): Promise<TiktokState> {
  try {
    const accountId = String(fd.get('accountId') ?? '');
    const acc = await accountForUser(accountId);

    const file = fd.get('video');
    const input: TiktokLaunchInput = {
      advertiserId: acc.advertiserId,
      campaignName: String(fd.get('campaignName') ?? '').trim(),
      objective: String(fd.get('objective') ?? 'TRAFFIC'),
      budgetMode: String(fd.get('budgetMode') ?? 'BUDGET_MODE_DAY'),
      budget: Number(fd.get('budget') ?? 0),
      locationIds: String(fd.get('locationIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      ageGroups: fd.getAll('ageGroups').map(String).filter(Boolean),
      gender: String(fd.get('gender') ?? 'GENDER_UNLIMITED'),
      identityId: String(fd.get('identityId') ?? '').trim(),
      identityType: String(fd.get('identityType') ?? 'CUSTOMIZED_USER'),
      adText: String(fd.get('adText') ?? '').trim(),
      landingUrl: String(fd.get('landingUrl') ?? '').trim(),
      callToAction: String(fd.get('callToAction') ?? 'LEARN_MORE'),
      enable: String(fd.get('mode') ?? 'active') === 'active',
    };

    // Валидация — до любых обращений к API.
    if (!input.campaignName) return { ok: false, error: 'Укажи название кампании' };
    if (!(input.budget > 0)) return { ok: false, error: 'Укажи бюджет больше нуля' };
    if (!input.locationIds.length) return { ok: false, error: 'Укажи хотя бы одно гео (location id)' };
    if (!input.adText) return { ok: false, error: 'Заполни текст объявления' };
    if (!input.landingUrl) return { ok: false, error: 'Укажи ссылку (landing url)' };
    if (!input.identityId) return { ok: false, error: 'Выбери identity (от чьего имени показывать)' };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Прикрепи видеоролик' };

    if (!tiktokConfigured()) {
      return {
        ok: false,
        error: 'Приложение TikTok ещё не подключено (нет app_id/secret на сервере). Форма готова — заработает сразу после одобрения API.',
      };
    }

    // Боевая последовательность.
    const campaignId = await createCampaign(acc.token.accessToken, input);
    const adgroupId = await createAdGroup(acc.token.accessToken, input, campaignId);
    const videoId = await uploadVideoFromFile(acc.token.accessToken, acc.advertiserId, file);
    const adId = await createAd(acc.token.accessToken, input, adgroupId, videoId);

    await logActivity({
      kind: 'autoupload',
      message: `🎵 Автозалив TikTok: «${input.campaignName}» на ${acc.name || acc.advertiserId}`,
      actorName: acc.token.buyer.handle,
      actorUserId: null,
    });

    return { ok: true, info: `Готово: кампания ${campaignId}, объявление ${adId}` };
  } catch (e) {
    return { ok: false, error: e instanceof TiktokError ? e.message : (e as Error).message };
  }
}

/** Отключить подключение TikTok (удаляет токен и его кабинеты каскадом). */
export async function deleteTiktokToken(tokenId: string): Promise<TiktokState> {
  try {
    await assertOwnToken(tokenId);
    await prisma.tiktokToken.delete({ where: { id: tokenId } });
    revalidatePath('/tiktok');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
