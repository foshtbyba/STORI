import 'server-only';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { currentUser } from './session';
import { canSeeTeam, type Role } from './roles';

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/** Every page under (app) calls this; unauthenticated visitors land on /login. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect('/login');
  return user;
}

/** Командные экраны. Баера отправляем на его кабинет — это корень. */
export async function requireTeamView() {
  const user = await requireUser();
  if (!canSeeTeam(user.role as Role)) redirect('/');
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== 'ADMIN') redirect('/');
  return user;
}

/**
 * Buyers may only ever address their own rows. Returns the buyer id a request
 * is allowed to act on, or null when the caller may act on the whole team.
 */
export function scopeBuyerId(user: { role: string; buyer: { id: string } | null }) {
  return canSeeTeam(user.role as Role) ? null : (user.buyer?.id ?? '__none__');
}
