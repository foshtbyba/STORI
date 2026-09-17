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
  /** Идемпотентный ключ: если задан и такое событие уже есть — не дублируем. */
  refKey?: string;
};

/** Записать событие. Никогда не роняет вызывающий код (fire-and-forget). */
export async function logActivity(a: ActivityInput): Promise<void> {
  try {
    if (a.refKey) {
      const dup = await prisma.activity.findFirst({ where: { refKey: a.refKey }, select: { id: true } });
      if (dup) return; // такое событие уже было — тихо выходим
    }
    await prisma.activity.create({
      data: {
        kind: a.kind,
        message: a.message.slice(0, 500),
        actorUserId: a.actorUserId ?? null,
        actorName: (a.actorName ?? '').slice(0, 80),
        adminOnly: Boolean(a.adminOnly),
        refKey: a.refKey ?? null,
      },
    });
  } catch {
    /* лог событий не критичен — молча пропускаем сбой */
  }
}

export type ActivityItem = { id: string; kind: string; message: string; actorName: string; when: string };
export type ActivityFeed = { items: ActivityItem[]; unread: number };

// ── Напоминания о днях рождения ────────────────────────────────────────────
// Раз в несколько часов (на процесс) проверяем ближайшие ДР и кладём в ленту
// напоминание за неделю. Дедуп — по нику баера в последние 10 дней, чтобы не
// плодить копии на каждый заход.
let lastBdayCheck = 0;

function daysUntilBirthday(bday: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = Date.UTC(now.getUTCFullYear(), bday.getUTCMonth(), bday.getUTCDate());
  if (next < today) next = Date.UTC(now.getUTCFullYear() + 1, bday.getUTCMonth(), bday.getUTCDate());
  return Math.round((next - today) / 86_400_000);
}

async function ensureBirthdayNotifications(): Promise<void> {
  const now = Date.now();
  if (now - lastBdayCheck < 6 * 3600 * 1000) return; // не чаще раза в 6 часов
  lastBdayCheck = now;
  try {
    const buyers = await prisma.buyer.findMany({
      where: { archived: false, birthday: { not: null } },
      select: { handle: true, birthday: true },
    });
    const today = new Date();
    const since = new Date(now - 10 * 86_400_000);
    for (const b of buyers) {
      if (!b.birthday) continue;
      const d = daysUntilBirthday(b.birthday, today);
      if (d < 0 || d > 7) continue;
      const exists = await prisma.activity.findFirst({
        where: { kind: 'birthday', actorName: b.handle, createdAt: { gt: since } },
        select: { id: true },
      });
      if (exists) continue;
      const when = d === 0 ? 'сегодня' : d === 1 ? 'завтра' : `через ${d} дн.`;
      await logActivity({ kind: 'birthday', message: `🎂 ${when} день рождения у ${b.handle}`, actorName: b.handle, adminOnly: true });
    }
  } catch {
    /* напоминания не критичны — молча пропускаем сбой */
  }
}

/** Лента и число непрочитанных для пользователя (по его роли и notifSeenAt). */
export async function getActivityFeed(user: { id: string; role: string }): Promise<ActivityFeed> {
  const team = canSeeTeam(user.role as Role);
  // Заодно подкидываем напоминания о ДР (внутри — троттлинг раз в 6 часов).
  await ensureBirthdayNotifications();
  const where = team ? {} : { actorUserId: user.id, adminOnly: false };

  // Лента не должна ронять весь layout: любая ошибка запроса (нет таблицы/
  // колонки, сбой БД) → отдаём пустую ленту, а не 500 на всё приложение.
  let rows: Awaited<ReturnType<typeof prisma.activity.findMany>> = [];
  let unread = 0;
  try {
    const me = await prisma.user.findUnique({ where: { id: user.id }, select: { notifSeenAt: true } });
    const seenAt = me?.notifSeenAt ?? new Date(0);
    [rows, unread] = await Promise.all([
      prisma.activity.findMany({ where, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.activity.count({ where: { ...where, createdAt: { gt: seenAt } } }),
    ]);
  } catch {
    return { items: [], unread: 0 };
  }

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
