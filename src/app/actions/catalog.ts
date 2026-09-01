'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireTeamView } from '@/lib/auth';
import { moneyInputToCents } from '@/lib/format';
import { DEFAULT_BACKFIX, partnerOf } from '@/lib/builder';

const list = (raw: FormDataEntryValue | null) =>
  JSON.stringify(
    String(raw ?? '')
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * Гео приезжают одной строкой JSON из формы: их число заранее не известно, а
 * плодить поля вида geo0_price в FormData — верный способ однажды сбиться.
 */
/** 12 МБ — потолок и у Next для экшена, и здесь: превью столько не весит. */
const MAX_FILE = 12 * 1024 * 1024;
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];

const GeoRow = z.object({
  langCode: z.string().trim().min(1).max(12),
  uiLang: z.string().trim().max(12).default(''),
  partnerOfferId: z.string().trim().max(120).default(''),
  landingUrl: z.string().trim().max(500).default(''),
  streamCode: z.string().trim().max(120).default(''),
  price: z.string().trim().max(60).default(''),
});

function parseGeoRows(raw: FormDataEntryValue | null) {
  try {
    const parsed = z.array(GeoRow).safeParse(JSON.parse(String(raw ?? '[]')));
    if (!parsed.success) return [];
    // Одно гео — одна строка: дубли только путают при копировании в билдер.
    const seen = new Set<string>();
    return parsed.data.filter((g) => {
      const key = g.langCode.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch {
    return [];
  }
}

export async function saveOffer(formData: FormData) {
  await requireTeamView();
  const id = String(formData.get('id') ?? '');
  const data = {
    name: String(formData.get('name') ?? '').trim(),
    vertical: String(formData.get('vertical') ?? '').trim(),
    // Название партнёрки больше не вводят руками — оно и есть выбранная в
    // списке. Если партнёрка не выбрана, оставляем прежнюю подпись: у старых
    // офферов там может быть имя, которого в списке конструктора нет.
    network:
      partnerOf(String(formData.get('partnerKey') ?? '').trim())?.label ??
      String(formData.get('network') ?? '').trim(),
    status: String(formData.get('status') ?? 'ACTIVE'),
    payout: String(formData.get('payout') ?? '').trim(),
    geosJson: list(formData.get('geos')),
    bansJson: list(formData.get('bans')),
    citiesJson: list(formData.get('cities')),
    notesJson: list(formData.get('notes')),
    previewUrl: String(formData.get('previewUrl') ?? '').trim() || null,
    partnerKey: String(formData.get('partnerKey') ?? '').trim(),
    backfix: String(formData.get('backfix') ?? '').trim() || DEFAULT_BACKFIX,
  };
  if (!data.name) return;

  const rows = parseGeoRows(formData.get('geoRows'));
  const geos = rows.map((g, i) => ({ ...g, sort: i }));

  const offer = id
    ? await prisma.offer.update({ where: { id }, data })
    : await prisma.offer.create({ data });

  // Строки гео переписываем целиком: их немного, а разбирать, что именно
  // поменялось, дороже, чем записать заново.
  await prisma.offerGeo.deleteMany({ where: { offerId: offer.id } });
  if (geos.length) {
    await prisma.offerGeo.createMany({
      data: geos.map((g) => ({ ...g, offerId: offer.id })),
    });
  }

  // Превью приходит вместе с формой: ссылок на картинки у команды не бывает,
  // их всегда приносят файлом. Новое заменяет старое — превью у оффера одно.
  const preview = formData.get('previewFile');
  if (
    preview instanceof File &&
    preview.size > 0 &&
    preview.size <= MAX_FILE &&
    ALLOWED.includes(preview.type)
  ) {
    await prisma.offerFile.deleteMany({ where: { offerId: offer.id, kind: 'PREVIEW' } });
    await prisma.offerFile.create({
      data: {
        offerId: offer.id,
        kind: 'PREVIEW',
        name: preview.name.slice(0, 200),
        mime: preview.type,
        size: preview.size,
        data: Buffer.from(await preview.arrayBuffer()),
      },
    });
  }

  revalidatePath('/offers');
  // Форма — отдельный экран поверх списка: сохранили и вернулись к карточкам.
  redirect('/offers');
}

export async function deleteOffer(formData: FormData) {
  await requireTeamView();
  const id = String(formData.get('id') ?? '');
  if (id) await prisma.offer.delete({ where: { id } });
  revalidatePath('/offers');
}

/**
 * Превью и фото отзывов кладём в базу. Ссылок на них нет, а диск контейнера
 * не переживает пересборку — значит, хранить больше негде.
 */
export async function uploadOfferFiles(formData: FormData) {
  await requireTeamView();
  const offerId = String(formData.get('offerId') ?? '');
  const kind = String(formData.get('kind') ?? 'PREVIEW') === 'REVIEW' ? 'REVIEW' : 'PREVIEW';
  if (!offerId) return;

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    if (file.size > MAX_FILE) continue;
    if (!ALLOWED.includes(file.type)) continue;
    const bytes = Buffer.from(await file.arrayBuffer());
    // Превью одно: новое заменяет старое, чтобы карточка не двоилась.
    if (kind === 'PREVIEW') {
      await prisma.offerFile.deleteMany({ where: { offerId, kind: 'PREVIEW' } });
    }
    await prisma.offerFile.create({
      data: { offerId, kind, name: file.name.slice(0, 200), mime: file.type, size: file.size, data: bytes },
    });
    if (kind === 'PREVIEW') break;
  }

  revalidatePath('/offers');
}

export async function deleteOfferFile(formData: FormData) {
  await requireTeamView();
  const id = String(formData.get('fileId') ?? '');
  if (id) await prisma.offerFile.delete({ where: { id } }).catch(() => {});
  revalidatePath('/offers');
}

const ConsumableInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  typeId: z.string().min(1),
  buyerId: z.string().min(1),
  qty: z.number().int().min(1).max(9999),
  totalCents: z.number().int().min(0),
  note: z.string().max(300).optional(),
});

