'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { moneyInputToCents } from '@/lib/format';
import { moveDomainToGroup, KeitaroError } from '@/lib/keitaro';

/** Название категории расходников, куда падает покупка домена. */
const DOMAIN_CONSUMABLE = 'Домены';

/**
 * Магазин доменов. Админ грузит зарегистрированные домены на склад и задаёт
 * цену по зонам; баер покупает свободный домен — расход автоматом падает ему в
 * расходники (категория «Домены»), а домен в Keitaro переезжает из группы-
 * склада в доменную группу баера. КТ-перенос — «мягкий»: если не настроен или
 * упал, покупка всё равно проходит, а причина остаётся на домене (ktError).
 */

/** example.com из любого написания (со схемой/путём/www) или null, если мусор. */
function normDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#\s]/)[0];
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(s)) return null;
  return s;
}

/** Зона (TLD) — последняя метка имени. */
function zoneOf(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}

/** Цена зоны: админ задаёт в долларах, храним в центах. Пусто — удаляем строку. */
export async function setZonePrice(formData: FormData) {
  await requireAdmin();
  const zone = String(formData.get('zone') ?? '').trim().toLowerCase().replace(/^\./, '');
  if (!zone) return;
  const raw = formData.get('price');
  const cents = moneyInputToCents(raw);
  if (!raw || cents <= 0) {
    await prisma.domainZonePrice.deleteMany({ where: { zone } });
  } else {
    await prisma.domainZonePrice.upsert({
      where: { zone },
      update: { priceCents: cents },
      create: { zone, priceCents: cents },
    });
  }
  revalidatePath('/ads/domains');
}

/** id доменной группы баера в Keitaro — куда переносим купленный домен. */
export async function setBuyerDomainGroup(formData: FormData) {
  await requireAdmin();
  const buyerId = String(formData.get('buyerId') ?? '');
  const groupId = String(formData.get('groupId') ?? '').trim();
  if (!buyerId) return;
  await prisma.buyer.update({ where: { id: buyerId }, data: { ktDomainGroupId: groupId } });
  revalidatePath('/ads/domains');
}

/** Загрузка доменов на склад пачкой (текст: по строке/через пробел/запятую). */
export async function uploadDomains(formData: FormData) {
  await requireAdmin();
  const text = String(formData.get('domains') ?? '');
  const names = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const n = normDomain(part);
    if (n) names.add(n);
  }
  if (names.size === 0) return;

  // Уже заведённые не трогаем (могут быть проданы) — добавляем только новые.
  const existing = await prisma.domain.findMany({
    where: { name: { in: [...names] } },
    select: { name: true },
  });
  const have = new Set(existing.map((d) => d.name));
  const fresh = [...names].filter((n) => !have.has(n));
  if (fresh.length) {
    await prisma.domain.createMany({
      data: fresh.map((name) => ({ name, zone: zoneOf(name), status: 'available' })),
    });
  }
  revalidatePath('/ads/domains');
}

/** Убрать домен со склада (только свободный). */
export async function deleteDomain(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const d = await prisma.domain.findUnique({ where: { id } });
  if (!d || d.status !== 'available') return;
  await prisma.domain.delete({ where: { id } });
  revalidatePath('/ads/domains');
}

/**
 * Покупка домена баером. Помечаем проданным, снимаем цену зоны, пишем расход в
 * расходники и переносим домен в группу баера в Keitaro.
 */
export async function buyDomain(formData: FormData) {
  const user = await requireUser();
  const admin = user.role === 'ADMIN';
  const id = String(formData.get('id') ?? '');

  // Кто покупает: баер — только себе; админ может купить на конкретного баера.
  const buyerId = admin ? String(formData.get('buyerId') ?? '') : user.buyer?.id ?? '';
  if (!buyerId) return { ok: false, error: 'Не указан баер.' };

  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain) return { ok: false, error: 'Домен не найден.' };
  if (domain.status !== 'available') return { ok: false, error: 'Домен уже продан.' };

  const price = await prisma.domainZonePrice.findUnique({ where: { zone: domain.zone } });
  if (!price) return { ok: false, error: `Не задана цена зоны .${domain.zone}.` };

  // Категория расходников «Домены» — заводим один раз.
  const type = await prisma.consumableType.upsert({
    where: { name: DOMAIN_CONSUMABLE },
    update: {},
    create: { name: DOMAIN_CONSUMABLE, color: '#6E8FA5' },
  });

  // Расход + отметка продажи одной транзакцией — чтобы не осталось «продан без
  // расхода» или наоборот.
  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const entry = await prisma.consumableEntry.create({
    data: {
      date,
      typeId: type.id,
      buyerId,
      qty: 1,
      totalCents: price.priceCents,
      note: `домен ${domain.name}`,
    },
  });
  await prisma.domain.update({
    where: { id },
    data: { status: 'sold', buyerId, soldAt: new Date(), priceCents: price.priceCents, consumableId: entry.id },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Domain',
      entityId: domain.id,
      action: 'buy',
      diffJson: JSON.stringify({ name: domain.name, buyerId, priceCents: price.priceCents }),
    },
  });

  // КТ-перенос — мягкий: покупка уже прошла. Если группа баера не задана или
  // трекер упал — оставляем причину на домене, но покупку не рушим.
  let ktNote = '';
  try {
    const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { ktDomainGroupId: true } });
    const groupId = buyer?.ktDomainGroupId ?? '';
    if (!groupId) {
      ktNote = 'КТ-перенос пропущен: у баера не задана доменная группа.';
      await prisma.domain.update({ where: { id }, data: { ktError: ktNote } });
    } else {
      const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
      if (!tracker) {
        ktNote = 'КТ-перенос пропущен: нет активного трекера.';
        await prisma.domain.update({ where: { id }, data: { ktError: ktNote } });
      } else {
        const ktId = await moveDomainToGroup(tracker.baseUrl, tracker.apiKey, domain.name, groupId);
        await prisma.domain.update({ where: { id }, data: { ktId, ktMoved: true, ktError: '' } });
      }
    }
  } catch (e) {
    ktNote = e instanceof KeitaroError ? e.message : `КТ-перенос не удался: ${(e as Error).message}`;
    await prisma.domain.update({ where: { id }, data: { ktError: ktNote } });
  }

  revalidatePath('/ads/domains');
  revalidatePath('/consumables');
  revalidatePath('/');
  return { ok: true, ktNote };
}

/** Вернуть проданный домен на склад: снять расход и обнулить продажу. */
export async function returnDomain(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain || domain.status !== 'sold') return;

  // Баер может вернуть только свой домен; вся команда/админ — любой.
  const scoped = !canSeeTeam(user.role as Role);
  if (scoped && domain.buyerId !== user.buyer?.id) return;

  if (domain.consumableId) {
    await prisma.consumableEntry.delete({ where: { id: domain.consumableId } }).catch(() => {});
  }
  await prisma.domain.update({
    where: { id },
    data: { status: 'available', buyerId: null, soldAt: null, priceCents: null, consumableId: null, ktMoved: false, ktError: '' },
  });
  revalidatePath('/ads/domains');
  revalidatePath('/consumables');
  revalidatePath('/');
}
