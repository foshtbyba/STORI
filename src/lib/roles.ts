export const ROLES = ['ADMIN', 'LEAD', 'BUYER'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v);
}

/** Admins and leads see other people's numbers; buyers only ever see their own. */
export function canSeeTeam(role: Role) {
  return role === 'ADMIN' || role === 'LEAD';
}

export function canEditSettings(role: Role) {
  return role === 'ADMIN';
}
