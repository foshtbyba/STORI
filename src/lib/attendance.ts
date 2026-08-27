export const ATTENDANCE_KINDS = {
  LATE: { label: 'Опоздание', short: 'ОП', color: '#d2a06a', tint: '#2e271c' },
  ABSENT: { label: 'Прогул', short: 'ПР', color: '#ce6e58', tint: '#2c1f1a' },
  VACATION: { label: 'Отпуск', short: 'ОТ', color: '#6fa9a0', tint: '#1e2a28' },
  DAYOFF: { label: 'Выходной', short: 'ВЫ', color: '#8fa3a8', tint: '#23292b' },
  SICK: { label: 'Больничный', short: 'БЛ', color: '#a8a8a8', tint: '#232324' },
} as const;

export type AttendanceKind = keyof typeof ATTENDANCE_KINDS;

/**
 * Что баер вправе поставить себе сам. Отпуск и отгул он планирует, а опоздания,
 * прогулы и больничные фиксирует админ — иначе отметка о дисциплине ничего не
 * стоит, её всегда можно было бы снять задним числом.
 */
export const SELF_KINDS: AttendanceKind[] = ['VACATION', 'DAYOFF'];

export function isSelfKind(kind: string) {
  return (SELF_KINDS as string[]).includes(kind);
}

/**
 * Заявка баера живёт тремя состояниями: ждёт админа, согласована, отклонена.
 * Отклонённую не удаляем — баер должен увидеть ответ, а не молчание.
 */
export const ATTENDANCE_STATUS = {
  PENDING: { label: 'на согласовании', short: 'ждёт', color: '#d2a06a', tint: '#2e271c' },
  APPROVED: { label: 'согласовано', short: 'ок', color: '#b4c68c', tint: '#252e1e' },
  REJECTED: { label: 'отклонено', short: 'нет', color: '#ce6e58', tint: '#2c1f1a' },
} as const;

export type AttendanceStatus = keyof typeof ATTENDANCE_STATUS;

export function statusMeta(status: string) {
  return ATTENDANCE_STATUS[status as AttendanceStatus] ?? ATTENDANCE_STATUS.APPROVED;
}

export function isAttendanceKind(v: string): v is AttendanceKind {
  return v in ATTENDANCE_KINDS;
}

export function kindMeta(kind: string) {
  return ATTENDANCE_KINDS[kind as AttendanceKind] ?? ATTENDANCE_KINDS.DAYOFF;
}

/**
 * Опоздания складываем в минуты, остальное считаем днями. Несогласованные
 * заявки в счёт не идут: отпуск считается состоявшимся только после аппрува.
 */
export function summarise(all: { kind: string; minutes: number; status: string }[]) {
  const marks = all.filter((m) => m.status === 'APPROVED');
  const lateCount = marks.filter((m) => m.kind === 'LATE').length;
  const lateMinutes = marks.filter((m) => m.kind === 'LATE').reduce((a, m) => a + m.minutes, 0);
  const count = (kind: AttendanceKind) => marks.filter((m) => m.kind === kind).length;
  return {
    lateCount,
    lateMinutes,
    absent: count('ABSENT'),
    vacation: count('VACATION'),
    dayoff: count('DAYOFF'),
    sick: count('SICK'),
  };
}
