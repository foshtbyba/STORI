'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireTeamView } from '@/lib/auth';
import { moneyInputToCents } from '@/lib/format';

const list = (raw: FormDataEntryValue | null) =>
  JSON.stringify(
    String(raw ?? '')
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  );

export async function saveOffer(formData: FormData) {
  await requireTeamView();
  const id = String(formData.get('id') ?? '');
  const data = {
    name: String(formData.get('name') ?? '').trim(),
    vertical: String(formData.get('vertical') ?? '').trim(),
    network: String(formData.get('network') ?? '').trim(),
    status: String(formData.get('status') ?? 'ACTIVE'),
    payout: String(formData.get('payout') ?? '').trim(),
    geosJson: list(formData.get('geos')),
    bansJson: list(formData.get('bans')),
    notesJson: list(formData.get('notes')),
    previewUrl: String(formData.get('previewUrl') ?? '').trim() || null,
  };
  if (!data.name) return;

  if (id) await prisma.offer.update({ where: { id }, data });
  else await prisma.offer.create({ data });

  revalidatePath('/offers');
}

export async function deleteOffer(formData: FormData) {
  await requireTeamView();
  const id = String(formData.get('id') ?? '');
  if (id) await prisma.offer.delete({ where: { id } });
  revalidatePath('/offers');
}

const ConsumableInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  typeId: z.string().min(1),
  buyerId: z.string().min(1),
  qty: z.number().int().min(1).max(9999),
  totalCents: z.number().int().min(0),
  note: z.string().max(300).optional(),
});

/**
 * Расходники заводит команда, а не сам баер: списание уменьшает его базу для
 * зарплаты, поэтому право записи здесь — конфликт интересов. Баер их видит,
 * но не добавляет и не удаляет.
 *
 * Списание всегда именное: каждый расходник закрепляется за конкретным баером
 * и вычитается из его профита. Общекомандных списаний нет.
 */
export async function addConsumable(formData: FormData) {
  const user = await requireTeamView();
  const buyerId = String(formData.get('buyerId') ?? '');

  const parsed = ConsumableInput.safeParse({
    date: String(formData.get('date') ?? ''),
    typeId: String(formData.get('typeId') ?? ''),
    buyerId,
    qty: Number(formData.get('qty') ?? 1),
    totalCents: moneyInputToCents(formData.get('total')),
    note: String(formData.get('note') ?? ''),
  });
  if (!parsed.success) return;

  const entry = await prisma.consumableEntry.create({
    data: {
      date: new Date(`${parsed.data.date}T00:00:00.000Z`),
      typeId: parsed.data.typeId,
      buyerId: parsed.data.buyerId,
      qty: parsed.data.qty,
      totalCents: parsed.data.totalCents,
      note: parsed.data.note ?? '',
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'ConsumableEntry',
      entityId: entry.id,
      action: 'create',
      diffJson: JSON.stringify(parsed.data),
    },
  });

  revalidatePath('/consumables');
  revalidatePath('/');
}

export async function deleteConsumable(formData: FormData) {
  const user = await requireTeamView();
  const id = String(formData.get('id') ?? '');
  const entry = await prisma.consumableEntry.findUnique({ where: { id } });
  if (!entry) return;
  await prisma.consumableEntry.delete({ where: { id } });
  revalidatePath('/consumables');
  revalidatePath('/');
}
