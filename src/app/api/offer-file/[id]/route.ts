import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/**
 * Отдаёт превью и фото отзывов из базы.
 *
 * `?dl=1` — скачать файлом, без него картинка показывается на странице.
 * Доступ только своим: файлы офферов — рабочий материал команды.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;
  const file = await prisma.offerFile.findUnique({ where: { id } });
  if (!file) return new NextResponse('not found', { status: 404 });

  const dl = new URL(req.url).searchParams.get('dl') === '1';
  // Имя файла кириллицей ломает обычный filename= — уходим в filename*.
  const name = encodeURIComponent(file.name);
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
