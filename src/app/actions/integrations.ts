'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { requireAdmin, requireUser } from '@/lib/auth';
import { checkToken, FbError } from '@/lib/fb';
import { checkTracker, KeitaroError } from '@/lib/keitaro';
import { checkBrocard, BrocardError } from '@/lib/brocard';
import { BROCARD_OVERHEAD } from '@/lib/brocard-const';
import { syncAll } from '@/lib/sync';

/**
 * Настройка интеграций. Всё здесь — только для админа: под этими ключами
 * лежит доступ к рекламным кабинетам и к трекеру команды.
 */

const Token = z.object({
  buyerId: z.string().min(1),
  label: z.string().trim().max(80).default(''),
  token: z.string().trim().min(20, 'Токен слишком короткий — похоже, скопировался не весь'),
});

export type ActionState = { ok: boolean; error?: string; message?: string } | null;

export async function addToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = Token.safeParse({
    buyerId: form.get('buyerId'),
    label: form.get('label') ?? '',
    token: form.get('token'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поля' };
  }

  // Токен проверяем сразу: класть в базу неработающий ключ, чтобы потом
  // гадать, почему нет цифр, — так себе идея.
  let found;
  try {
    found = await checkToken(parsed.data.token);
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }

  const created = await prisma.adToken.create({
    data: {
      buyerId: parsed.data.buyerId,
      label: parsed.data.label || found.name,
      token: parsed.data.token,
    },
  });

  // Кабинеты записываем сразу — иначе до первой синхронизации в настройках
  // пусто, и непонятно, сработало вообще или нет.
  for (const acc of found.accounts) {
    await prisma.adAccount.create({
      data: {
        tokenId: created.id,
        externalId: acc.externalId,
        name: acc.name,
        currency: acc.currency,
      },
    });
  }

  revalidatePath('/integrations');
  return { ok: true, message: `${found.name}: кабинетов найдено ${found.accounts.length}` };
}

/**
 * Баер привязывает СВОЙ кабинет сам, из раздела «Реклама». Никакого выбора
 * баера тут нет — токен всегда вешается на того, кто его добавляет.
 */
export async function addMyToken(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (!user.buyer) return { ok: false, error: 'У аккаунта нет профиля баера' };

  const token = String(form.get('token') ?? '').trim();
  const label = String(form.get('label') ?? '').trim().slice(0, 80);
  if (token.length < 20) {
    return { ok: false, error: 'Токен слишком короткий — похоже, скопировался не весь' };
  }

  let found;
  try {
    found = await checkToken(token);
  } catch (e) {
    return { ok: false, error: e instanceof FbError ? e.message : (e as Error).message };
  }

  const created = await prisma.adToken.create({
    data: { buyerId: user.buyer.id, label: label || found.name, token },
  });
  for (const acc of found.accounts) {
    await prisma.adAccount.create({
      data: { tokenId: created.id, externalId: acc.externalId, name: acc.name, currency: acc.currency },
    });
  }

  revalidatePath('/ads');
  revalidatePath('/integrations');
  return { ok: true, message: `${found.name}: кабинетов найдено ${found.accounts.length}` };
}

/** Свой токен баер может и удалить — только свой. */
export async function deleteMyToken(form: FormData) {
  const user = await requireUser();
  const id = String(form.get('id') ?? '');
  const token = id ? await prisma.adToken.findUnique({ where: { id } }) : null;
  // Чужой токен не трогаем: удалять можно только то, что привязано к себе.
  if (token && user.buyer && token.buyerId === user.buyer.id) {
    await prisma.adToken.delete({ where: { id } });
  }
  revalidatePath('/ads');
}

export async function deleteToken(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  if (id) await prisma.adToken.delete({ where: { id } });
  revalidatePath('/integrations');
}

export async function toggleToken(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const token = await prisma.adToken.findUnique({ where: { id } });
  if (token) {
    await prisma.adToken.update({ where: { id }, data: { enabled: !token.enabled } });
  }
  revalidatePath('/integrations');
}

export async function toggleAccount(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const acc = await prisma.adAccount.findUnique({ where: { id } });
  if (acc) await prisma.adAccount.update({ where: { id }, data: { enabled: !acc.enabled } });
  revalidatePath('/integrations');
}

const TrackerInput = z.object({
  baseUrl: z.string().trim().url('Адрес трекера должен быть полным: https://…'),
  apiKey: z.string().trim().min(8, 'Ключ слишком короткий'),
});

export async function saveTracker(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = TrackerInput.safeParse({
    baseUrl: form.get('baseUrl'),
    apiKey: form.get('apiKey'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поля' };
  }

  let found;
  try {
    found = await checkTracker(parsed.data.baseUrl, parsed.data.apiKey);
  } catch (e) {
    return { ok: false, error: e instanceof KeitaroError ? e.message : (e as Error).message };
  }

  const existing = await prisma.tracker.findFirst();
  if (existing) {
    await prisma.tracker.update({ where: { id: existing.id }, data: { ...parsed.data, lastError: '' } });
  } else {
    await prisma.tracker.create({ data: parsed.data });
  }

  // Группы заводим сразу, чтобы было что привязывать к баерам.
  for (const g of found.groups) {
    await prisma.trackerGroup.upsert({
      where: { externalId: g.id },
      update: { name: g.name, lastSeenAt: new Date() },
      create: { externalId: g.id, name: g.name, lastSeenAt: new Date() },
    });
  }

  revalidatePath('/integrations');
  return {
    ok: true,
    message: `Кампаний ${found.campaigns}, групп ${found.groups.length}`,
  };
}

export async function linkGroup(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const buyerId = String(form.get('buyerId') ?? '');
  if (id) {
    await prisma.trackerGroup.update({
      where: { id },
      data: { buyerId: buyerId || null },
    });
  }
  revalidatePath('/integrations');
}

const BrocardInput = z.object({
  apiKey: z.string().trim().min(8, 'Ключ слишком короткий'),
});

export async function saveBrocard(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = BrocardInput.safeParse({ apiKey: form.get('apiKey') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Проверь поле' };
  }

  let found;
  try {
    found = await checkBrocard(parsed.data.apiKey);
  } catch (e) {
    return { ok: false, error: e instanceof BrocardError ? e.message : (e as Error).message };
  }

  const existing = await prisma.brocardConfig.findFirst();
  if (existing) {
    await prisma.brocardConfig.update({
      where: { id: existing.id },
      data: { apiKey: parsed.data.apiKey, enabled: true, lastError: '' },
    });
  } else {
    await prisma.brocardConfig.create({ data: { apiKey: parsed.data.apiKey } });
  }

  // Команды заводим сразу — будет что привязывать к баерам.
  for (const t of found.teams) {
    await prisma.brocardTeam.upsert({
      where: { externalId: t.id },
      update: { name: t.name, lastSeenAt: new Date() },
      create: { externalId: t.id, name: t.name, lastSeenAt: new Date() },
    });
  }

  revalidatePath('/integrations');
  return { ok: true, message: `Команд найдено: ${found.teams.length}` };
}

export async function linkBrocardTeam(form: FormData) {
  await requireAdmin();
  const id = String(form.get('id') ?? '');
  const buyerId = String(form.get('buyerId') ?? '');
  if (id) {
    // «Расходники на команду» — общак: расход не идёт баеру, а копится отдельно.
    // Обычный баер снимает флаг общака; пусто — ни того, ни другого.
    const overhead = buyerId === BROCARD_OVERHEAD;
    await prisma.brocardTeam.update({
      where: { id },
      data: { buyerId: overhead ? null : buyerId || null, overhead },
    });
  }
  revalidatePath('/integrations');
  revalidatePath('/owners');
}

export async function runSync() {
  await requireAdmin();
  const result = await syncAll();
  revalidatePath('/integrations');
  revalidatePath('/days');
  revalidatePath('/');
  return result;
}
