'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

/** Вывод из фонда: сумма в долларах + комментарий. Только админ. */
export async function addFundWithdrawal(form: FormData) {
  const user = await requireAdmin();
  const dollars = Number(String(form.get('amount') ?? '').replace(',', '.'));
  const note = String(form.get('note') ?? '').trim().slice(0, 200);
  if (!Number.isFinite(dollars) || dollars <= 0) return;
  const cents = Math.round(dollars * 100);
  await prisma.fundEntry.create({ data: { kind: 'withdrawal', amountCents: cents, note } });
  await prisma.auditLog.create({
    data: {
      actorId: user.id,
      actorName: user.name,
      entity: 'FundEntry',
      entityId: 'withdrawal',
      action: 'fund:withdraw',
      diffJson: JSON.stringify({ cents, note }),
    },
  });
  revalidatePath('/');
}

/** Удалить запись фонда (вывод — свободно; накопление недели удалять нельзя,
 *  оно снимается только переоткрытием недели). Только админ. */
export async function deleteFundWithdrawal(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (!id) return;
  await prisma.fundEntry.deleteMany({ where: { id, kind: 'withdrawal' } });
  revalidatePath('/');
}
