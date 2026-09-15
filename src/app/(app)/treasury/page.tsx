import { requireUser } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { treasuryState } from '@/lib/treasury';
import { usd } from '@/lib/money';
import { periodTitle } from '@/lib/period';
import { Panel, PanelHead, Sub, Empty, Avatar, Big } from '@/components/ui';
import { IconWallet } from '@/components/icons';
import SubmitButton from '@/components/SubmitButton';
import { addFundWithdrawal, deleteFundWithdrawal } from '@/app/actions/fund';
import {
  addOwnerWithdrawal,
  deleteOwnerWithdrawal,
  saveSnapshot,
  deleteSnapshot,
  addAdjustment,
  deleteAdjustment,
} from '@/app/actions/treasury';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ru = (d: Date) => d.toLocaleDateString('ru-RU');

export default async function TreasuryPage() {
  const user = await requireUser();
  if ((user.role as Role) !== 'ADMIN') {
    return <Empty>Касса доступна только админу.</Empty>;
  }

  const t = await treasuryState();
  const total = t.expectedCents;
  const pct = (c: number) => (total > 0 ? Math.round((c / total) * 100) : 0);

  const sources = t.realBySource;
  const snapDate = t.snapshot ? ymd(t.snapshot.date) : ymd(new Date());

  return (
    <div className="flex flex-col gap-3.5">
      {/* Сверка: ожидается (дашборд) против факта (снимок) */}
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconWallet color="#b4c68c" />} tint="bg-sage-t" title="Касса — сверка" />
        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <Sub className="px-4 py-3.5">
            <div className="text-[11.5px] text-mute">Ожидается (доли + фонд)</div>
            <div className="n mt-2 text-[24px] font-semibold">{usd(t.expectedCents)}</div>
            <div className="mt-1 text-[11.5px] text-mute">овнеры {usd(t.ownersCents)} · баеры {usd(t.buyersCents)}</div>
          </Sub>
          <Sub className="px-4 py-3.5">
            <div className="text-[11.5px] text-mute">По факту (снимок{t.snapshot ? ` ${ru(t.snapshot.date)}` : ''})</div>
            <div className="n mt-2 text-[24px] font-semibold">{t.realCents === null ? '—' : usd(t.realCents)}</div>
            <div className="mt-1 text-[11.5px] text-mute">
              {sources
                ? `партн. ${usd(sources.partnersCents)} · брок. ${usd(sources.brocardCents)} · карта ${usd(sources.cardCents)} · агенты ${usd(sources.agentsCents)}`
                : 'снимок ещё не внесён'}
            </div>
          </Sub>
          <Sub className="px-4 py-3.5">
            <div className="text-[11.5px] text-mute">Расхождение (факт − ожидается)</div>
            <div
              className="n mt-2 text-[24px] font-semibold"
              style={{
                color: t.diffCents === null ? '#8a8a8a' : Math.abs(t.diffCents) < 100 ? '#b4c68c' : '#e5484d',
              }}
            >
              {t.diffCents === null ? '—' : `${t.diffCents >= 0 ? '+' : '−'}${usd(Math.abs(t.diffCents))}`}
            </div>
            <div className="mt-1 text-[11.5px] text-mute">
              {t.diffCents === null
                ? 'внеси снимок ниже'
                : Math.abs(t.diffCents) < 100
                  ? 'сходится'
                  : t.diffCents > 0
                    ? 'по факту денег больше — где-то недосчитали профит/приход'
                    : 'по факту денег меньше — где-то недосчитали расход/вывод'}
            </div>
          </Sub>
        </div>

        {/* Три доли одного пирога */}
        <div className="mt-4 border-t border-line pt-4">
          <div className="lab mb-2.5">Из чего складывается ожидаемое</div>
          {t.shares.map((o) => (
            <div key={o.buyerId} className="flex items-center justify-between border-t border-line py-2 text-[13px]">
              <span className="flex items-center gap-2.5">
                <Avatar initials={o.initials} color={o.color} />
                <span className="text-soft">Доля {o.handle}</span>
              </span>
              <span className="n">
                {usd(o.balanceCents)} <span className="text-[11px] text-mute">· {pct(o.balanceCents)}%</span>
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-line py-2 text-[13px]">
            <span className="flex items-center gap-2.5">
              <Avatar initials="БА" color="#8a8a8a" />
              <span className="text-soft">Капитал баеров</span>
            </span>
            <span className="n">
              {usd(t.buyersCents)} <span className="text-[11px] text-mute">· {pct(t.buyersCents)}%</span>
            </span>
          </div>
        </div>
      </Panel>

      {/* Три доли: овнеры + общий капитал баеров (фонд) */}
      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3 lg:gap-3.5">
          {t.shares.map((o, idx) => (
            <Panel key={o.buyerId} className={`flex flex-col p-4 sm:p-6 ${idx === 0 ? 'order-1' : 'order-3'}`}>
              <PanelHead
                icon={<Avatar initials={o.initials} color={o.color} />}
                title={`Доля ${o.handle}`}
                aside={<span className="text-[12.5px] text-mute">{o.anchorDate ? `с ${ru(o.anchorDate)}` : ''}{o.openingCents ? `${o.anchorDate ? ' · ' : ''}старт ${usd(o.openingCents)}` : ''}</span>}
              />
              <Big cents={o.balanceCents} size={40} className="mt-4" />

              {/* Разбор: что двигало долю с якоря (нулевые строки не показываем) */}
              <div className="mt-4">
                {[
                  { name: 'Профит кабинетов', cents: o.profitCents, taken: o.profitCents < 0, note: 'доход − расход с комиссией' },
                  { name: 'Свои расходники', cents: o.consumableCents, taken: true },
                  { name: 'Общак (½)', cents: o.overheadCents, taken: true, note: '50/50 овнерам' },
                  { name: 'Выводы', cents: o.withdrawnCents, taken: true },
                  { name: 'Прочие движения', cents: o.adjustmentCents, signed: true, note: 'мимо дашборда' },
                ].filter((r) => r.name !== 'Прочие движения' || r.cents !== 0).map((r) => (
                  <div key={r.name} className="flex items-center justify-between border-t border-line py-2 text-[12.5px]">
                    <span className="text-soft">
                      {r.name}
                      {r.note ? <span className="ml-1.5 text-[11px] text-mute">· {r.note}</span> : null}
                    </span>
                    <span className={`n ${
                      r.signed ? (r.cents > 0 ? 'text-sage' : r.cents < 0 ? 'text-rust' : 'text-mute')
                      : r.taken && r.cents ? 'text-rust' : r.cents ? 'text-sage' : 'text-mute'
                    }`}>
                      {r.signed ? (r.cents > 0 ? '+ ' : r.cents < 0 ? '− ' : '') : r.taken && r.cents ? '− ' : ''}
                      {usd(Math.abs(r.cents))}
                    </span>
                  </div>
                ))}
              </div>

              {/* Вывод овнеру */}
              <form action={addOwnerWithdrawal} className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="buyerId" value={o.buyerId} />
                <input name="amount" inputMode="decimal" placeholder="вывести, $" className="n h-9 w-28 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                <input name="note" placeholder="комментарий" className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                <SubmitButton pendingLabel="Вывожу…" className="h-9 shrink-0 rounded-full bg-rust px-4 text-[12px] font-semibold text-bg">Вывести</SubmitButton>
              </form>

              <div className="mt-3">
                <div className="lab mb-1.5">История выводов</div>
                {o.withdrawals.length === 0 ? (
                  <div className="text-[12px] text-dim">Выводов не было.</div>
                ) : (
                  o.withdrawals.map((w) => (
                    <div key={w.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="n shrink-0 text-rust">− {usd(w.amountCents)}</span>
                        <span className="truncate text-mute">{w.note || '—'}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="n text-[11px] text-dim">{ru(w.date)}</span>
                        <form action={deleteOwnerWithdrawal}>
                          <input type="hidden" name="id" value={w.id} />
                          <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                        </form>
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Прочие движения мимо дашборда — свёрнуто */}
              <details className="mt-2">
                <summary className="lab cursor-pointer list-none select-none">Прочие движения ▾</summary>
                <form action={addAdjustment} className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input type="hidden" name="scope" value="owner" />
                  <input type="hidden" name="buyerId" value={o.buyerId} />
                  <select name="direction" className="h-9 rounded-lg border border-line2 bg-sub px-2 text-[12px] text-text outline-none focus:border-sage">
                    <option value="in">+ приход</option>
                    <option value="out">− расход</option>
                  </select>
                  <input name="amount" inputMode="decimal" placeholder="сумма, $" className="n h-9 w-24 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                  <input name="note" placeholder="что за движение" className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                  <SubmitButton pendingLabel="Добавляю…" className="h-9 shrink-0 rounded-full bg-raise px-4 text-[12px] font-semibold">Добавить</SubmitButton>
                </form>
                {o.adjustments.length > 0 ? (
                  <div className="mt-2">
                    {o.adjustments.map((a) => (
                      <div key={a.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px]">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className={`n shrink-0 ${a.amountCents >= 0 ? 'text-sage' : 'text-rust'}`}>{a.amountCents >= 0 ? '+ ' : '− '}{usd(Math.abs(a.amountCents))}</span>
                          <span className="truncate text-mute">{a.note || '—'}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="n text-[11px] text-dim">{ru(a.date)}</span>
                          <form action={deleteAdjustment}><input type="hidden" name="id" value={a.id} /><button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button></form>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            </Panel>
          ))}

          {/* Доля баеров — общий капитал (фонд). В центре между овнерами. */}
          <Panel className="flex flex-col p-4 sm:p-6 order-2">
            <PanelHead
              icon={<Avatar initials="БА" color="#8a8a8a" />}
              title="Капитал баеров"
              aside={
                <span className="text-[12.5px] text-mute">
                  накоплено {t.fund.accrued < 0 ? '− ' : '+ '}{usd(Math.abs(t.fund.accrued))}
                  {t.fund.withdrawn ? ` · выведено − ${usd(t.fund.withdrawn)}` : ''}
                </span>
              }
            />
            <Big cents={t.buyersCents} size={40} className="mt-4" />

            {/* Разбор: что двигало капитал (нулевые строки не показываем) */}
            <div className="mt-4">
              {[
                { name: 'Профит баеров', cents: t.fund.profitCents, taken: t.fund.profitCents < 0, note: 'доход − расход' },
                { name: 'Расходники', cents: t.fund.consumableCents, taken: true },
                { name: 'Зарплата баеров', cents: t.fund.payoutCents, taken: true, note: 'выплаченная (до позапрошлой)' },
                { name: 'Выводы', cents: t.fund.withdrawn, taken: true },
                { name: 'Прочие движения', cents: t.buyersAdjustmentCents, signed: true, note: 'мимо дашборда' },
              ].filter((r) => r.cents !== 0).map((r) => (
                <div key={r.name} className="flex items-center justify-between border-t border-line py-2 text-[12.5px]">
                  <span className="text-soft">
                    {r.name}
                    {r.note ? <span className="ml-1.5 text-[11px] text-mute">· {r.note}</span> : null}
                  </span>
                  <span className={`n ${
                    r.signed ? (r.cents > 0 ? 'text-sage' : r.cents < 0 ? 'text-rust' : 'text-mute')
                    : r.taken && r.cents ? 'text-rust' : r.cents ? 'text-sage' : 'text-mute'
                  }`}>
                    {r.signed ? (r.cents > 0 ? '+ ' : r.cents < 0 ? '− ' : '') : r.taken && r.cents ? '− ' : ''}
                    {usd(Math.abs(r.cents))}
                  </span>
                </div>
              ))}
            </div>

            {/* Вывод из фонда (50/50 между овнерами) */}
            <form action={addFundWithdrawal} className="mt-4 flex flex-wrap items-center gap-2">
              <input name="amount" inputMode="decimal" placeholder="вывести, $" className="n h-9 w-28 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
              <input name="note" placeholder="комментарий (50/50 овнерам)" className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
              <SubmitButton pendingLabel="Вывожу…" className="h-9 shrink-0 rounded-full bg-rust px-4 text-[12px] font-semibold text-bg">Вывести</SubmitButton>
            </form>

            {/* Пополнения по неделям с накопительным итогом — свёрнуто */}
            <details className="mt-4">
              <summary className="lab cursor-pointer list-none select-none">Пополнения по неделям ▾</summary>
              {t.fund.weeks.length === 0 ? (
                <div className="mt-1.5 text-[12px] text-dim">Пока нет данных.</div>
              ) : (
                // Видно 4 последних, остальное — прокруткой.
                <div className="mt-1.5 max-h-[136px] overflow-y-auto pr-1">
                  {t.fund.weeks.map((a) => (
                    <div key={a.key} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px]">
                      <span className="text-soft">{periodTitle(a.key)}{a.open ? <span className="ml-1.5 text-[10.5px] text-dim">· текущая</span> : null}</span>
                      <span className="flex items-baseline gap-2 text-right">
                        <span className={`n ${a.cents >= 0 ? 'text-sage' : 'text-rust'}`}>{a.cents >= 0 ? '+ ' : '− '}{usd(Math.abs(a.cents))}</span>
                        <span className="n w-16 text-[11px] text-dim" title="Накопительно в фонде после этой недели">
                          → {a.cumCents < 0 ? '−' : ''}{usd(Math.abs(a.cumCents))}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </details>

            {/* История выводов из фонда */}
            <div className="mt-3">
              <div className="lab mb-1.5">История выводов</div>
              {t.fund.withdrawals.length === 0 ? (
                <div className="text-[12px] text-dim">Выводов не было.</div>
              ) : (
                t.fund.withdrawals.map((w) => (
                  <div key={w.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px]">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="n shrink-0 text-rust">− {usd(w.amountCents)}</span>
                      <span className="truncate text-mute">{w.note || '—'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="n text-[11px] text-dim">{w.createdAt.toLocaleDateString('ru-RU')}</span>
                      <form action={deleteFundWithdrawal}>
                        <input type="hidden" name="id" value={w.id} />
                        <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                      </form>
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Прочие движения мимо дашборда — свёрнуто */}
            <details className="mt-2">
              <summary className="lab cursor-pointer list-none select-none">Прочие движения ▾</summary>
              <form action={addAdjustment} className="mt-1.5 flex flex-wrap items-center gap-2">
                <input type="hidden" name="scope" value="buyers" />
                <select name="direction" className="h-9 rounded-lg border border-line2 bg-sub px-2 text-[12px] text-text outline-none focus:border-sage">
                  <option value="in">+ приход</option>
                  <option value="out">− расход</option>
                </select>
                <input name="amount" inputMode="decimal" placeholder="сумма, $" className="n h-9 w-24 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                <input name="note" placeholder="что за движение" className="h-9 min-w-0 flex-1 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
                <SubmitButton pendingLabel="Добавляю…" className="h-9 shrink-0 rounded-full bg-raise px-4 text-[12px] font-semibold">Добавить</SubmitButton>
              </form>
              {t.buyersAdjustments.length > 0 ? (
                <div className="mt-2">
                  {t.buyersAdjustments.map((a) => (
                    <div key={a.id} className="flex items-center justify-between gap-2 border-t border-line py-1.5 text-[12px]">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`n shrink-0 ${a.amountCents >= 0 ? 'text-sage' : 'text-rust'}`}>{a.amountCents >= 0 ? '+ ' : '− '}{usd(Math.abs(a.amountCents))}</span>
                        <span className="truncate text-mute">{a.note || '—'}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="n text-[11px] text-dim">{ru(a.date)}</span>
                        <form action={deleteAdjustment}><input type="hidden" name="id" value={a.id} /><button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button></form>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </details>
          </Panel>
        </div>

      {/* Снимок реальных денег по источникам */}
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconWallet color="#b4c68c" />} tint="bg-sage-t" title="Реальные деньги — снимок" />
        <p className="mt-2 text-[12.5px] text-mute">
          Внеси, сколько сейчас реально лежит по каждому источнику. Система сверит сумму с ожидаемым выше и покажет расхождение.
          Снимок на одну дату перезаписывается.
        </p>
        <form action={saveSnapshot} className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { name: 'partners', label: 'Партнёрки, $', val: sources?.partnersCents },
            { name: 'brocard', label: 'Брокард, $', val: sources?.brocardCents },
            { name: 'card', label: 'Счёт/карта, $', val: sources?.cardCents },
            { name: 'agents', label: 'Агенты, $', val: sources?.agentsCents },
          ].map((f) => (
            <label key={f.name} className="flex flex-col gap-1">
              <span className="lab">{f.label}</span>
              <input
                name={f.name}
                inputMode="decimal"
                defaultValue={f.val ? String(f.val / 100) : ''}
                className="n h-9 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage"
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="lab">Дата</span>
            <input name="date" type="date" defaultValue={snapDate} className="n h-9 rounded-lg border border-line2 bg-sub px-3 text-[12.5px] text-text outline-none focus:border-sage" />
          </label>
          <div className="flex items-end">
            <SubmitButton pendingLabel="Вношу…" className="h-9 w-full rounded-full bg-sage px-4 text-[12px] font-semibold text-bg">Внести снимок</SubmitButton>
          </div>
        </form>

        {/* История снимков — когда и сколько записывали */}
        <div className="mt-5 border-t border-line pt-4">
          <div className="lab mb-2">История снимков</div>
          {t.snapshots.length === 0 ? (
            <div className="text-[12px] text-dim">Снимков ещё не было.</div>
          ) : (
            <>
              <div className="hidden grid-cols-[auto_repeat(5,1fr)_auto] gap-x-3 pb-1.5 sm:grid">
                <span className="lab">Дата</span>
                <span className="lab text-right">Партнёрки</span>
                <span className="lab text-right">Брокард</span>
                <span className="lab text-right">Карта</span>
                <span className="lab text-right">Агенты</span>
                <span className="lab text-right">Всего</span>
                <span />
              </div>
              {t.snapshots.map((s) => {
                const tot = s.partnersCents + s.brocardCents + s.cardCents + s.agentsCents;
                return (
                  <div
                    key={s.id}
                    className="grid grid-cols-[1fr_auto] items-center gap-x-3 border-t border-line py-2 text-[12.5px] sm:grid-cols-[auto_repeat(5,1fr)_auto]"
                  >
                    <span className="n text-soft">{ru(s.date)}</span>
                    <span className="n hidden text-right text-mute sm:block">{usd(s.partnersCents)}</span>
                    <span className="n hidden text-right text-mute sm:block">{usd(s.brocardCents)}</span>
                    <span className="n hidden text-right text-mute sm:block">{usd(s.cardCents)}</span>
                    <span className="n hidden text-right text-mute sm:block">{usd(s.agentsCents)}</span>
                    <span className="n text-right font-semibold">{usd(tot)}</span>
                    <span className="text-right">
                      <form action={deleteSnapshot} className="inline">
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                      </form>
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </Panel>
    </div>
  );
}
