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

  // `rev` в адресе не читаем — он нужен только затем, чтобы браузер сходил за
  // картинкой заново после правки обработки: кэш у неё годовой и по адресу.
  // Живёт число в src/lib/preview.ts, там же и поднимается.
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
 * Наивная обрезка тут ломается на белом товаре: у бутылки на белом фоне корпус
 * от фона неотличим, и обрезка режет прямо по товару до цветной этикетки — от
 * бутылки 160×320 остаётся кусок 90×60. Этикетка сидит не по центру, и товар
 * в карточке уезжает вбок.
 *
 * Поэтому обрезку не применяем как есть, а берём из неё только подсказку и
 * правим двумя правилами:
 *
 *  1. Симметрия. С противоположных сторон срезаем поровну — по меньшему из
 *     двух полей. Товар остаётся ровно там, где стоял, что бы обрезка ни
 *     нашла с одного бока.
 *  2. Потолок. Сколько отдавать — зависит от того, однозначен ли фон.
 *     У картинки с прозрачностью он однозначен: прозрачным товар не бывает,
 *     и обрезке можно верить почти целиком. У непрозрачной (белый лист) —
 *     нет, и больше трети стороны не отдаём.
 */
async function trimmed(sharp: typeof import('sharp').default, data: Buffer) {
  try {
    const { info } = await sharp(data).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
    const meta = await sharp(data).metadata();
    const W = meta.width ?? 0;
    const H = meta.height ?? 0;
    if (!W || !H || !info.width || !info.height) return data;

    // Сколько обрезка сняла с каждой стороны.
    const left = -(info.trimOffsetLeft ?? 0);
    const top = -(info.trimOffsetTop ?? 0);
    const right = W - info.width - left;
    const bottom = H - info.height - top;
    if (left < 0 || top < 0 || right < 0 || bottom < 0) return data;

    // Поровну с боков и сверху-снизу — товар остаётся там же, где стоял.
    // Дальше ограничиваем, и тут вся разница между двумя видами превью:
    // прозрачные поля — это точно поля, белые — может быть и сам товар.
    const share = meta.hasAlpha ? 0.45 : 1 / 6;
    const padX = Math.min(left, right, Math.floor(W * share));
    const padY = Math.min(top, bottom, Math.floor(H * share));
    const width = W - padX * 2;
    const height = H - padY * 2;
    if (width < 32 || height < 32) return data;
    // Резать нечего — отдаём как есть, лишний проход через sharp ни к чему.
    if (padX === 0 && padY === 0) return data;

    return await sharp(data).extract({ left: padX, top: padY, width, height }).toBuffer();
  } catch {
    // Обрезать не вышло (однотонная картинка, чужой формат) — не беда.
    return data;
  }
}
