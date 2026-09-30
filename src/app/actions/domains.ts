'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireUser, requireAdmin } from '@/lib/auth';
import { moneyInputToCents } from '@/lib/format';
import { moveDomainToGroup, KeitaroError } from '@/lib/keitaro';
import { syncStockFromKeitaro, DEFAULT_ZONE_PRICE_CENTS } from '@/lib/domain-stock';
import { isWeekEditable } from '@/lib/period';

/** Название категории расходников, куда падает покупка домена. */
const DOMAIN_CONSUMABLE = 'Домены';

/** Setting-ключ с id группы-склада доменов в Keitaro (напр. «17»). */
const STOCK_GROUP_KEY = 'kt_domain_stock_group';

async function stockGroupId(): Promise<string> {
  const s = await prisma.setting.findUnique({ where: { key: STOCK_GROUP_KEY } });
  return s?.value?.trim() ?? '';
}

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

/** id группы-склада доменов в Keitaro — откуда берём и куда возвращаем. */
export async function setStockGroup(formData: FormData) {
  await requireAdmin();
  const value = String(formData.get('groupId') ?? '').trim();
  await prisma.setting.upsert({
    where: { key: STOCK_GROUP_KEY },
    update: { value },
    create: { key: STOCK_GROUP_KEY, value },
  });
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

/** Форс-подтянуть домены со склада Keitaro (кнопка). Авто-заход — на странице. */
export async function pullStockFromKeitaro() {
  await requireAdmin();
  const r = await syncStockFromKeitaro(true);
  revalidatePath('/ads/domains');
  return r;
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
 * КТ-перенос купленного домена в доменную группу баера. Мягкий: покупка уже
 * прошла, поэтому не бросаем — причину кладём в ktError домена и возвращаем
 * текстом. Возвращает '' при успехе.
 */
async function ktMoveToBuyer(domainId: string, name: string, buyerId: string): Promise<string> {
  try {
    const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, select: { ktDomainGroupId: true } });
    const groupId = buyer?.ktDomainGroupId ?? '';
    if (!groupId) {
      const note = 'КТ-перенос пропущен: у баера не задана доменная группа.';
      await prisma.domain.update({ where: { id: domainId }, data: { ktError: note } });
      return note;
    }
    const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
    if (!tracker) {
      const note = 'КТ-перенос пропущен: нет активного трекера.';
      await prisma.domain.update({ where: { id: domainId }, data: { ktError: note } });
      return note;
    }
    const ktId = await moveDomainToGroup(tracker.baseUrl, tracker.apiKey, name, groupId);
    await prisma.domain.update({ where: { id: domainId }, data: { ktId, ktMoved: true, ktError: '' } });
    return '';
  } catch (e) {
    const note = e instanceof KeitaroError ? e.message : `КТ-перенос не удался: ${(e as Error).message}`;
    await prisma.domain.update({ where: { id: domainId }, data: { ktError: note } });
    return note;
  }
}

/**
 * Покупка доменов по ЗОНЕ: баер берёт сколько нужно, не видя имён — они из
 * склада (первые по загрузке). Каждый домен: расход в расходники (категория
 * «Домены») + перенос в группу баера. Имена появляются у баера уже в
 * «Купленных».
 */
