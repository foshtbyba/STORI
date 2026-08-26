export const ATTENDANCE_KINDS = {
  LATE: { label: 'Опоздание', short: 'ОП', color: '#d2a06a', tint: '#2e271c' },
  ABSENT: { label: 'Прогул', short: 'ПР', color: '#ce6e58', tint: '#2c1f1a' },
  VACATION: { label: 'Отпуск', short: 'ОТ', color: '#6fa9a0', tint: '#1e2a28' },
  DAYOFF: { label: 'Выходной', short: 'ВЫ', color: '#8fa3a8', tint: '#23292b' },
  SICK: { label: 'Больничный', short: 'БЛ', color: '#a8a8a8', tint: '#232324' },
} as const;

export type AttendanceKind = keyof typeof ATTENDANCE_KINDS;

export function isAttendanceKind(v: string): v is AttendanceKind {
  return v in ATTENDANCE_KINDS;
}

export function kindMeta(kind: string) {
  return ATTENDANCE_KINDS[kind as AttendanceKind] ?? ATTENDANCE_KINDS.DAYOFF;
}

/** Опоздания складываем в минуты, остальное считаем днями. */
export function summarise(marks: { kind: string; minutes: number }[]) {
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
