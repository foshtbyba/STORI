'use client';

import { useEffect, useState, useTransition } from 'react';
import { myBrocardBalance, myBrocardTopUp } from '@/app/actions/integrations';

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * Плитка баера на главной: его остаток на Brocard + пополнение своего счёта с
 * Общака кнопками $300 / $500. Если на Общаке не хватает — пишет «обратитесь к
 * овнеру». Баланс подтягивается сам при заходе.
 */
export default function MyBrocard() {
  const [pending, start] = useTransition();
  const [bal, setBal] = useState<{ availableCents: number; reservedCents: number; obshchakCents: number } | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null);

  const load = () => {
    start(async () => {
      const r = await myBrocardBalance();
      if (!r.ok) { setErr(r.error ?? 'сбой'); setBal(null); }
      else { setErr(''); setBal({ availableCents: r.availableCents ?? 0, reservedCents: r.reservedCents ?? 0, obshchakCents: r.obshchakCents ?? 0 }); }
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const run = (amount: number) => {
    if (pending) return;
    setMsg(null);
    setConfirm(null);
    start(async () => {
      const fd = new FormData();
      fd.set('amount', String(amount));
      const r = await myBrocardTopUp(fd);
      if (!r.ok) setMsg({ ok: false, text: r.error ?? 'сбой' });
      else setMsg({ ok: true, text: r.message ?? 'готово' });
      const b = await myBrocardBalance();
      if (b.ok) setBal({ availableCents: b.availableCents ?? 0, reservedCents: b.reservedCents ?? 0, obshchakCents: b.obshchakCents ?? 0 });
    });
  };

  return (
    <Panel>
      <div className="mb-3.5 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage-t">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#b4c68c" strokeWidth="1.7"><path d="M3 6h18v13H3zM3 10.5h18" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span className="text-[15.5px] font-semibold">Мой счёт Brocard</span>
      </div>

      {err ? (
        <p className="text-[12.5px] text-rust">{err}</p>
      ) : !bal ? (
        <p className="text-[12.5px] text-mute">{pending ? 'Загружаю остаток…' : '—'}</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="n text-[32px] font-bold tracking-[-0.03em] text-sage">{usd(bal.availableCents)}</span>
            <span className="text-[12px] text-mute">остаток</span>
          </div>
          {bal.reservedCents > 0 ? (
            <div className="mt-1 text-[11.5px] text-mute">на картах {usd(bal.reservedCents)}</div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {[300, 500].map((v) => (
              <button
                key={v}
                type="button"
                disabled={pending}
                onClick={() => setConfirm(v)}
                className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12.5px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}
              >
                Пополнить ${v}
              </button>
            ))}
          </div>

          {confirm ? (
            <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#3c4d33', background: '#1c241a' }}>
              <span className="text-soft">Пополнить свой счёт на <span className="font-semibold text-sage">${confirm}</span> с Общака?</span>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={() => run(confirm)} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
                <button type="button" onClick={() => setConfirm(null)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
              </div>
            </div>
          ) : null}

          {msg ? (
            <div className="mt-2.5 rounded-[12px] border px-3 py-2 text-[12px]" style={msg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
              {msg.text}
            </div>
          ) : null}
        </>
      )}
    </Panel>
  );
}

// Локальная обёртка-панель в стиле дешборда (не тащим серверный ui в клиент).
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[26px] border border-line p-4 sm:p-5" style={{ background: 'var(--color-panel-glass)' }}>
      {children}
    </section>
  );
}
