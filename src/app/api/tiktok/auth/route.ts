import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { requireUser } from '@/lib/auth';
import { tiktokAuthUrl, tiktokConfigured } from '@/lib/tiktok';

/**
 * Старт подключения TikTok: ставим CSRF-state в куку и ведём баера на портал
 * авторизации приложения. Там он подтверждает доступ к своему кабинету, а TikTok
 * возвращает его в /api/tiktok/callback с auth_code.
 */
export async function GET(req: Request) {
  const user = await requireUser();
  const origin = new URL(req.url).origin;
  if (!user.buyer) return NextResponse.redirect(new URL('/tiktok?err=nobuyer', origin));
  if (!tiktokConfigured()) return NextResponse.redirect(new URL('/tiktok?err=noapp', origin));

  const state = randomUUID();
  const jar = await cookies();
  jar.set('tt_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: true, maxAge: 600, path: '/' });
  return NextResponse.redirect(tiktokAuthUrl(state));
}
