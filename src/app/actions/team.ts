'use server';

import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export type ActionResult = { ok: true } | { ok: false; error: string };

export type CreateResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string };

const COLORS = ['#b4c68c', '#8ea3c6', '#c68c9e', '#c6b48c', '#8cc6b4', '#a88cc6'];

/**
 * Завести нового участника прямо из интерфейса: пользователь + профиль баера.
 * Роль решает и доступ, и место в стате: баер/тимлид — в команде, овнер — в
 * отдельном листе. Пароль генерируем и показываем один раз — передать лично.
 */
export async function createMember(input: {
  handle: string;
  name?: string;
  email: string;
  role: string;
}): Promise<CreateResult> {
  await requireAdmin();

  const handle = (input.handle ?? '').trim().toUpperCase();
  const name = (input.name ?? '').trim() || handle;
  const role = input.role;

  if (!handle) return { ok: false, error: 'Укажи ник.' };
  if (!['BUYER', 'LEAD', 'OWNER'].includes(role)) return { ok: false, error: 'Выбери роль.' };

  const clashHandle = await prisma.buyer.findUnique({ where: { handle } });
  if (clashHandle) return { ok: false, error: 'Такой ник уже есть.' };

  const owner = role === 'OWNER';
  // Доступ: тимлид видит команду (LEAD), баер — свой кабинет (BUYER). Овнер не
  // логинится вовсе (сидят с админского), поэтому у него технический
  // неактивный аккаунт без пароля и без реальной почты.
  const authRole = role === 'LEAD' ? 'LEAD' : 'BUYER';
  const position = owner ? null : role;

  // Овнеру почта не нужна — синтезируем уникальную, лишь бы прошла ограничение.
  const email = owner
    ? `owner.${handle.toLowerCase()}.${randomBytes(3).toString('hex')}@local`
    : (input.email ?? '').trim().toLowerCase();

  if (!owner) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: 'Проверь почту.' };
    const clashEmail = await prisma.user.findUnique({ where: { email } });
    if (clashEmail) return { ok: false, error: 'Почта уже занята.' };
  }

  // Баеру/тимлиду — генерируем пароль для входа. Овнеру пароль не нужен: ставим
  // случайный неиспользуемый и аккаунт делаем неактивным.
  const password = owner ? '' : randomBytes(9).toString('base64url');
  const passwordHash = await bcrypt.hash(password || randomBytes(12).toString('base64url'), 10);

  // Лесенка по умолчанию — та же базовая, что у всех.
  const rule =
    (await prisma.salaryRule.findFirst()) ??
    (await prisma.salaryRule.create({
      data: {
        name: 'Базовая лесенка',
        tiersJson: JSON.stringify([
          { fromCents: 80_000, ratePct: 30 },
          { fromCents: 160_000, ratePct: 30 },
          { fromCents: 240_000, ratePct: 30 },
          { fromCents: 500_000, ratePct: 40 },
          { fromCents: 1_000_000, ratePct: 50 },
        ]),
      },
    }));

  const user = await prisma.user.create({
    data: { email, name, role: authRole, passwordHash, active: !owner },
  });
  await prisma.buyer.create({
    data: {
      userId: user.id,
      handle,
      initials: handle.slice(0, 2).toUpperCase(),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      owner,
      position,
      salaryRuleId: rule.id,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: name,
      entity: 'Buyer',
      entityId: user.id,
      action: owner ? 'create:owner' : 'create:member',
      diffJson: JSON.stringify({ handle, role }),
    },
  });

  revalidatePath('/admin');
  revalidatePath('/');
  revalidatePath('/payroll');
  // Овнеру логина нет — почту/пароль не возвращаем.
  return owner ? { ok: true, email: '', password: '' } : { ok: true, email, password };
}

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
  revalidatePath('/');
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
