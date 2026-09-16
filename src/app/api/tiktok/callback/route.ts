import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { advertiserInfo, exchangeAuthCode, listAdvertisers, tiktokConfig } from '@/lib/tiktok';

/**
 * Возврат с портала авторизации TikTok. Проверяем CSRF-state, меняем auth_code
 * на долгоживущий access_token, сохраняем подключение баера и его кабинеты.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (q: string) => NextResponse.redirect(new URL(`/tiktok?${q}`, origin));

  const user = await requireUser();
  if (!user.buyer) return back('err=nobuyer');

  const authCode = url.searchParams.get('auth_code') || url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const jar = await cookies();
  const saved = jar.get('tt_oauth_state')?.value || '';
  jar.delete('tt_oauth_state');
  if (!authCode) return back('err=nocode');
  if (!state || state !== saved) return back('err=state');

  try {
    const { accessToken, advertiserIds } = await exchangeAuthCode(authCode);
    const ids = advertiserIds.length ? advertiserIds : await listAdvertisers(accessToken);
    const infos = await advertiserInfo(accessToken, ids);

    const token = await prisma.tiktokToken.create({
      data: {
        buyerId: user.buyer.id,
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

    return back(`connected=${infos.length}&token=${token.id}`);
  } catch (e) {
    const msg = encodeURIComponent((e as Error).message.slice(0, 160));
    return back(`err=${msg}`);
  }
}
