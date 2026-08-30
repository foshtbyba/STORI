import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary, firstToCross, closedSheets } from '@/lib/queries';
import { periodTitle, fmtDay, isWeekKey, shiftKey } from '@/lib/period';
import PeriodNav from '@/components/PeriodNav';
import { prisma } from '@/lib/db';
import { usd, rub, sum } from '@/lib/money';
import { payrollTotals, parseTiers, okladCents, DEFAULT_FIXED_RUB } from '@/lib/salary';
import { closePeriod, reopenPeriod } from '@/app/actions/period';
import { Panel, PanelHead, Sub, Avatar, Empty, Formula, Big } from '@/components/ui';
import BonusPanel, { type BonusRow } from '@/components/BonusPanel';
import BuyerRoster, { type RosterRow } from '@/components/BuyerRoster';
import { Meter } from '@/components/Charts';
import { IconWallet, IconWarn, IconChart, IconCalendar, IconUsers } from '@/components/icons';

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; period?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);
  const { p, period } = await searchParams;
  const now = await currentPeriodKey();
  // Лист листается по неделям: закрытые недели никуда не деваются, их можно
  // открыть и посмотреть, кто сколько получил.
  const wanted = p ?? period;
  const key = wanted && isWeekKey(wanted) ? wanted : now;
  const summary = await teamSummary(key);
  const rate = summary.period.rubPerUsd;
  const closed = summary.period.status === 'CLOSED';

  // Админ видит расчётный лист по всей команде, баер — только свою строку.
  // Итоги считаем по видимым строкам, иначе баер прочитает командные суммы
  // в подвале таблицы.
  const rows = team ? summary.buyers : summary.buyers.filter((r) => r.buyer.id === scoped);
  const totals = payrollTotals(rows);
  const profitCents = sum(rows, (r) => r.profitCents);
  // В зарплатную базу входят только те расходники, что влияют на оклад. Если
  // сложить сюда и «не влияющие», строка «профит − расходники = считаем с» не
  // сойдётся: база вычитает лишь заряженные.
  const consumableCents = sum(rows, (r) =>
    r.buyer.consumablesAffectSalary ? r.consumableCents : 0,
  );

  async function close() {
    'use server';
    await closePeriod(key);
  }
  async function reopen() {
    'use server';
    await reopenPeriod(key);
  }

  // Выигрыш считаем от того, что человек получает сейчас, — на окладе это не
  // разница двух процентов, а разница между окладом и первым порогом.
  const gaps = rows
    .filter((r) => r.next)
    .map((r) => ({
      handle: r.buyer.handle,
      need: r.next!.needCents,
      gain: Math.max(
        0,
        Math.round((r.next!.fromCents * r.next!.ratePct) / 100) - r.salaryCents,
      ),
      to: r.next!.fromCents,
      progress: Math.max(0, Math.min(100, (r.baseCents / r.next!.fromCents) * 100)),
    }))
    .sort((a, b) => b.gain - a.gain);

  // Тот же разбор, что и в расчёте: если правило баеру не привязано, считаем и
  // рисуем по лесенке по умолчанию — иначе экран показывал бы пустоту там, где
  // зарплата уже посчитана.
  const ladder = rows[0] ? parseTiers(rows[0].buyer.salaryRule?.tiersJson) : [];
  // Минимальный порог — первая ступенька лесенки; ниже неё процента нет.
  const minTier = ladder[0]?.fromCents ?? 0;
  const okladRub = rows[0]?.buyer.salaryRule?.fixedRub ?? DEFAULT_FIXED_RUB;
  const okladUsdCents = okladCents(okladRub, rate);
  /**
   * Процент показываем только там, где он реально сработал. Если выплату
   * вытянул оклад, никакой ставки нет: оклад к базе отношения не имеет, и
   * деление одного на другое давало числа вроде 102,9%.
   */
  // Разовый бонус «за первые $5 000» вешаем на того, кто дошёл до отметки
  // раньше всех, а не на того, у кого больше всего к концу недели.
  const BONUS_THRESHOLD = 500_000;
  const [firstHit, bonusRows] = team
    ? await Promise.all([
        firstToCross(key, BONUS_THRESHOLD),
        prisma.bonus.findMany({
          where: { periodKey: key },
          include: { buyer: true },
          orderBy: { createdAt: 'desc' },
        }),
      ])
    : [null, []];

  // Архив закрытых листов: у баера — только его выплаты.
  const archive = (await closedSheets(team ? undefined : (scoped ?? '__none__'))).filter(
    (s) => s.key !== key,
  );

  // Ростер правит только админ. Берём полный список активных участников —
  // включая овнеров, чтобы их профиль тоже можно было настроить и при нужде
  // снять флаг.
  const rosterRows: RosterRow[] = team
    ? (
        await prisma.buyer.findMany({
          where: { archived: false },
          orderBy: [{ owner: 'asc' }, { handle: 'asc' }],
          select: {
            id: true, handle: true, initials: true, color: true,
            startedAt: true, birthday: true, position: true, owner: true,
          },
        })
      ).map((b) => ({
        id: b.id,
        handle: b.handle,
        initials: b.initials,
        color: b.color,
        startedAt: b.startedAt ? b.startedAt.toISOString().slice(0, 10) : '',
        birthday: b.birthday ? b.birthday.toISOString().slice(0, 10) : '',
        position: b.position ?? '',
        owner: b.owner,
      }))
    : [];

  const rateLabel =
    totals.avgRate === null ? 'оклад' : `${totals.avgRate.toFixed(1).replace('.', ',')}%`;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-[1.25fr_repeat(3,1fr)] lg:gap-3.5">
        <Panel className="flex flex-col justify-between p-6">
          <PanelHead
            icon={<IconWallet color="#b4c68c" />}
            tint="bg-sage-t"
            title={team ? 'Фонд зарплаты' : 'К выплате'}
          />
          <Big cents={totals.total} size={58} />
          <div className="n text-[12.5px] text-mute">{rub(totals.total, rate)}</div>
        </Panel>
        {[
          {
            label: team ? 'Средняя ставка' : 'Твоя ставка',
            value: rateLabel,
            note:
              totals.avgRate === null
                ? `порог ${usd(minTier)} не взят — платим ${okladRub.toLocaleString('ru-RU')} ₽`
                : `считаем с ${usd(totals.base)} — профит минус расходники`,
            color: totals.avgRate === null ? 'text-rust' : 'text-text',
          },
          { label: 'Разовые бонусы', value: usd(totals.bonus), note: 'начислены вручную', color: 'text-sage' },
          team
            ? { label: 'Остаётся команде', value: usd(summary.totals.teamNetCents), note: 'профит − расходники − ЗП', color: 'text-text' }
            : {
                label: 'Расходники',
                value: usd(consumableCents),
                note: 'списаны на тебя админом',
                color: 'text-rust',
              },
        ].map((s) => (
          <Panel key={s.label} className="flex flex-col justify-between p-6">
            <span className="lab">{s.label}</span>
            <span className={`n text-[34px] font-semibold tracking-[-0.03em] ${s.color}`}>{s.value}</span>
            <span className="text-[12px] text-mute">{s.note}</span>
          </Panel>
        ))}
      </div>

      <Panel className="flex flex-col p-4 sm:p-6">
        <PanelHead
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Расчётный лист"
          iconHref={key === now ? undefined : '/payroll'}
          iconTitle="Вернуться к текущей неделе"
          aside={<span className="text-[12.5px] text-mute">{periodTitle(key)}</span>}
          right={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <PeriodNav
                base="/payroll"
                label={periodTitle(key)}
                isWeek
                weeksOnly
                prev={shiftKey(key, -1)}
                next={shiftKey(key, 1)}
                week={key}
                month={key}
              />
            {user.role === 'ADMIN' ? (
              <form action={closed ? reopen : close}>
                <button
                  type="submit"
                  className={`rounded-full px-4 py-2 text-[12.5px] font-semibold transition hover:opacity-90 ${
                    closed ? 'bg-sub text-soft' : 'bg-sage text-bg'
                  }`}
                >
                  {closed ? 'Открыть период' : 'Закрыть период'}
                </button>
              </form>
            ) : (
              <span className={`text-[12.5px] ${closed ? 'text-mute' : 'text-rust'}`}>
                {closed ? 'период закрыт' : 'период открыт'}
              </span>
            )}
            </div>
          }
        />

        <div className="mt-5">
          <Formula
            steps={[
              { value: usd(profitCents), label: 'профит за период', color: '#b4c68c' },
              { value: usd(consumableCents), label: 'расходники', op: '−', color: '#ce6e58' },
              { value: usd(totals.base), label: 'с этого считаем процент', op: '=' },
              totals.avgRate === null
                ? { value: 'оклад', label: 'порог не взят', op: '→', color: '#ce6e58' }
                : { value: rateLabel, label: 'ставка по порогу', op: '×' },
              { value: usd(totals.total), label: 'к выплате с бонусами', op: '=', color: '#b4c68c' },
            ]}
          />
          <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
            {team
              ? 'Ставка у каждого своя — она определяется порогом, который он взял, и применяется ко всей сумме, а не только к превышению. В строке выше показана средняя по команде. '
              : 'Ставка определяется порогом, который ты взял, и применяется ко всей сумме, а не только к превышению над порогом. '}
            Ниже минимального порога {usd(minTier)} процента нет — платим оклад{' '}
            <span className="n text-soft">{okladRub.toLocaleString('ru-RU')} ₽</span>. Он же
            остаётся, если период закрыт в минус: оклад — нижняя граница выплаты, а не добавка
            сверху.
          </p>
        </div>

        <div className="mt-5 grid grid-cols-[1.4fr_0.7fr_1fr] lg:grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] pb-2.5">
          <span className="lab">Баер</span>
          <span className="lab hidden text-right lg:block">Профит</span>
          <span className="lab hidden text-right lg:block">Расходники</span>
          <span className="lab hidden text-right lg:block">Считаем с</span>
          <span className="lab text-right">Ставка</span>
          <span className="lab hidden text-right lg:block">ЗП, $</span>
          <span className="lab hidden text-right lg:block">ЗП, ₽</span>
          <span className="lab hidden text-right lg:block">Бонус</span>
          <span className="lab text-right">К выплате</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.buyer.id}
            className="grid grid-cols-[1.4fr_0.7fr_1fr] lg:grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] items-center border-t border-line py-3"
          >
            <span className="flex items-center gap-3">
              <Avatar initials={row.buyer.initials} color={row.buyer.color} />
              <span>
                <span className="block text-[14.5px] font-semibold">{row.buyer.handle}</span>
                <span className="block text-[11.5px] text-mute">
                  {row.onOklad
                    ? `на окладе · ${rub(row.fixedCents, rate)}`
                    : `порог взят · ${row.ratePct}%`}
                </span>
              </span>
            </span>
            <span className="n hidden text-right text-[13.5px] text-soft lg:block">{usd(row.profitCents)}</span>
            {/* Показываем только заряженные расходники — те, что реально ушли в
                базу. Иначе колонка не сходится с итогом и с «считаем с». */}
            {(() => {
              const charged = row.buyer.consumablesAffectSalary ? row.consumableCents : 0;
              return (
                <span
                  className={`n hidden text-right text-[13.5px] lg:block ${
                    charged ? 'text-rust' : 'text-mute'
                  }`}
                >
                  {charged ? `−${usd(charged)}` : usd(0)}
                </span>
              );
            })()}
            <span className="n hidden text-right text-[13.5px] lg:block">{usd(row.baseCents)}</span>
            <span className="text-right">
              <span
                className="n inline-block rounded-full px-2.5 py-1 text-[12px]"
                style={{
                  background: row.onOklad ? '#2c1f1a' : '#252e1e',
                  color: row.onOklad ? '#ce6e58' : '#b4c68c',
                }}
              >
                {row.onOklad ? 'оклад' : `${row.ratePct}%`}
              </span>
            </span>
            <span
              className="n hidden text-right text-[18px] font-semibold lg:block"
              style={{ color: row.onOklad ? '#ce6e58' : '#b4c68c' }}
            >
              {usd(row.salaryCents)}
            </span>
            <span className="n hidden text-right text-[13px] text-mute lg:block">{rub(row.salaryCents, rate)}</span>
            <span className="n hidden text-right text-[13.5px] lg:block" style={{ color: row.bonusCents ? '#b4c68c' : '#8a8a8a' }}>
              {row.bonusCents ? `+${usd(row.bonusCents)}` : '—'}
            </span>
            <span className="n text-right text-[18px] font-semibold">{usd(row.totalCents)}</span>
          </div>
        ))}

        {/* У баера строка одна — подвал «Итого» дублировал бы её. */}
        {team ? (
          <Sub className="mt-2.5 grid grid-cols-[1.4fr_0.7fr_1fr] lg:grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] items-center px-4 py-3.5">
          <span className="lab text-text">Итого</span>
          <span className="n hidden text-right text-[13.5px] lg:block">{usd(profitCents)}</span>
          <span
            className={`n hidden text-right text-[13.5px] lg:block ${
              consumableCents ? 'text-rust' : 'text-mute'
            }`}
          >
            {consumableCents ? `−${usd(consumableCents)}` : usd(0)}
          </span>
          <span className="n hidden text-right text-[13.5px] lg:block">{usd(totals.base)}</span>
          <span className="n text-right text-[12.5px] text-mute">{rateLabel}</span>
          <span className="n hidden text-right text-[18px] font-semibold lg:block">{usd(totals.salary)}</span>
          <span className="n hidden text-right text-[13px] text-mute lg:block">{rub(totals.salary, rate)}</span>
          <span className="n hidden text-right text-[13.5px] text-sage lg:block">+{usd(totals.bonus)}</span>
          <span className="n text-right text-[18px] font-semibold text-sage">{usd(totals.total)}</span>
        </Sub>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.25fr_1fr] lg:gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconChart color="#b4c68c" />}
            tint="bg-sage-t"
            title="Лесенка ставок"
            right={
              <span className="text-[12.5px] text-mute">
                {team ? 'настраивается на каждого баера' : 'твоя лесенка'}
              </span>
            }
          />
          {/*
            На телефоне столбики шириной в полсотни пикселей превращаются в
            кашу: подписи переносятся, а карточки под разными по высоте
            столбиками разъезжаются по вертикали. Там лесенка идёт списком —
            порог, ставка, выплата в строку.
          */}
          <div className="mt-4 flex flex-col gap-2 sm:hidden">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[16px] px-4 py-3" style={{ background: '#2c1f1a' }}>
              <span className="n text-[12px] text-mute">до {usd(minTier)}</span>
              <span className="n text-[13px] font-bold text-rust">оклад</span>
              <span className="n w-[92px] text-right text-[14px] font-semibold">
                {usd(okladUsdCents)}
                <span className="n mt-0.5 block text-[10.5px] font-normal text-mute">
                  {okladRub.toLocaleString('ru-RU')} ₽
                </span>
              </span>
            </div>
            {ladder.map((tier) => (
              <div
                key={tier.fromCents}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-3 rounded-[16px] px-4 py-3"
                style={{
                  background: tier.ratePct >= 50 ? '#3a452e' : tier.ratePct >= 40 ? '#31382a' : '#282c24',
                }}
              >
                <span className="n text-[12px] text-mute">от {usd(tier.fromCents)}</span>
                <span className="n text-[15px] font-bold text-sage">{tier.ratePct}%</span>
                <span className="n w-[92px] text-right text-[14px] font-semibold">
                  {usd(Math.round((tier.fromCents * tier.ratePct) / 100))}
                  <span className="n mt-0.5 block text-[10.5px] font-normal text-mute">
                    {rub(Math.round((tier.fromCents * tier.ratePct) / 100), rate)}
                  </span>
                </span>
              </div>
            ))}
          </div>

          <div
            className="mt-5 hidden gap-3 sm:grid"
            style={{ gridTemplateColumns: `repeat(${Math.max(1, ladder.length) + 1}, minmax(0,1fr))` }}
          >
            <div>
              <div className="n mb-2 text-[12px] text-mute">до {usd(minTier)}</div>
              <div
                className="flex items-start justify-center rounded-[16px] pt-3.5"
                style={{ height: 69, background: '#2c1f1a' }}
              >
                <span className="n text-[15px] font-bold text-rust">оклад</span>
              </div>
              <Sub className="mt-2.5 px-3 py-2.5">
                <div className="n text-[14px] font-semibold">{usd(okladUsdCents)}</div>
                <div className="n mt-1 text-[11px] text-mute">
                  {okladRub.toLocaleString('ru-RU')} ₽
                </div>
              </Sub>
            </div>
            {ladder.map((tier) => (
              <div key={tier.fromCents}>
                <div className="n mb-2 text-[12px] text-mute">от {usd(tier.fromCents)}</div>
                <div
                  className="flex items-start justify-center rounded-[16px] pt-3.5"
                  style={{
                    height: tier.ratePct * 2.3,
                    background: tier.ratePct >= 50 ? '#3a452e' : tier.ratePct >= 40 ? '#31382a' : '#282c24',
                  }}
                >
                  <span className="n text-[22px] font-bold text-sage">{tier.ratePct}%</span>
                </div>
                <Sub className="mt-2.5 px-3 py-2.5">
                  <div className="n text-[14px] font-semibold">
                    {usd(Math.round((tier.fromCents * tier.ratePct) / 100))}
                  </div>
                  <div className="n mt-1 text-[11px] text-mute">
                    {rub(Math.round((tier.fromCents * tier.ratePct) / 100), rate)}
                  </div>
                </Sub>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconWarn color="#ce6e58" />} tint="bg-rust-t" title="Мёртвые зоны" />
          <p className="mt-3 text-[12.5px] leading-relaxed text-mute">
            Процент считается со всей суммы, а не только с превышения порога. Поэтому у самой отметки пара сотен профита меняет выплату на тысячи.
          </p>
          {gaps.length === 0 ? (
            <Empty>Все пороги взяты.</Empty>
          ) : (
            gaps.slice(0, 5).map((g) => (
              <div key={g.handle} className="flex items-center gap-3.5 border-t border-line py-3">
                <span className="w-14 shrink-0 text-[13.5px] font-semibold">{g.handle}</span>
                <span className="min-w-0 flex-1">
                  <Meter value={g.progress} max={100} color={g.progress > 75 ? '#b4c68c' : '#ce6e58'} />
                  <span className="mt-1.5 block text-[11px] text-mute">
                    не хватает <span className="n text-soft">{usd(g.need)}</span> до {usd(g.to)}
                  </span>
                </span>
                <span className="n w-16 text-right text-[16px] font-semibold text-sage">+{usd(g.gain)}</span>
              </div>
            ))
          )}
        </Panel>
      </div>

      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconCalendar color="#b4c68c" />}
          tint="bg-sage-t"
          title="Закрытые листы"
          right={
            <span className="text-[12.5px] text-mute">
              {team ? 'сколько ушло команде' : 'сколько ты получил'}
            </span>
          }
        />
        {archive.length === 0 ? (
          <Empty>Закрытых периодов пока нет.</Empty>
        ) : (
          <>
            <div className="mt-4 grid grid-cols-[1.3fr_1fr] lg:grid-cols-[1.5fr_repeat(3,1fr)_1fr] pb-2.5">
              <span className="lab">Период</span>
              <span className="lab hidden text-right lg:block">Оклад и процент</span>
              <span className="lab hidden text-right lg:block">Бонусы</span>
              <span className="lab hidden text-right lg:block">В рублях</span>
              <span className="lab text-right">К выплате</span>
            </div>
            {archive.map((sheet) => (
              <a
                key={sheet.key}
                href={`/payroll?p=${sheet.key}`}
                className="grid grid-cols-[1.3fr_1fr] lg:grid-cols-[1.5fr_repeat(3,1fr)_1fr] items-center border-t border-line py-3 transition hover:bg-sub"
              >
                <span>
                  <span className="block text-[14px] font-semibold">{sheet.title}</span>
                  <span className="block text-[11.5px] text-mute">
                    {sheet.closedAt ? `закрыт ${fmtDay(sheet.closedAt)}` : 'закрыт'}
                    {team ? ` · ${sheet.people} чел.` : ''}
                  </span>
                </span>
                <span className="n hidden text-right text-[13.5px] text-soft lg:block">
                  {usd(sheet.salaryCents)}
                </span>
                <span
                  className="n hidden text-right text-[13.5px] lg:block"
                  style={{ color: sheet.bonusCents ? '#b4c68c' : '#8a8a8a' }}
                >
                  {sheet.bonusCents ? `+${usd(sheet.bonusCents)}` : '—'}
                </span>
                <span className="n hidden text-right text-[13px] text-mute lg:block">
                  {rub(sheet.payoutCents, sheet.rate)}
                </span>
                <span className="n text-right text-[17px] font-semibold">{usd(sheet.payoutCents)}</span>
              </a>
            ))}
          </>
        )}
        <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
          Курс у каждого листа свой — тот, что стоял в момент закрытия. Поэтому рубли в архиве
          не пересчитываются задним числом.
        </p>
      </Panel>

      {team ? (
        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconUsers color="#b4c68c" />}
            tint="bg-sage-t"
            title="Команда"
            right={<span className="text-[12.5px] text-mute">дата выхода, профиль, овнеры</span>}
          />
          <BuyerRoster rows={rosterRows} />
        </Panel>
      ) : null}

      {team ? (
        <BonusPanel
          periodKey={key}
          rate={rate}
          closed={closed}
          threshold={BONUS_THRESHOLD}
          buyers={summary.buyers.map((r) => ({ id: r.buyer.id, handle: r.buyer.handle }))}
          firstHit={
            firstHit
              ? {
                  handle: firstHit.buyer.handle,
                  day: fmtDay(firstHit.date),
                  awarded: bonusRows.some(
                    (b) => b.buyerId === firstHit.buyer.id && b.note.startsWith('первые'),
                  ),
                }
              : null
          }
          bonuses={bonusRows.map(
            (b): BonusRow => ({
              id: b.id,
              buyer: {
                initials: b.buyer.initials,
                color: b.buyer.color,
                handle: b.buyer.handle,
              },
              amountCents: b.amountCents,
              note: b.note,
              day: fmtDay(b.createdAt),
            }),
          )}
        />
      ) : null}
    </div>
  );
}
