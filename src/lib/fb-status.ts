/**
 * Человеческая расшифровка статуса рекламного кабинета Facebook.
 *
 * Facebook отдаёт два числа: `account_status` (в каком состоянии кабинет) и
 * `disable_reason` (если отключён — за что). По ним собираем короткий ярлык и
 * тон (цвет), чтобы в списке было видно бан/риск/проверку с одного взгляда.
 *
 * Коды — из документации Marketing API; перечислены только те, что реально
 * встречаются у арендных кабинетов.
 */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'mute';
export type AccountBadge = { label: string; tone: StatusTone };

/** disable_reason: почему кабинет отключён. */
const DISABLE: Record<number, AccountBadge> = {
  1: { label: 'бан · нарушение правил', tone: 'bad' },
  2: { label: 'проверка кабинета', tone: 'warn' },
  3: { label: 'риск-платёж', tone: 'warn' },
  4: { label: 'закрыт', tone: 'bad' },
  5: { label: 'проверка оплаты', tone: 'warn' },
  7: { label: 'проверка рисков', tone: 'warn' },
  8: { label: 'бан · нарушение правил', tone: 'bad' },
  9: { label: 'бан навсегда', tone: 'bad' },
};

/** account_status: общее состояние кабинета. */
const STATUS: Record<number, AccountBadge> = {
  1: { label: 'активен', tone: 'ok' },
  2: { label: 'отключён', tone: 'bad' },
  3: { label: 'не оплачен', tone: 'warn' },
  7: { label: 'на проверке рисков', tone: 'warn' },
  8: { label: 'ждёт оплаты', tone: 'warn' },
  9: { label: 'грейс-период', tone: 'warn' },
  100: { label: 'закрывается', tone: 'bad' },
  101: { label: 'закрыт', tone: 'bad' },
  201: { label: 'активен', tone: 'ok' },
  202: { label: 'закрыт', tone: 'bad' },
};

/**
 * Ярлык статуса. Если кабинет отключён и известна причина — показываем
 * причину (она конкретнее), иначе общее состояние.
 */
export function accountBadge(accountStatus: number, disableReason: number): AccountBadge {
  if (accountStatus !== 1 && accountStatus !== 201 && disableReason && DISABLE[disableReason]) {
    return DISABLE[disableReason];
  }
  return STATUS[accountStatus] ?? { label: `статус ${accountStatus}`, tone: 'mute' };
}

/**
 * Состояние кампании (effective_status) человеческим ярлыком. «Запущена» —
 * зелёным, всё остальное приглушённее: на паузе, на модерации, отклонена.
 */
const CAMPAIGN: Record<string, AccountBadge> = {
  ACTIVE: { label: 'запущена', tone: 'ok' },
  PAUSED: { label: 'на паузе', tone: 'mute' },
  CAMPAIGN_PAUSED: { label: 'на паузе', tone: 'mute' },
  ADSET_PAUSED: { label: 'адсеты на паузе', tone: 'mute' },
  IN_PROCESS: { label: 'запускается', tone: 'warn' },
  PENDING_REVIEW: { label: 'на модерации', tone: 'warn' },
  WITH_ISSUES: { label: 'с проблемами', tone: 'warn' },
  PENDING_BILLING_INFO: { label: 'нет оплаты', tone: 'warn' },
  DISAPPROVED: { label: 'отклонена', tone: 'bad' },
  ARCHIVED: { label: 'в архиве', tone: 'mute' },
  DELETED: { label: 'удалена', tone: 'mute' },
};

export function campaignBadge(status: string): AccountBadge {
  return CAMPAIGN[status] ?? { label: status.toLowerCase(), tone: 'mute' };
}
