import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { logActivity } from '@/lib/activity';
import { advertiserInfo, exchangeAuthCode, listAdvertisers, tiktokConfig, verifyTiktokState } from '@/lib/tiktok';

/**
 * Возврат с портала авторизации TikTok (официальный Marketing API). Баера
 * опознаём из ПОДПИСАННОГО state — поэтому ссылку можно открывать в любом
 * браузере, где залогинен TikTok-кабинет. Меняем auth_code на долгоживущий
 * access_token и сохраняем подключение баера с его кабинетами.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/tiktok?${q}`, origin));

  const authCode = url.searchParams.get('auth_code') || url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  if (!authCode) return back('err=nocode');

  const buyerId = verifyTiktokState(state);
  if (!buyerId) return back('err=state');
  // Баер мог исчезнуть/переименоваться — проверим существование.
  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { id: true, handle: true, userId: true } });
  if (!buyer) return back('err=nobuyer');

  try {
    const { accessToken, advertiserIds } = await exchangeAuthCode(authCode);
    const ids = advertiserIds.length ? advertiserIds : await listAdvertisers(accessToken);
    const infos = await advertiserInfo(accessToken, ids);

    const token = await prisma.tiktokToken.create({
      data: {
        buyerId,
        kind: 'api',
        accessToken,
        appId: tiktokConfig().appId,
        status: 'ACTIVE',
        lastSyncAt: new Date(),
        accounts: {
          create: infos.map((inf) => ({
            advertiserId: inf.advertiserId,
            name: inf.name,
            currency: inf.currency,
            timezone: inf.timezone,
            status: inf.status,
            statusReason: inf.statusReason,
            balanceCents: inf.balanceCents,
          })),
        },
      },
      select: { id: true },
    });

    await logActivity({
      kind: 'tiktok_connected',
      message: `Подключён TikTok — кабинетов: ${infos.length}`,
      actorUserId: buyer.userId,
      actorName: buyer.handle,
    });
    return back(`connected=${infos.length}&token=${token.id}`);
  } catch (e) {
    const msg = encodeURIComponent((e as Error).message.slice(0, 160));
    return back(`err=${msg}`);
  }
}