export async function buyDomains(formData: FormData) {
  const user = await requireUser();
  const admin = user.role === 'ADMIN';
  const zone = String(formData.get('zone') ?? '').trim().toLowerCase().replace(/^\./, '');
  const qty = Math.min(100, Math.max(1, Math.floor(Number(formData.get('qty') ?? 1)) || 1));

  // Кто покупает: баер — только себе; админ может купить на конкретного баера.
  const buyerId = admin ? String(formData.get('buyerId') ?? '') : user.buyer?.id ?? '';
  if (!buyerId) return { ok: false, error: 'Не указан баер.' };
  if (!zone) return { ok: false, error: 'Не указана зона.' };

  // Цена зоны: своя, если задана; иначе — по умолчанию $7.
  const zonePrice = await prisma.domainZonePrice.findUnique({ where: { zone } });
  const priceCents = zonePrice?.priceCents ?? DEFAULT_ZONE_PRICE_CENTS;

  // Берём первые свободные домены зоны (FIFO по загрузке) — сколько просят или
  // сколько есть.
  const picked = await prisma.domain.findMany({
    where: { status: 'available', zone },
    orderBy: { createdAt: 'asc' },
    take: qty,
  });
  if (picked.length === 0) return { ok: false, error: `В зоне .${zone} нет свободных доменов.` };

  const type = await prisma.consumableType.upsert({
    where: { name: DOMAIN_CONSUMABLE },
    update: {},
    create: { name: DOMAIN_CONSUMABLE, color: '#6E8FA5' },
  });

  const today = new Date();
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  const ktProblems: string[] = [];
  const bought: typeof picked = [];
  for (const domain of picked) {
    // АТОМАРНЫЙ захват: помечаем продажу только если домен ВСЁ ЕЩЁ свободен.
    // Так параллельная покупка/двойной клик не купят один домен дважды (иначе
    // два расхода за один домен, а buyerId перезапишет последний).
    const claim = await prisma.domain.updateMany({
      where: { id: domain.id, status: 'available' },
      data: { status: 'sold', buyerId, soldAt: new Date(), priceCents },
    });
    if (claim.count !== 1) continue; // кто-то уже забрал — пропускаем, без расхода
    bought.push(domain);
    // Расход (по домену) + привязка к домену. Отдельная запись на домен — чтобы
    // возврат одного домена снимал ровно его расход.
    const entry = await prisma.consumableEntry.create({
      data: { date, typeId: type.id, buyerId, qty: 1, totalCents: priceCents, note: `домен ${domain.name}` },
    });
    await prisma.domain.update({ where: { id: domain.id }, data: { consumableId: entry.id } });
    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        actorName: user.name,
        entity: 'Domain',
        entityId: domain.id,
        action: 'buy',
        diffJson: JSON.stringify({ name: domain.name, buyerId, priceCents }),
      },
    });
    const note = await ktMoveToBuyer(domain.id, domain.name, buyerId);
    if (note) ktProblems.push(`${domain.name}: ${note}`);
  }

  revalidatePath('/ads/domains');
  revalidatePath('/consumables');
  revalidatePath('/dashboard');

  if (bought.length === 0) return { ok: false, error: `В зоне .${zone} домены только что разобрали — попробуй ещё раз.` };
  const short = bought.length < qty ? ` (просили ${qty}, взяли ${bought.length})` : '';
  const ktNote = ktProblems.length ? `КТ: ${ktProblems.length} не перенесено — см. столбец «КТ».` : '';
  return { ok: true, bought: bought.length, requested: qty, note: `Куплено ${bought.length} шт.${short}`, ktNote };
}

/** Вернуть проданный домен на склад: снять расход и обнулить продажу. Только админ. */
export async function returnDomain(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  const domain = await prisma.domain.findUnique({ where: { id } });
  if (!domain || domain.status !== 'sold') return;

  if (domain.consumableId) {
    // Не трогаем расход из уже закрытой недели: иначе сдвинется исторический
    // профит (как в catalog.deleteConsumable). Тогда и домен не возвращаем —
    // без снятия расхода это был бы бесплатный возврат.
    const entry = await prisma.consumableEntry.findUnique({ where: { id: domain.consumableId }, select: { date: true } });
    if (entry && !isWeekEditable(entry.date)) return;
    await prisma.consumableEntry.delete({ where: { id: domain.consumableId } }).catch(() => {});
  }
  await prisma.domain.update({
    where: { id },
    data: { status: 'available', buyerId: null, soldAt: null, priceCents: null, consumableId: null, ktMoved: false, ktError: '' },
  });

  // Симметрия с покупкой: домен уезжает обратно в группу-склад в Keitaro.
  // Мягко — если склад не настроен или трекер недоступен, локально уже вернули.
  try {
    const stock = await stockGroupId();
    if (stock) {
      const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
      if (tracker) {
        await moveDomainToGroup(tracker.baseUrl, tracker.apiKey, domain.name, stock);
      }
    }
  } catch (e) {
    const note = e instanceof KeitaroError ? e.message : `Возврат в склад КТ не удался: ${(e as Error).message}`;
    await prisma.domain.update({ where: { id }, data: { ktError: note } });
  }

  revalidatePath('/ads/domains');
  revalidatePath('/consumables');
  revalidatePath('/dashboard');
}