/**
 * Расходники заводит команда, а не сам баер: списание уменьшает его базу для
 * зарплаты, поэтому право записи здесь — конфликт интересов. Баер их видит,
 * но не добавляет и не удаляет.
 *
 * Списание всегда именное: каждый расходник закрепляется за конкретным баером
 * и вычитается из его профита. Общекомандных списаний нет.
 */
export async function addConsumable(formData: FormData) {
  const user = await requireTeamView();
  const buyerId = String(formData.get('buyerId') ?? '');

  const parsed = ConsumableInput.safeParse({
    date: String(formData.get('date') ?? ''),
    typeId: String(formData.get('typeId') ?? ''),
    buyerId,
    qty: Number(formData.get('qty') ?? 1),
    totalCents: moneyInputToCents(formData.get('total')),
    note: String(formData.get('note') ?? ''),
  });
  if (!parsed.success) return;

  const entry = await prisma.consumableEntry.create({
    data: {
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      typeId: parsed.data.typeId,
      buyerId: parsed.data.buyerId,
      qty: parsed.data.qty,
      totalCents: parsed.data.totalCents,
      note: parsed.data.note ?? '',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'ConsumableEntry',
      entityId: entry.id,
      action: 'create',
      diffJson: JSON.stringify(parsed.data),
    },
  });

  revalidatePath('/consumables');
  revalidatePath('/');
}

export async function deleteConsumable(formData: FormData) {
  const user = await requireTeamView();
  const id = String(formData.get('id') ?? '');
  const entry = await prisma.consumableEntry.findUnique({ where: { id } });
  if (!entry) return;
  await prisma.consumableEntry.delete({ where: { id } });
  revalidatePath('/consumables');
  revalidatePath('/');
}
