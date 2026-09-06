'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { grossUp, usd, DEFAULT_COMMISSION_BPS } from '@/lib/money';
import { saveDay } from '@/app/actions/days';
import { Panel, PanelHead, Sub } from './ui';
import Select from './Select';
import DateField from './DateField';
import { IconRoute } from './icons';

type Option = { id: string; label: string; extra?: string };

export default function DayForm({
  today,
  buyers,
  methods,
}: {
  today: string;
  buyers: Option[];
  methods: (Option & { bps: number })[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [date, setDate] = useState(today);
  const [buyerId, setBuyerId] = useState(buyers[0]?.id ?? '');
  const [source, setSource] = useState('Facebook');
  const [revenue, setRevenue] = useState('');
  const [spend, setSpend] = useState('');
  const [methodId, setMethodId] = useState(methods[0]?.id ?? '');
  const [grossOverride, setGrossOverride] = useState('');

  const bps = methods.find((m) => m.id === methodId)?.bps ?? DEFAULT_COMMISSION_BPS;
  const toCents = (v: string) => {
    const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  };

  const calc = useMemo(() => {
    const revenueCents = toCents(revenue);
    const spendNetCents = toCents(spend);
    const overrideCents = grossOverride ? toCents(grossOverride) : null;
    const spendGrossCents = overrideCents ?? grossUp(spendNetCents, bps);
    const commissionCents = spendGrossCents - spendNetCents;
    const profitCents = revenueCents - spendGrossCents;
    return {
      revenueCents, spendNetCents, spendGrossCents, commissionCents, profitCents,
      roi: spendGrossCents ? (profitCents / spendGrossCents) * 100 : 0,
    };
  }, [revenue, spend, grossOverride, bps]);

  function submit() {
    setError(null);
    start(async () => {
      const result = await saveDay({
        date,
        buyerId,
        source,
        revenueCents: calc.revenueCents,
        spendNetCents: calc.spendNetCents,
        paymentMethodId: methodId || null,
        spendGrossCents: grossOverride ? calc.spendGrossCents : null,
      });
      if (result.ok) router.push('/days');
      else setError(result.error);
    });
  }

  const input =
    'mt-2 w-full bg-transparent text-[15px] outline-none placeholder:text-dim';

  return (
    <div className="grid grid-cols-1 items-start gap-2.5 lg:grid-cols-[1.32fr_1fr] lg:gap-3.5">
      <div className="flex flex-col gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconRoute color="#b4c68c" />} tint="bg-sage-t" title="Связка" />
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Sub className="px-4 py-3.5">
              <span className="text-[11.5px] text-mute">Дата</span>
              <div className="mt-2">
                <DateField value={date} onChange={setDate} />
              </div>
            </Sub>
            <Sub className="px-4 pb-3.5 pt-3">
              <Select
                label="Баер"
                value={buyerId}
                onChange={setBuyerId}
                options={buyers.map((b) => ({ value: b.id, label: b.label }))}
              />
            </Sub>
            <Sub className="px-4 py-3.5">
              <span className="text-[11.5px] text-mute">Источник</span>
              <input value={source} onChange={(e) => setSource(e.target.value)} className={input} />
            </Sub>
          </div>
          <div className="mt-3">
            <Sub className="px-4 pb-3.5 pt-3">
              <Select
                label="Платёжка"
                value={methodId}
                onChange={setMethodId}
                placeholder={methods.length ? 'Выбрать' : 'Не заведены'}
                options={methods.map((m) => ({
                  value: m.id,
                  label: m.label,
                  hint: `${(m.bps / 100).toFixed(2)}%`,
                }))}
              />
            </Sub>
          </div>
        </Panel>

        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconRoute color="#b4c68c" />} tint="bg-sage-t" title="Деньги за день" />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <Sub className="border border-sage-t px-5 py-4">
              <span className="text-[11.5px] text-mute">Доход за рекламу</span>
              <input
                inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)}
                placeholder="1660" className="n mt-2.5 w-full bg-transparent text-[34px] font-bold tracking-[-0.03em] outline-none placeholder:text-dim"
              />
            </Sub>
            <Sub className="px-5 py-4">
              <span className="text-[11.5px] text-mute">Расход на рекламу</span>
              <input
                inputMode="decimal" value={spend} onChange={(e) => setSpend(e.target.value)}
                placeholder="750" className="n mt-2.5 w-full bg-transparent text-[34px] font-bold tracking-[-0.03em] outline-none placeholder:text-dim"
              />
            </Sub>
          </div>
          <div className="lab mt-5 mb-3">Пополнение кабинета</div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <Sub className="px-4 py-3.5">
              <span className="text-[11px] text-mute">Комиссия платёжки</span>
              <div className="n mt-2 text-[15px] font-semibold">{(bps / 100).toFixed(2)}%</div>
            </Sub>
            <Sub className="px-4 py-3.5">
              <span className="text-[11px] text-mute">Списано с баланса</span>
              <input
                inputMode="decimal" value={grossOverride} onChange={(e) => setGrossOverride(e.target.value)}
                placeholder={String(calc.spendGrossCents / 100)}
                className="n mt-2 w-full bg-transparent text-[15px] font-semibold outline-none placeholder:text-mid"
              />
              <div className="n mt-1.5 text-[10.5px] text-dim">можно вписать точную сумму</div>
            </Sub>
            <Sub className="px-4 py-3.5">
              <span className="text-[11px] text-mute">Комиссия в деньгах</span>
              <div className="n mt-2 text-[15px] font-semibold text-rust">{usd(calc.commissionCents)}</div>
            </Sub>
          </div>
        </Panel>
      </div>

      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconRoute color="#b4c68c" />} tint="bg-sage-t" title="Расчёт дня" />
        <div className="mt-4">
          {[
            { label: 'Доход', value: usd(calc.revenueCents), color: 'text-text' },
            { label: 'Спенд', value: `− ${usd(calc.spendNetCents)}`, color: 'text-text' },
            { label: `Комиссия ${(bps / 100).toFixed(2)}%`, value: `− ${usd(calc.commissionCents)}`, color: 'text-rust' },
          ].map((r) => (
            <div key={r.label} className="flex items-baseline justify-between border-b border-line py-3">
              <span className="text-[13px] text-mute">{r.label}</span>
              <span className={`n text-[16px] ${r.color}`}>{r.value}</span>
            </div>
          ))}
        </div>
        <Sub className="mt-4 border border-sage-t px-5 py-5">
          <div className="lab">Чистый профит</div>
          <div
            className="n mt-2.5 text-[52px] font-bold leading-none tracking-[-0.035em]"
            style={{ color: calc.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
          >
            {usd(calc.profitCents, { sign: true })}
          </div>
          <div className="n mt-2 text-[12.5px] text-mute">ROI {calc.roi.toFixed(0)}%</div>
        </Sub>

        {error ? (
          <p className="mt-4 rounded-[14px] bg-rust-t px-4 py-3 text-[12.5px] text-rust">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={pending || (!calc.revenueCents && !calc.spendNetCents)}
          className="mt-4 w-full rounded-full bg-sage py-3 text-[13.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Сохраняю…' : 'Сохранить день'}
        </button>
      </Panel>
    </div>
  );
}
