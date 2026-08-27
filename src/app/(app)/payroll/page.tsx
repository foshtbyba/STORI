import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary } from '@/lib/queries';
import { periodLabel } from '@/lib/period';
import { usd, rub, sum } from '@/lib/money';
import { payrollTotals, parseTiers, okladCents, DEFAULT_FIXED_RUB } from '@/lib/salary';
import { closePeriod, reopenPeriod } from '@/app/actions/period';
import { Panel, PanelHead, Sub, Avatar, Empty, Formula } from '@/components/ui';
import { Meter } from '@/components/Charts';
import { IconWallet, IconWarn, IconChart } from '@/components/icons';
import Contours from '@/components/Contours';

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);
  const { period } = await searchParams;
  const key = period ?? (await currentPeriodKey());
  const summary = await teamSummary(key);
  const rate = summary.period.rubPerUsd;
  const closed = summary.period.status === 'CLOSED';

  // Админ видит расчётный лист по всей команде, баер — только свою строку.
  // Итоги считаем по видимым строкам, иначе баер прочитает командные суммы
  // в подвале таблицы.
  const rows = team ? summary.buyers : summary.buyers.filter((r) => r.buyer.id === scoped);
  const totals = payrollTotals(rows);
  const profitCents = sum(rows, (r) => r.profitCents);
  const consumableCents = sum(rows, (r) => r.consumableCents);

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

  return (
    <div className="flex flex-col gap-3.5">
      {/* Горизонтали идут поверх всего ряда от края до края — четыре карточки
          читаются одной картой. */}
      <div className="relative grid grid-cols-[1.25fr_repeat(3,1fr)] gap-3.5">
        <Contours className="inset-0 z-20" />
        <Panel className="flex flex-col justify-between p-6">
          <PanelHead
            icon={<IconWallet color="#b4c68c" />}
            tint="bg-sage-t"
            title={team ? 'Фонд зарплаты' : 'К выплате'}
          />
          <div className="text-[58px] font-bold leading-none tracking-[-0.035em]">
            <span className="text-[32px] text-mute">$</span>
            {usd(totals.total).replace('$', '')}
          </div>
          <div className="n text-[12.5px] text-mute">{rub(totals.total, rate)}</div>
        </Panel>
        {[
          {
            label: team ? 'Средняя ставка' : 'Твоя ставка',
            value: `${totals.avgRate.toFixed(1).replace('.', ',')}%`,
            note: `считаем с ${usd(totals.base)} — профит минус расходники`,
            color: 'text-text',
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

      <Panel className="flex flex-col p-6">
        <PanelHead
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Расчётный лист"
          aside={<span className="text-[12.5px] text-mute">{periodLabel(key)}</span>}
          right={
            user.role === 'ADMIN' ? (
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
            )
          }
        />

        <div className="mt-5">
          <Formula
            steps={[
              { value: usd(profitCents), label: 'профит за период', color: '#b4c68c' },
              { value: usd(consumableCents), label: 'расходники', op: '−', color: '#ce6e58' },
              { value: usd(totals.base), label: 'с этого считаем процент', op: '=' },
              { value: `${totals.avgRate.toFixed(1).replace('.', ',')}%`, label: 'ставка по порогу', op: '×' },
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

        <div className="mt-5 grid grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] pb-2.5">
          <span className="lab">Баер</span>
          <span className="lab text-right">Профит</span>
          <span className="lab text-right">Расходники</span>
          <span className="lab text-right">Считаем с</span>
          <span className="lab text-right">Ставка</span>
          <span className="lab text-right">ЗП, $</span>
          <span className="lab text-right">ЗП, ₽</span>
          <span className="lab text-right">Бонус</span>
          <span className="lab text-right">К выплате</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.buyer.id}
            className="grid grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] items-center border-t border-line py-3"
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
            <span className="n text-right text-[13.5px] text-soft">{usd(row.profitCents)}</span>
            <span className="n text-right text-[13.5px] text-rust">−{usd(row.consumableCents)}</span>
            <span className="n text-right text-[13.5px]">{usd(row.baseCents)}</span>
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
              className="n text-right text-[18px] font-semibold"
              style={{ color: row.onOklad ? '#ce6e58' : '#b4c68c' }}
            >
              {usd(row.salaryCents)}
            </span>
            <span className="n text-right text-[13px] text-mute">{rub(row.salaryCents, rate)}</span>
            <span className="n text-right text-[13.5px]" style={{ color: row.bonusCents ? '#b4c68c' : '#8a8a8a' }}>
              {row.bonusCents ? `+${usd(row.bonusCents)}` : '—'}
            </span>
            <span className="n text-right text-[18px] font-semibold">{usd(row.totalCents)}</span>
          </div>
        ))}

        {/* У баера строка одна — подвал «Итого» дублировал бы её. */}
        {team ? (
          <Sub className="mt-2.5 grid grid-cols-[1.6fr_repeat(3,1fr)_0.7fr_1fr_1.1fr_0.85fr_1.05fr] items-center px-4 py-3.5">
          <span className="lab text-text">Итого</span>
          <span className="n text-right text-[13.5px]">{usd(profitCents)}</span>
          <span className="n text-right text-[13.5px] text-rust">−{usd(consumableCents)}</span>
          <span className="n text-right text-[13.5px]">{usd(totals.base)}</span>
          <span className="n text-right text-[12.5px] text-mute">
            {totals.avgRate.toFixed(1).replace('.', ',')}%
          </span>
          <span className="n text-right text-[18px] font-semibold">{usd(totals.salary)}</span>
          <span className="n text-right text-[13px] text-mute">{rub(totals.salary, rate)}</span>
          <span className="n text-right text-[13.5px] text-sage">+{usd(totals.bonus)}</span>
          <span className="n text-right text-[18px] font-semibold text-sage">{usd(totals.total)}</span>
        </Sub>
        ) : null}
      </Panel>

      <div className="grid grid-cols-[1.25fr_1fr] gap-3.5">
        <Panel className="p-6">
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
          <div
            className="mt-5 grid gap-3"
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

        <Panel className="p-6">
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
    </div>
  );
}
