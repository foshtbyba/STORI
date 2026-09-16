'use server';

import { prisma } from '@/lib/db';

export type LeadState = { ok: boolean; error?: string } | null;

/**
 * Публичная заявка «хочу в команду» с лендинга: человек оставляет свой Telegram.
 * Без авторизации. Лёгкая валидация + нормализация ника.
 */
export async function submitTeamLead(_prev: LeadState, form: FormData): Promise<LeadState> {
  let tg = String(form.get('telegram') ?? '').trim();
  const note = String(form.get('note') ?? '').trim().slice(0, 500);
  if (!tg) return { ok: false, error: 'Укажи свой Telegram' };

  // Нормализуем: убираем ссылку t.me/, лишний @, пробелы.
  tg = tg.replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '').replace(/^@+/, '').trim();
  if (tg.length < 3 || tg.length > 64 || /\s/.test(tg)) {
    return { ok: false, error: 'Похоже на неверный ник — проверь (например, @username)' };
  }

  try {
    await prisma.teamLead.create({ data: { telegram: `@${tg}`, note } });
    return { ok: true };
  } catch {
    return { ok: false, error: 'Не удалось отправить — попробуй ещё раз' };
  }
}
