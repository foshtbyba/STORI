import { NextResponse } from 'next/server';

import { requireUser } from '@/lib/auth';
import { signTiktokState, tiktokAuthUrl, tiktokConfigured } from '@/lib/tiktok';

/**
 * Старт подключения TikTok: подписываем state с id баера и ведём на портал
 * авторизации приложения. Ссылку можно открыть в любом браузере (где залогинен
 * TikTok-кабинет) — callback опознает баера из подписи, без куки и сессии.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const origin = new URL(req.url).origin;
  if (!user.buyer) return NextResponse.redirect(new URL('/tiktok?err=nobuyer', origin));
  if (!tiktokConfigured()) return NextResponse.redirect(new URL('/tiktok?err=noapp', origin));

  const state = signTiktokState(user.buyer.id);
  return NextResponse.redirect(tiktokAuthUrl(state));
}
