'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser, scopeBuyerId } from '@/lib/auth';
import { isAttendanceKind } from '@/lib/attendance';

const Input = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  buyerId: z.string().min(1),
  kind: z.string().refine(isAttendanceKind, 'неизвестный тип'),
  minutes: z.number().int().min(0).max(1440),
  note: z.string().max(200),
});

export async function markAttendance(formData: FormData) {
  const user = await requireUser();
  const scoped = scopeBuyerId(user);

  const parsed = Input.safeParse({
    date: String(formData.get('date') ?? ''),
    buyerId: scoped ?? String(formData.get('buyerId') ?? ''),
    kind: String(formData.get('kind') ?? ''),
    minutes: Number(formData.get('minutes') ?? 0),
    note: String(formData.get('note') ?? ''),
  });
  if (!parsed.success) return;

  const data = {
    date: new Date(`${parsed.data.date}T00:00:00.000Z`),
    buyerId: parsed.data.buyerId,
    kind: parsed.data.kind,
    // Минуты имеют смысл только у опоздания; для остальных обнуляем, чтобы в
    // отчётах не всплывал мусор из прошлого выбора.
    minutes: parsed.data.kind === 'LATE' ? parsed.data.minutes : 0,
    note: parsed.data.note,
  };

  const mark = await prisma.attendance.upsert({
    where: { buyerId_date: { buyerId: data.buyerId, date: data.date } },
    create: data,
    update: data,
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Attendance',
      entityId: mark.id,
      action: 'upsert',
      diffJson: JSON.stringify(data),
    },
  });

  revalidatePath('/attendance');
}

export async function clearAttendance(formData: FormData) {
  const user = await requireUser();
  const scoped = scopeBuyerId(user);
  const id = String(formData.get('id') ?? '');

  const mark = await prisma.attendance.findUnique({ where: { id } });
  if (!mark) return;
  if (scoped && mark.buyerId !== scoped) return;

  await prisma.attendance.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Attendance',
      entityId: id,
      action: 'delete',
      diffJson: JSON.stringify({ date: mark.date, kind: mark.kind }),
    },
  });

  revalidatePath('/attendance');
}
