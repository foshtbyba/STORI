import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { fundState } from '@/lib/fund';
import { periodTitle } from '@/lib/period';
import { usd } from '@/lib/money';
import { addFundWithdrawal, deleteFundWithdrawal } from '@/app/actions/fund';
import { Panel, PanelHead, Sub, Empty } from '@/components/ui';
import { IconWallet } from '@/components/icons';

/**
 * Фонд баеров — касса чистого заработка команды. Только для админа.
 * Баланс = база (1900, общий бюджет) + накопленный чистый по закрытым неделям
 * − выводы. Неделя фиксируется в фонд при закрытии зарплатного листа.
 */
export default async function FundPage() {
  const user = await requireUser();
  if ((user.role as Role) !== 'ADMIN') redirect('/');

  const f = await fundState();
  const field = 'h-11 rounded-xl border border-line bg-sub px-3.5 text-[14px] outline-none';

  return (
    <div className="flex flex-col gap-3.5">
      {/* Баланс */}
      <Panel className="p-5 sm:p-7">
        <PanelHead icon={<IconWallet color="#b4c68c" />} tint="bg-sage-t" title="Фонд баеров" aside={<span className="text-[12.5px] text-mute">чистый заработок команды · виден только админу</span>} />
        <div className="mt-4 flex items-end gap-2">
          <span className="text-[22px] font-semibold text-dim">$</span>
          <span className="n text-[46px] font-semibold leading-none">{usd(f.balance).replace('$', '')}</span>
        </div>
        <div className="mt-5 flex flex-col gap-0">
          <Row label="База (общий бюджет)" value={usd(f.base)} />
          <Row label="Накоплено (чистый баеров)" value={`+ ${usd(f.accrued)}`} tone="sage" />
          <Row label="Выведено" value={f.withdrawn ? `− ${usd(f.withdrawn)}` : usd(0)} tone={f.withdrawn ? 'rust' : undefined} />
        </div>
      </Panel>

      {/* Вывод из фонда */}
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconWallet color="#ce6e58" />} tint="bg-rust-t" title="Вывести из фонда" />
        <form action={addFundWithdrawal} className="mt-4 grid grid-cols-2 items-end gap-2.5 sm:grid-cols-[160px_1fr_auto]">
          <input name="amount" inputMode="decimal" className={`n ${field}`} placeholder="сумма, $" required />
          <input name="note" className={field} placeholder="комментарий (кому/за что)" />
          <button type="submit" className="col-span-2 h-11 rounded-full bg-rust px-6 text-[13px] font-semibold text-bg sm:col-span-1">
            Вывести
          </button>
        </form>

        <div className="mt-5">
          {f.withdrawals.length === 0 ? (
            <Empty>Выводов пока не было.</Empty>
          ) : (
            f.withdrawals.map((w) => (
              <div key={w.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <span className="flex items-center gap-3 text-[13px]">
                  <span className="n text-rust">− {usd(w.amountCents)}</span>
                  <span className="text-mute">{w.note || '—'}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="n text-[11.5px] text-dim">{w.createdAt.toLocaleDateString('ru-RU')}</span>
                  <form action={deleteFundWithdrawal}>
                    <input type="hidden" name="id" value={w.id} />
                    <button type="submit" className="text-[11px] text-dim transition hover:text-rust">✕</button>
                  </form>
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>

      {/* Пополнения по неделям */}
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconWallet color="#b4c68c" />} tint="bg-sage-t" title="Пополнения по неделям" aside={<span className="text-[12.5px] text-mute">фиксируется при закрытии зарплаты</span>} />
        <div className="mt-4">
          {f.accruals.length === 0 ? (
            <Empty>Пока ни одна неделя не закрыта.</Empty>
          ) : (
            f.accruals.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-2.5">
                <span className="text-[13px] text-soft">{a.periodKey ? periodTitle(a.periodKey) : 'неделя'}</span>
                <span className={`n text-[13px] ${a.amountCents >= 0 ? 'text-sage' : 'text-rust'}`}>
                  {a.amountCents >= 0 ? '+ ' : '− '}{usd(Math.abs(a.amountCents))}
                </span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'sage' | 'rust' }) {
  return (
    <div className="flex items-center justify-between border-t border-line py-3 text-[13.5px]">
      <span className="text-mute">{label}</span>
      <span className={`n ${tone === 'sage' ? 'text-sage' : tone === 'rust' ? 'text-rust' : 'text-soft'}`}>{value}</span>
    </div>
  );
}
