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
  1: { label: 'бан · integrity', tone: 'bad' },
  2: { label: 'проверка IP', tone: 'warn' },
  3: { label: 'риск-платёж', tone: 'warn' },
  4: { label: 'закрыт', tone: 'bad' },
  5: { label: 'проверка AFC', tone: 'warn' },
  7: { label: 'проверка рисков', tone: 'warn' },
  8: { label: 'бан · политики', tone: 'bad' },
  9: { label: 'первичный бан', tone: 'bad' },
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
