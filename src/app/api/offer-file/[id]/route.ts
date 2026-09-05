import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireUser } from '@/lib/auth';

/**
 * Отдаёт превью и фото отзывов из базы.
 *
 * `?dl=1` — скачать файлом, оригиналом, как загрузили. Без него картинка
 * показывается на странице.
 *
 * `?w=560` — ужать до этой ширины. Фото с телефона весит мегабайты и приходит
 * размером в четыре тысячи точек, а на карточке живёт полоской в сто шестьдесят
 * восемь пикселей: браузер разворачивает всё это в памяти и жуёт при каждой
 * перерисовке. Ужимаем на сервере — оригинал в базе не трогаем, скачивается он
 * по-прежнему целым.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;
  const file = await prisma.offerFile.findUnique({ where: { id } });
  if (!file) return new NextResponse('not found', { status: 404 });

  const url = new URL(req.url);
  const dl = url.searchParams.get('dl') === '1';
  // Имя файла кириллицей ломает обычный filename= — уходим в filename*.
  const name = encodeURIComponent(file.name);
  // Без параметра — отдаём как есть. Пустой `w` раньше превращался в ноль, ноль
  // подтягивался к нижней границе, и картинка без спроса ужималась до 48 точек.
  const asked = Number(url.searchParams.get('w') ?? '');
  const width = Number.isFinite(asked) && asked > 0 ? Math.min(1600, Math.max(48, asked)) : 0;

  // `trim=1` — срезать однотонные поля вокруг товара. Просит только карточка
  // оффера: у превью от партнёрок поля бывают в половину картинки, и товар на
  // их фоне выглядит крошечным рядом с превью, снятым впритык.
  const trim = url.searchParams.get('trim') === '1';

  if (!dl && width && file.mime.startsWith('image/')) {
    const small = await shrink(file.data, width, trim);
    if (small) {
      return new NextResponse(new Uint8Array(small), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Length': String(small.length),
          // Содержимое под этим id не меняется никогда: новый файл — новый id.
          'Cache-Control': 'private, max-age=31536000, immutable',
        },
      });
    }
    // Ужать не вышло — отдаём как есть, пустой карточки быть не должно.
  }

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      'Content-Type': file.mime,
      'Content-Length': String(file.size),
      'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
}

/**
 * Уменьшение картинки. `sharp` — родная библиотека, и на чужой машине она может
 * не собраться; тогда просто возвращаем `null` и страница показывает оригинал.
 * Ради превью ломаться нечему.
 */
async function shrink(data: Uint8Array, width: number, trim = false) {
  try {
    const { default: sharp } = await import('sharp');
    const source = trim ? await trimmed(sharp, Buffer.from(data)) : Buffer.from(data);
    return await sharp(source)
      .rotate() // уважаем EXIF: фото с телефона иначе лежит на боку
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    return null;
  }
}

/**
 * Срезать однотонные поля вокруг товара.
 *
 * Превью приходят от партнёрок как есть: у одного товар снят впритык, у
 * другого болтается посреди белого листа с полями в половину картинки. В
 * карточке они лежат в одной сетке, и второй выглядит вчетверо мельче первого
 * — при том что места ему отведено столько же.
 *
 * Обрезка идёт по цвету угловой точки, поэтому на фото (где угол не образует
 * ровной рамки) она просто ничего не делает. Если же обрезалось «в ноль» —
 * картинка была однотонной, и лучше показать её целиком, чем точку.
 */
async function trimmed(sharp: typeof import('sharp').default, data: Buffer) {
  try {
    const out = await sharp(data).trim({ threshold: 12 }).toBuffer();
    const before = await sharp(data).metadata();
    const after = await sharp(out).metadata();
    const tiny =
      !after.width || !after.height || after.width < 32 || after.height < 32 ||
      // Съело почти всё — значит поймало не поля, а сам товар.
      (before.width && before.height &&
        (after.width * after.height) / (before.width * before.height) < 0.05);
    return tiny ? data : out;
  } catch {
    // Обрезать не вышло (однотонная картинка, чужой формат) — не беда.
    return data;
  }
}
