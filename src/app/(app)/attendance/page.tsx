import { requireUser, scopeBuyerId } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import {
  periodBounds, periodLabel, daysOfPeriod, dayKey, shiftPeriod, fmtDay, weekdayShort,
} from '@/lib/period';
import { canSeeTeam, type Role } from '@/lib/roles';
import {
  ATTENDANCE_KINDS, SELF_KINDS, isSelfKind as isSelf, kindMeta, statusMeta, summarise,
} from '@/lib/attendance';
import {
  markAttendance, clearAttendance, approveAttendance, rejectAttendance,
} from '@/app/actions/attendance';
import { Panel, PanelHead, Sub, Avatar, Empty } from '@/components/ui';
import Select from '@/components/Select';
import { IconCalendar } from '@/components/icons';

export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const { period } = await searchParams;
  const key = period ?? (await currentPeriodKey());
  const { from, to } = periodBounds(key);
  const scoped = scopeBuyerId(user);
  const team = canSeeTeam(user.role as Role);

  const [buyers, marks] = await Promise.all([
    prisma.buyer.findMany({
      where: { archived: false, ...(scoped ? { id: scoped } : {}) },
      orderBy: { handle: 'asc' },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: from, lt: to }, ...(scoped ? { buyerId: scoped } : {}) },
      orderBy: { date: 'asc' },
    }),
  ]);

  const days = daysOfPeriod(key);
  const byBuyerDay = new Map<string, (typeof marks)[number]>();
  for (const mark of marks) byBuyerDay.set(`${mark.buyerId}_${dayKey(mark.date)}`, mark);

  const today = new Date().toISOString().slice(0, 10);
  const field = 'h-11 rounded-xl border border-line bg-sub px-3.5 text-[14px] outline-none';
  const pending = marks.filter((m) => m.status === 'PENDING');

  // Баер заводит себе только отпуск и отгул, и они уходят админу на аппрув —
  // поэтому у него другая форма: без выбора баера, типа отметки и минут.
  const kinds = team
    ? Object.keys(ATTENDANCE_KINDS)
    : (SELF_KINDS as string[]);

  return (
    <div className="flex flex-col gap-3.5">
      <form
        action={markAttendance}
        className={`grid items-end gap-3 rounded-[26px] border border-line bg-panel p-5 ${
          team ? 'grid-cols-[repeat(4,1fr)_1.4fr_auto]' : 'grid-cols-[1fr_1fr_1.6fr_auto]'
        }`}
      >
        <input type="date" name="date" defaultValue={today} required className={`n ${field}`} />
        {team ? (
          <Select
            name="buyerId"
            defaultValue={buyers[0]?.id ?? ''}
            placeholder={buyers.length ? 'Баер' : 'Баеры не заведены'}
            options={buyers.map((b) => ({ value: b.id, label: b.handle }))}
          />
        ) : null}
        <Select
          name="kind"
          defaultValue={kinds[0]}
          options={kinds.map((code) => ({ value: code, label: kindMeta(code).label }))}
        />
        {team ? (
          <input
            name="minutes"
            type="number"
            min={0}
            defaultValue={0}
            className={`n ${field}`}
            placeholder="минут"
            title="Минуты опоздания — для остальных отметок не учитываются"
          />
        ) : null}
        <input name="note" className={field} placeholder="Комментарий" />
        <button type="submit" className="h-11 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg">
          {team ? 'Отметить' : 'Отправить на согласование'}
        </button>
      </form>

      {team && pending.length > 0 ? (
        <Panel className="p-6">
          <PanelHead
            icon={<IconCalendar color="#d2a06a" />}
            tint="bg-amber-t"
            title="Заявки на согласование"
            aside={<span className="text-[12.5px] text-mute">{pending.length} шт.</span>}
          />
          <div className="mt-4">
            {pending.map((mark) => {
              const meta = kindMeta(mark.kind);
              const buyer = buyers.find((b) => b.id === mark.buyerId);
              return (
                <div
                  key={mark.id}
                  className="grid grid-cols-[0.6fr_1fr_1fr_2fr_auto] items-center gap-3 border-t border-line py-2.5"
                >
                  <span className="n text-[13px]">
                    {String(mark.date.getUTCDate()).padStart(2, '0')}.
                    {String(mark.date.getUTCMonth() + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[13px] text-soft">{buyer?.handle ?? '—'}</span>
                  <span
                    className="w-fit rounded-full px-3 py-1 text-[12px] font-semibold"
                    style={{ background: meta.tint, color: meta.color }}
                  >
                    {meta.label}
                  </span>
                  <span className="truncate text-[12.5px] text-mute">{mark.note || '—'}</span>
                  <span className="flex items-center gap-2">
                    <form action={approveAttendance}>
                      <input type="hidden" name="id" value={mark.id} />
                      <button
                        type="submit"
                        className="rounded-full bg-sage px-4 py-1.5 text-[12px] font-semibold text-bg transition hover:opacity-90"
                      >
                        Согласовать
                      </button>
                    </form>
                    <form action={rejectAttendance}>
                      <input type="hidden" name="id" value={mark.id} />
                      <button
                        type="submit"
                        className="rounded-full bg-sub px-4 py-1.5 text-[12px] font-semibold text-rust transition hover:bg-raise"
                      >
                        Отклонить
                      </button>
                    </form>
                  </span>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      <Panel className="p-6">
        <PanelHead
          icon={<IconCalendar color="#d2a06a" />}
          tint="bg-amber-t"
          title="Календарь"
          aside={<span className="text-[12.5px] text-mute">{periodLabel(key)}</span>}
          right={
            <span className="flex items-center gap-2">
              <a href={`/attendance?period=${shiftPeriod(key, -1)}`}
                className="rounded-full bg-sub px-3.5 py-1.5 text-[12.5px] text-mute transition hover:text-soft">
                ← предыдущий
              </a>
              <a href={`/attendance?period=${shiftPeriod(key, 1)}`}
                className="rounded-full bg-sub px-3.5 py-1.5 text-[12.5px] text-mute transition hover:text-soft">
                следующий →
              </a>
            </span>
          }
        />

        <div className="mt-4 flex flex-wrap items-center gap-4">
          {Object.entries(ATTENDANCE_KINDS).map(([code, meta]) => (
            <span key={code} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: meta.color }} />
              <span className="text-[12px] text-mute">{meta.label}</span>
            </span>
          ))}
          <span className="h-3 w-px bg-line2" />
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded border border-dashed" style={{ borderColor: '#d2a06a' }} />
            <span className="text-[12px] text-mute">ждёт согласования</span>
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded border" style={{ borderColor: '#ce6e58' }} />
            <span className="text-[12px] text-mute">отклонено</span>
          </span>
        </div>

        {buyers.length === 0 ? (
          <div className="mt-5">
            <Empty>Баеров пока нет.</Empty>
          </div>
        ) : (
          <div className="mt-5">
            {/* Подсказке нужен запас по высоте: контейнер со скроллом по
                горизонтали режет и по вертикали, поэтому даём поля и гасим их
                отрицательным внешним отступом. */}
            <div className="-my-28 overflow-x-auto py-28">
              <div className="min-w-max">
              <div className="mb-1.5 flex gap-1 pl-[168px]">
                {days.map((day) => (
                  <span
                    key={day.toISOString()}
                    className="n w-6 text-center text-[9.5px] text-faint"
                  >
                    {day.getUTCDate()}
                  </span>
                ))}
              </div>

              {buyers.map((buyer) => {
                const mine = marks.filter((m) => m.buyerId === buyer.id);
                const stat = summarise(mine);
                return (
                  <div key={buyer.id} className="flex items-center gap-1 border-t border-line py-2">
                    <span className="flex w-[168px] shrink-0 items-center gap-2.5 pr-3">
                      <Avatar initials={buyer.initials} color={buyer.color} size={28} />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold">{buyer.handle}</span>
                        <span className="block text-[10.5px] text-mute">
                          {stat.lateCount ? `оп. ${stat.lateCount} · ${stat.lateMinutes} мин` : 'без опозданий'}
                          {stat.absent ? ` · прогулов ${stat.absent}` : ''}
                        </span>
                      </span>
                    </span>

                    {days.map((day) => {
                      const mark = byBuyerDay.get(`${buyer.id}_${dayKey(day)}`);
                      const meta = mark ? kindMeta(mark.kind) : null;
                      const state = mark ? statusMeta(mark.status) : null;
                      const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
                      // Согласованная отметка залита цветом причины, заявка и
                      // отказ — только контуром: видно, что день ещё не твой.
                      const settled = !mark || mark.status === 'APPROVED';
                      return (
                        <span
                          key={day.toISOString()}
                          className="group relative flex h-7 w-6 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
                          style={{
                            background: settled
                              ? meta
                                ? meta.color
                                : weekend
                                  ? '#1f1f20'
                                  : '#232324'
                              : state!.tint,
                            border: settled ? undefined : `1px ${mark!.status === 'PENDING' ? 'dashed' : 'solid'} ${state!.color}`,
                            color: settled ? (meta ? '#141414' : 'transparent') : state!.color,
                          }}
                        >
                          {meta?.short ?? ''}
                          {mark ? (
                            <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-[210px] -translate-x-1/2 rounded-xl border border-line2 bg-raise p-3 text-left shadow-lg shadow-black/50 group-hover:block">
                              <span className="mb-1.5 flex items-center justify-between gap-2">
                                <span className="n text-[12px] text-soft">
                                  {fmtDay(day)}
                                  <span className="ml-1.5 text-[10.5px] text-mute">{weekdayShort(day)}</span>
                                </span>
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-semibold"
                                  style={{ background: meta!.tint, color: meta!.color }}
                                >
                                  {meta!.label}
                                </span>
                              </span>
                              {mark.minutes ? (
                                <span className="n block text-[11.5px] text-mid">
                                  опоздание {mark.minutes} мин
                                </span>
                              ) : null}
                              <span className="block text-[11.5px] leading-snug text-mute">
                                {mark.note || 'без комментария'}
                              </span>
                              {mark.status === 'APPROVED' && !isSelf(mark.kind) ? null : (
                                <span
                                  className="mt-1.5 block text-[11px] font-semibold"
                                  style={{ color: state!.color }}
                                >
                                  {state!.label}
                                </span>
                              )}
                            </span>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        )}
      </Panel>

      <Panel className="p-6">
        <PanelHead
          icon={<IconCalendar color="#d2a06a" />}
          tint="bg-amber-t"
          title="Отметки за месяц"
          aside={<span className="text-[12.5px] text-mute">{marks.length} шт.</span>}
        />
        {marks.length === 0 ? (
          <div className="mt-4">
            <Empty>За {periodLabel(key)} отметок нет.</Empty>
          </div>
        ) : (
          <div className="mt-4">
            {[...marks].reverse().map((mark) => {
              const meta = kindMeta(mark.kind);
              const state = statusMeta(mark.status);
              const buyer = buyers.find((b) => b.id === mark.buyerId);
              return (
                <div
                  key={mark.id}
                  className="grid grid-cols-[0.6fr_1fr_1fr_1.1fr_2fr_auto] items-center gap-3 border-t border-line py-2.5"
                >
                  <span className="n text-[13px]">
                    {String(mark.date.getUTCDate()).padStart(2, '0')}.
                    {String(mark.date.getUTCMonth() + 1).padStart(2, '0')}
                  </span>
                  <span className="text-[13px] text-soft">{buyer?.handle ?? '—'}</span>
                  <span
                    className="w-fit rounded-full px-3 py-1 text-[12px] font-semibold"
                    style={{ background: meta.tint, color: meta.color }}
                  >
                    {meta.label}
                    {mark.minutes ? ` · ${mark.minutes} мин` : ''}
                  </span>
                  <span className="text-[12px]" style={{ color: state.color }}>
                    {mark.status === 'APPROVED' && !isSelf(mark.kind) ? '—' : state.label}
                  </span>
                  <span className="truncate text-[12.5px] text-mute">{mark.note || '—'}</span>
                  {team || isSelf(mark.kind) ? (
                    <form action={clearAttendance}>
                      <input type="hidden" name="id" value={mark.id} />
                      <button type="submit" className="text-[11px] text-dim transition hover:text-rust">
                        ✕
                      </button>
                    </form>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
