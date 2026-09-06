'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireUser, requireTeamView, scopeBuyerId } from '@/lib/auth';
import { isAttendanceKind, isSelfKind } from '@/lib/attendance';

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
  // Себе баер ставит только отпуск и отгул: остальное — работа админа.
  if (scoped && !isSelfKind(parsed.data.kind)) return;

  const when = new Date(`${parsed.data.date}T00:00:00.000Z`);

  if (scoped) {
    // Заявкой нельзя затереть то, что на этот день поставил админ: иначе
    // прогул превращался бы в отгул одним нажатием.
    const existing = await prisma.attendance.findUnique({
      where: { buyerId_date: { buyerId: scoped, date: when } },
    });
    if (existing && !isSelfKind(existing.kind)) return;
  }

  const data = {
    date: when,
    buyerId: parsed.data.buyerId,
    kind: parsed.data.kind,
    // Заявка баера ждёт админа; то, что ставит админ, действует сразу.
    status: scoped ? 'PENDING' : 'APPROVED',
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
  if (scoped && (mark.buyerId !== scoped || !isSelfKind(mark.kind))) return;

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

/** Ответ админа на заявку. Отказ не стираем — баер должен увидеть решение. */
async function decide(formData: FormData, status: 'APPROVED' | 'REJECTED') {
  const user = await requireTeamView();
  const id = String(formData.get('id') ?? '');
  const mark = await prisma.attendance.findUnique({ where: { id } });
  if (!mark) return;

  await prisma.attendance.update({ where: { id }, data: { status } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'Attendance',
      entityId: id,
      action: status === 'APPROVED' ? 'approve' : 'reject',
      diffJson: JSON.stringify({ date: mark.date, kind: mark.kind }),
    },
  });

  revalidatePath('/attendance');
}

export async function approveAttendance(formData: FormData) {
  await decide(formData, 'APPROVED');
}

export async function rejectAttendance(formData: FormData) {
  await decide(formData, 'REJECTED');
}
