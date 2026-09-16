'use server';

import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

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
