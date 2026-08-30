'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export type ActionResult = { ok: true } | { ok: false; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | undefined): Date | null | undefined {
  // undefined — поле не прислали, не трогаем. '' — сбросить в null.
  if (value === undefined) return undefined;
  if (value === '') return null;
  if (!DATE.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export type BuyerProfilePatch = {
  startedAt?: string;
  birthday?: string;
  /** 'BUYER' | 'LEAD' | '' (сброс). */
  position?: string;
  owner?: boolean;
};

/**
 * Профиль баера: дата выхода, день рождения, позиция и флаг овнера. Правит
 * только админ. Дата выхода отбрасывает недели до прихода человека из расчёта;
 * овнер уводит человека в отдельный лист. Остальное — справочно.
 */
export async function saveBuyerProfile(
  buyerId: string,
  patch: BuyerProfilePatch,
): Promise<ActionResult> {
  await requireAdmin();
  if (!buyerId) return { ok: false, error: 'Не указан баер.' };

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId } });
  if (!buyer) return { ok: false, error: 'Такого баера нет.' };

  const data: {
    startedAt?: Date | null;
    birthday?: Date | null;
    position?: string | null;
    owner?: boolean;
  } = {};

  const startedAt = parseDate(patch.startedAt);
  if (startedAt !== undefined) data.startedAt = startedAt;
  const birthday = parseDate(patch.birthday);
  if (birthday !== undefined) data.birthday = birthday;

  if (patch.position !== undefined) {
    if (patch.position === '') data.position = null;
    else if (patch.position === 'BUYER' || patch.position === 'LEAD') data.position = patch.position;
    else return { ok: false, error: 'Неизвестная позиция.' };
  }
  if (patch.owner !== undefined) data.owner = patch.owner;

  if (Object.keys(data).length === 0) return { ok: false, error: 'Нечего сохранять.' };

  await prisma.buyer.update({ where: { id: buyerId }, data });

  revalidatePath('/admin');
  revalidatePath('/payroll');
  revalidatePath('/owners');
  revalidatePath('/');
  revalidatePath('/peak');
  revalidatePath('/days');
  return { ok: true };
}

/**
 * Перекрыть/вернуть доступ баеру. Меняем только флаг входа у его аккаунта —
 * статистика, отчёты и выплаты остаются на месте. Заблокированного тут же
 * выкидывает: currentUser() отдаёт null на неактивном, и следующий его запрос
 * уходит на /login.
 */
export async function setBuyerAccess(buyerId: string, active: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!buyerId) return { ok: false, error: 'Не указан баер.' };

  const buyer = await prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true } });
  if (!buyer) return { ok: false, error: 'Такого баера нет.' };
  if (buyer.userId === admin.id) return { ok: false, error: 'Себе доступ не закрыть.' };

  await prisma.user.update({ where: { id: buyer.userId }, data: { active } });
  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      actorName: admin.name,
      entity: 'User',
      entityId: buyer.userId,
      action: active ? 'access:grant' : 'access:revoke',
      diffJson: JSON.stringify({ buyerId, handle: buyer.handle }),
    },
  });

  revalidatePath('/admin');
  return { ok: true };
}
