'use server';

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getActivityFeed, type ActivityFeed } from '@/lib/activity';

/** Живой фид для колокольчика: клиент опрашивает раз в ~25с и по фокусу окна. */
export async function fetchActivityFeed(): Promise<ActivityFeed> {
  try {
    const user = await requireUser();
    return await getActivityFeed({ id: user.id, role: user.role });
  } catch {
    return { items: [], unread: 0 };
  }
}

/** Отметить уведомления просмотренными (сбрасывает счётчик непрочитанных). */
export async function markActivitySeen(): Promise<{ ok: boolean }> {
  try {
    const user = await requireUser();
    await prisma.user.update({ where: { id: user.id }, data: { notifSeenAt: new Date() } });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
