/**
 * Каталог плейсментов Facebook/Instagram для автозалива и сборка их в таргетинг
 * адсета. Обычный модуль (не server-only): каталог нужен и клиенту (галочки в
 * шаблоне), и серверу (сборка targeting).
 *
 * Пусто = автоматические плейсменты (Advantage+ placements) — тогда позиции не
 * задаём и ФБ раскидывает сам. Есть выбор — уходим в ручные: собираем
 * publisher_platforms и *_positions по выбранным.
 */
export type Placement = {
  key: string;
  label: string;
  platform: 'facebook' | 'instagram' | 'audience_network' | 'messenger' | 'threads';
  field: 'facebook_positions' | 'instagram_positions' | 'audience_network_positions' | 'messenger_positions' | 'threads_positions';
  value: string;
};

export const PLACEMENTS: Placement[] = [
  { key: 'fb_feed', label: 'FB лента', platform: 'facebook', field: 'facebook_positions', value: 'feed' },
  { key: 'fb_profile_feed', label: 'FB лента профиля', platform: 'facebook', field: 'facebook_positions', value: 'profile_feed' },
  { key: 'fb_marketplace', label: 'FB Маркетплейс', platform: 'facebook', field: 'facebook_positions', value: 'marketplace' },
  { key: 'fb_video_feeds', label: 'FB видеолента', platform: 'facebook', field: 'facebook_positions', value: 'video_feeds' },
  { key: 'fb_story', label: 'FB Истории', platform: 'facebook', field: 'facebook_positions', value: 'story' },
  { key: 'fb_reels', label: 'FB Reels', platform: 'facebook', field: 'facebook_positions', value: 'facebook_reels' },
  { key: 'fb_instream', label: 'FB In-stream видео', platform: 'facebook', field: 'facebook_positions', value: 'instream_video' },
  { key: 'fb_search', label: 'FB Поиск', platform: 'facebook', field: 'facebook_positions', value: 'search' },
  { key: 'ig_stream', label: 'IG лента', platform: 'instagram', field: 'instagram_positions', value: 'stream' },
  { key: 'ig_story', label: 'IG Истории', platform: 'instagram', field: 'instagram_positions', value: 'story' },
  { key: 'ig_explore', label: 'IG Интересное', platform: 'instagram', field: 'instagram_positions', value: 'explore' },
  { key: 'ig_reels', label: 'IG Reels', platform: 'instagram', field: 'instagram_positions', value: 'reels' },
  { key: 'ig_search', label: 'IG Поиск', platform: 'instagram', field: 'instagram_positions', value: 'ig_search' },
  { key: 'threads_home', label: 'Threads лента', platform: 'threads', field: 'threads_positions', value: 'threads_home' },
  { key: 'an_classic', label: 'Audience Network', platform: 'audience_network', field: 'audience_network_positions', value: 'classic' },
  { key: 'msg_home', label: 'Messenger', platform: 'messenger', field: 'messenger_positions', value: 'messenger_home' },
  { key: 'msg_story', label: 'Messenger Истории', platform: 'messenger', field: 'messenger_positions', value: 'story' },
];

const BY_KEY = new Map(PLACEMENTS.map((p) => [p.key, p]));

/** Оставить только известные ключи, без повторов. */
export function validPlacementKeys(keys: string[]): string[] {
  return [...new Set(keys.map((k) => k.trim()).filter((k) => BY_KEY.has(k)))];
}

/**
 * Убрать из выбора плейсмент по ЗНАЧЕНИЮ поля ФБ (напр. «threads_feed»), когда
 * кабинет/цель его не приняли. Возвращает оставшиеся ключи.
 */
export function stripPlacementValue(keys: string[], fbValue: string): string[] {
  return validPlacementKeys(keys).filter((k) => BY_KEY.get(k)?.value !== fbValue);
}

/**
 * Убрать плейсменты «семейства Instagram» (сам Instagram + Threads — Threads
 * показывается в приложении IG и тоже требует IG-идентичности). Нужно, когда для
 * кабинета не удалось получить/создать IG-аккаунт: иначе ФБ отбивает объявление
 * кодом 1772103. Оставляем только Facebook/Audience Network/Messenger.
 */
export function stripInstagramFamily(keys: string[]): string[] {
  return validPlacementKeys(keys).filter((k) => {
    const p = BY_KEY.get(k);
    return p ? p.platform !== 'instagram' && p.platform !== 'threads' : false;
  });
}

/** Короткая подпись выбранных плейсментов для сводки шаблона. */
export function placementSummary(csv: string): string {
  const keys = validPlacementKeys(csv.split(','));
  if (keys.length === 0) return 'плейсменты: авто';
  if (keys.length <= 3) return keys.map((k) => BY_KEY.get(k)!.label).join(', ');
  return `${keys.length} плейсментов`;
}

/**
 * Собрать фрагмент таргетинга по выбранным плейсментам. null — выбора нет,
 * значит авто-плейсменты (позиции не трогаем).
 */
export function buildPlacementTargeting(keys: string[]): Record<string, string[]> | null {
  const valid = validPlacementKeys(keys);
  if (valid.length === 0) return null;
  const platforms = new Set<string>();
  const fields: Record<string, string[]> = {};
  for (const k of valid) {
    const p = BY_KEY.get(k)!;
    platforms.add(p.platform);
    (fields[p.field] ??= []).push(p.value);
  }
  return { publisher_platforms: [...platforms], ...fields };
}
