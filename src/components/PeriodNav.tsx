/**
 * Переключатель отрезка: стрелки листают, тумблер меняет масштаб.
 *
 * Отчётность считается за неделю, но иногда нужно глянуть месяц целиком — и
 * почти всегда нужно вернуться на прошлую.
 *
 * Ссылки нарочно самые обычные, без клиентского роутера. Страница целиком
 * зависит от отрезка: меняются и цифры, и график, и таблица, — экономить тут
 * нечего, а мягкий переход на потоковом ответе иногда молча терялся и адрес
 * оставался прежним. Полная перезагрузка честнее: всегда показывает то, что
 * написано в адресе.
 */
export default function PeriodNav({
  base,
  label,
  isWeek,
  prev,
  next,
  week,
  month,
  weeksOnly = false,
}: {
  /** Адрес страницы: / или /payroll. */
  base: string;
  label: string;
  isWeek: boolean;
  /** Оставлено для совместимости с вызовами; больше не используется. */
  isCurrent?: boolean;
  prev: string;
  next: string;
  week: string;
  month: string;
  /** У зарплаты месяца нет: расчётный период — неделя. */
  weeksOnly?: boolean;
}) {
  const href = (key: string) => (key === '' ? base : `${base}?p=${key}`);
  const tab = (active: boolean) =>
    `rounded-full px-3 py-1 text-[12px] transition ${
      active ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
    }`;
  const arrow =
    'flex h-7 w-7 items-center justify-center rounded-full text-mute transition hover:bg-sub hover:text-soft';

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {weeksOnly ? null : (
        <span className="flex items-center gap-1 rounded-full bg-sub p-1">
          <a href={href(week)} className={tab(isWeek)}>
            Неделя
          </a>
          <a href={href(month)} className={tab(!isWeek)}>
            Месяц
          </a>
        </span>
      )}

      {/* Кнопку «Сейчас» убрали: она то появлялась, то исчезала и сдвигала весь
          ряд. Возврат к текущей неделе теперь на иконке слева от заголовка. */}
      <span className="flex items-center gap-1">
        <a href={href(prev)} aria-label="Назад" className={arrow}>
          ‹
        </a>
        <span className="n min-w-[128px] text-center text-[12.5px] text-soft">{label}</span>
        <a href={href(next)} aria-label="Вперёд" className={arrow}>
          ›
        </a>
      </span>
    </div>
  );
}
