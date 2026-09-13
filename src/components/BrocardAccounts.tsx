'use client';

import { useState, useTransition } from 'react';
import { brocardAccounts, brocardTransfer } from '@/app/actions/integrations';

type Account = {
  id: string;
  state: string;
  balanceCents: number;
  reservedCents: number;
  availableCents: number;
  purposeType: string;
  teamId: string;
  teamName: string;
  ownerEmail: string;
  ownerName: string;
  currency: string;
};

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
/** Общак — общий счёт: определяем по имени (у баеров тоже purpose_type=team). */
const isObshchak = (a: Account) => (a.teamName || '').trim().toLowerCase() === 'общак';

/**
 * Админ: счета Brocard с балансами и перевод Общак → счёт баера. Живые деньги,
 * поэтому перед переводом спрашиваем подтверждение, а сумму режем по остатку
 * Общака на сервере.
 */
export default function BrocardAccounts() {
  const [pending, start] = useTransition();
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [fromAcc, setFromAcc] = useState('');
  const [toAcc, setToAcc] = useState('');
  const [amount, setAmount] = useState('');
  const [confirm, setConfirm] = useState<{ amt: number; toLabel: string } | null>(null);

  const load = () => {
    if (pending) return;
    setMsg(null);
    start(async () => {
      const r = await brocardAccounts();
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); setAccounts(null); }
      else setAccounts(r.accounts ?? []);
    });
  };

  const all = accounts ?? [];
  const label = (a?: Account) => (a ? (a.teamName || a.ownerName || a.ownerEmail || a.id) : '');
  // Показываем только именованные счета (Общак + баеры). Безымянные «—» и
  // карточные счета — мусор, их прячем.
  const visible = all.filter((a) => (a.teamName || '').trim() !== '');
  // Источник — Общак (по имени). Получатели — остальные именованные счета (баеры).
  const obshchak = all.find(isObshchak) ?? null;
  const srcId = obshchak?.id ?? fromAcc;
  const targets = visible.filter((a) => a.id !== srcId);

  // Шаг 1 — проверить и показать подтверждение (без системного окна).
  const ask = () => {
    if (pending) return;
    const amt = Number(amount);
    if (!srcId) { setMsg({ ok: false, text: 'Не нашёлся Общак — переименуй общий счёт в «Общак» или выбери источник.' }); return; }
    if (!toAcc) { setMsg({ ok: false, text: 'Выбери счёт баера.' }); return; }
    if (srcId === toAcc) { setMsg({ ok: false, text: 'Источник и получатель совпадают.' }); return; }
    if (!Number.isFinite(amt) || amt < 0.01) { setMsg({ ok: false, text: 'Сумма от $0.01.' }); return; }
    setMsg(null);
    setConfirm({ amt, toLabel: label(all.find((a) => a.id === toAcc)) });
  };

  // Шаг 2 — подтверждено: выполняем перевод.
  const run = () => {
    if (pending || !confirm) return;
    const amt = confirm.amt;
    setConfirm(null);
    start(async () => {
      const fd = new FormData();
      fd.set('fromAcc', srcId);
      fd.set('toAcc', toAcc);
      fd.set('amount', String(amt));
      const r = await brocardTransfer(fd);
      if (!r.ok) setMsg({ ok: false, text: r.error ?? 'сбой перевода' });
      else { setMsg({ ok: true, text: r.message ?? 'готово' }); setAmount(''); }
      const rr = await brocardAccounts();
      if (rr.ok) setAccounts(rr.accounts ?? []);
    });
  };

  return (
    <div className="mt-4 border-t border-line pt-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={load}
          disabled={pending}
          className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}
        >
          {pending ? 'Читаю счета…' : accounts ? 'Обновить счета' : 'Показать счета Brocard'}
        </button>
        {obshchak ? <span className="text-[12px] text-mute">Общак: <span className="text-sage">{usd(obshchak.availableCents)}</span></span> : accounts ? <span className="text-[12px] text-mute">счетов: {visible.length}</span> : null}
      </div>

      {msg ? (
        <div
          className="mt-2.5 rounded-[12px] border px-3 py-2 text-[12px]"
          style={msg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}
        >
          {msg.text}
        </div>
      ) : null}

      {accounts ? (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((a) => (
              <div key={a.id} className="rounded-[14px] border border-line px-3 py-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] font-medium">
                    {a.teamName || a.ownerName || a.ownerEmail || '—'}
                    {isObshchak(a) ? <span className="ml-2 rounded-full bg-amber-t px-2 py-0.5 text-[10px] text-amber">Общак</span> : null}
                  </span>
                  <span className="text-[13px] font-semibold text-sage">{usd(a.availableCents)}</span>
                </div>
                <div className="mt-1 text-[11px] text-dim">на картах {usd(a.reservedCents)} · {a.currency} · {a.state}</div>
              </div>
            ))}
          </div>

          {/* Пополнить счёт баера с Общака. */}
          <div className="mt-4 rounded-[14px] border border-line px-3.5 py-3">
            <div className="text-[12.5px] font-semibold">Пополнить счёт баера с Общака</div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
              {obshchak ? (
                <span className="rounded-xl border border-line2 bg-sub px-3 py-1.5 text-mute">Общак <span className="text-sage">{usd(obshchak.availableCents)}</span></span>
              ) : (
                <select
                  value={fromAcc}
                  onChange={(e) => setFromAcc(e.target.value)}
                  className="h-9 rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft"
                >
                  <option value="">— источник (Общак) —</option>
                  {visible.map((a) => (
                    <option key={a.id} value={a.id}>{label(a)} · {usd(a.availableCents)}</option>
                  ))}
                </select>
              )}
              <span className="text-mute">→</span>
              <select
                value={toAcc}
                onChange={(e) => setToAcc(e.target.value)}
                className="h-9 rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft"
              >
                <option value="">— баеру —</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>{label(t)} · {usd(t.availableCents)}</option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <span className="text-mute">$</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="1.00"
                  className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                />
              </div>
              <button
                type="button"
                onClick={ask}
                disabled={pending}
                className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}
              >
                {pending ? 'Перевожу…' : 'Пополнить'}
              </button>
            </div>

            {/* Подтверждение в стиле дешборда — вместо системного окна. */}
            {confirm ? (
              <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
                <span className="text-soft">
                  Перевести <span className="font-semibold text-sage">${confirm.amt.toFixed(2)}</span> с Общака на «{confirm.toLabel}»? Это реальные деньги.
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={run} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">
                    Подтвердить
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">
                    Отмена
                  </button>
                </div>
              </div>
            ) : null}

            <p className="mt-2 text-[11px] text-dim">Источник — Общак. Сумма не больше его остатка. Каждый перевод пишется в лог.</p>
          </div>
        </>
      ) : null}
    </div>
  );
}
