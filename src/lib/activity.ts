import 'server-only';

import { prisma } from './db';
import { canSeeTeam, type Role } from './roles';
import { fmtWhen } from './period';

/**
 * Лента событий (уведомления).
 *  • Успешные действия видит их автор (adminOnly=false, actorUserId).
 *  • Командные/денежные события (пополнение Brocard, добавление кабинета и т.п.)
 *    помечаем adminOnly=true — их видят только админы/команда.
 * Автор события всегда среди команды видит и свои, и все (team-скоуп).
 */
export type ActivityInput = {
  kind: string;
  message: string;
  actorUserId?: string | null;
  actorName?: string;
  adminOnly?: boolean;
};

/** Записать событие. Никогда не роняет вызывающий код (fire-and-forget). */
export async function logActivity(a: ActivityInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        kind: a.kind,
        message: a.message.slice(0, 500),
        actorUserId: a.actorUserId ?? null,
        actorName: (a.actorName ?? '').slice(0, 80),
        adminOnly: Boolean(a.adminOnly),
      },
    });
  } catch {
    /* лог событий не критичен — молча пропускаем сбой */
  }
}

export type ActivityItem = { id: string; kind: string; message: string; actorName: string; when: string };
export type ActivityFeed = { items: ActivityItem[]; unread: number };

/** Лента и число непрочитанных для пользователя (по его роли и notifSeenAt). */
export async function getActivityFeed(user: { id: string; role: string }): Promise<ActivityFeed> {
  const team = canSeeTeam(user.role as Role);
  const where = team ? {} : { actorUserId: user.id, adminOnly: false };

  const me = await prisma.user.findUnique({ where: { id: user.id }, select: { notifSeenAt: true } });
  const seenAt = me?.notifSeenAt ?? new Date(0);

  const [rows, unread] = await Promise.all([
    prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.activity.count({ where: { ...where, createdAt: { gt: seenAt } } }),
  ]);

  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      message: r.message,
      actorName: r.actorName,
      when: fmtWhen(r.createdAt),
    })),
    unread,
  };
}
