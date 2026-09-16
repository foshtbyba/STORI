'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { advertiserInfo, advertiserSpendDays, listAdvertisers, TiktokError } from '@/lib/tiktok';

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
