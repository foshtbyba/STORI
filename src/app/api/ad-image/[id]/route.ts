import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { fbAccess, fetchImageBytes, adThumbnailUrl } from '@/lib/fb';

/**
 * Превью объявления, проксированное через наш сервер.
 *
 * thumbnail_url из Graph API — короткоживущая подписанная ссылка на fbcdn: по
 * прямому хотлинку из <img> она отдаёт 403 и протухает через часы, поэтому в
 * таблице картинки были битые. Здесь тянем байты на сервере через прокси/UA
 * того же кабинета (как FB Tool) и раздаём уже со своего домена. Сохранённая
 * ссылка протухла — дёргаем свежую одним запросом и чиним её в базе, чтобы в
 * следующий раз сработала сразу.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const ad = await prisma.fbAd.findUnique({
    where: { id },
    include: { adAccount: { include: { adToken: true } } },
  });
  if (!ad) return blank();

  // Скоуп: админ видит любые, баер — только свои объявления.
  const tok = ad.adAccount.adToken;
  const admin = (user.role as string) === 'ADMIN';
  const own = user.buyer && tok.buyerId === user.buyer.id;
  if (!admin && !own) return blank();
  if (!ad.thumbnailUrl && !ad.adId) return blank();

  const { token: access, net } = fbAccess(tok.token, { cookiesJson: tok.cookiesJson, proxyUrl: tok.proxyUrl });

  // Сначала пробуем сохранённую ссылку — обычно она свежая после синка.
  let img = ad.thumbnailUrl ? await fetchImageBytes(ad.thumbnailUrl, net) : null;

  // Протухла — берём актуальную из креатива, тянем ещё раз и чиним в базе.
  if (!img && ad.adId) {
    try {
      const fresh = await adThumbnailUrl(access, ad.adId, net);
      if (fresh) {
        img = await fetchImageBytes(fresh, net);
        if (img && fresh !== ad.thumbnailUrl) {
          await prisma.fbAd.update({ where: { id: ad.id }, data: { thumbnailUrl: fresh } }).catch(() => {});
        }
      }
    } catch {
      /* не достали свежую (токен протух/бан) — отдадим заглушку ниже */
    }
  }

  if (!img) return blank();

  return new NextResponse(new Uint8Array(img.buffer), {
    headers: {
      'Content-Type': img.contentType,
      'Content-Length': String(img.buffer.length),
      // Превью меняется редко; час кэша снимает нагрузку на повторных заходах.
      'Cache-Control': 'private, max-age=3600',
    },
  });
}

/** Прозрачный 1×1 PNG — чтобы <img> не показывал битую иконку, а был пустым. */
function blank() {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  );
  return new NextResponse(new Uint8Array(png), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
  });
}
