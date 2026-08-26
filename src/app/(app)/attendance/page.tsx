import { requireUser, scopeBuyerId } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { currentPeriodKey } from '@/lib/queries';
import { periodBounds, periodLabel, daysOfPeriod, dayKey, shiftPeriod } from '@/lib/period';
import { ATTENDANCE_KINDS, kindMeta, summarise } from '@/lib/attendance';
import { markAttendance, clearAttendance } from '@/app/actions/attendance';
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

  return (
    <div className="flex flex-col gap-3.5">
      <form
        action={markAttendance}
        className="grid grid-cols-[repeat(4,1fr)_1.4fr_auto] items-end gap-3 rounded-[26px] border border-line bg-panel p-5"
      >
        <input type="date" name="date" defaultValue={today} required className={`n ${field}`} />
        {scoped ? null : (
          <Select
            name="buyerId"
            defaultValue={buyers[0]?.id ?? ''}
            placeholder={buyers.length ? 'Баер' : 'Баеры не заведены'}
            options={buyers.map((b) => ({ value: b.id, label: b.handle }))}
          />
        )}
        <Select
          name="kind"
          defaultValue="LATE"
          options={Object.entries(ATTENDANCE_KINDS).map(([code, meta]) => ({
            value: code,
            label: meta.label,
          }))}
        />
        <input
          name="minutes"
          type="number"
          min={0}
          defaultValue={0}
          className={`n ${field}`}
          placeholder="минут"
          title="Минуты опоздания — для остальных отметок не учитываются"
        />
        <input name="note" className={field} placeholder="Комментарий" />
        <button type="submit" className="h-11 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg">
          Отметить
        </button>
      </form>

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

        <div className="mt-4 flex flex-wrap gap-4">
          {Object.entries(ATTENDANCE_KINDS).map(([code, meta]) => (
            <span key={code} className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: meta.color }} />
              <span className="text-[12px] text-mute">{meta.label}</span>
            </span>
          ))}
        </div>

        {buyers.length === 0 ? (
          <div className="mt-5">
            <Empty>Баеров пока нет.</Empty>
          </div>
        ) : (
          <div className="mt-5 overflow-x-auto">
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
                      const weekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
                      return (
                        <span
                          key={day.toISOString()}
                          className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-[9px] font-semibold"
                          style={{
                            background: meta ? meta.color : weekend ? '#1f1f20' : '#232324',
                            color: meta ? '#141414' : 'transparent',
                          }}
                          title={
                            mark
                              ? `${meta!.label}${mark.minutes ? ` · ${mark.minutes} мин` : ''}${mark.note ? ` · ${mark.note}` : ''}`
                              : undefined
                          }
                        >
                          {meta?.short ?? ''}
                        </span>
                      );
                    })}
                  </div>
                );
              })}
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
                    {mark.minutes ? ` · ${mark.minutes} мин` : ''}
                  </span>
                  <span className="truncate text-[12.5px] text-mute">{mark.note || '—'}</span>
                  <form action={clearAttendance}>
                    <input type="hidden" name="id" value={mark.id} />
                    <button type="submit" className="text-[11px] text-dim transition hover:text-rust">
                      ✕
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
