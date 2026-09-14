'use client';

import { useMemo, useState, useTransition } from 'react';
import { linkCards, type CardLinkResult } from '@/app/actions/autoupload';
import type { CardBindMethod } from '@/lib/fb';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Card = { number: string; month: string; year: string; cvc: string; zip: string };

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const emptyCard = (): Card => ({ number: '', month: '', year: '', cvc: '', zip: '' });

const METHODS: { key: CardBindMethod; label: string; hint: string }[] = [
  { key: 'ios', label: 'iOS', hint: 'через API старого iOS-приложения (напрямую по токену)' },
  { key: 'ads_manager', label: 'Ads Manager', hint: 'повторяет ручную привязку в браузере' },
  { key: 'cookie', label: 'Cookie', hint: 'полная имитация браузера через cookie' },
];

/**
 * Привязка карт к кабинетам (как в FBTOOL): выбираешь кабинеты, вводишь карты,
 * жмёшь «Привязать». Карта берётся по кругу к следующему кабинету. Данные карт
 * не сохраняются — уходят напрямую в FB. Сам вызов привязки подключается после
 * захвата точного запроса (расширение/HAR).
 */
export default function CardBinder({ cabinets }: { cabinets: Cabinet[] }) {
  const owners = useMemo(() => [...new Set(cabinets.map((c) => c.group))], [cabinets]);
  const [owner, setOwner] = useState(owners[0] ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<Card[]>([emptyCard()]);
  const [method, setMethod] = useState<CardBindMethod>('ios');
  const [delaySec, setDelaySec] = useState('0');
  const [rebind, setRebind] = useState(false);
  const [billingCountry, setBillingCountry] = useState('');
  const [currency, setCurrency] = useState('');
  const [results, setResults] = useState<CardLinkResult[]>([]);
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();

  const ownerCabs = cabinets.filter((c) => c.group === owner);
  const needle = q.trim().toLowerCase();
  const visible = needle
    ? ownerCabs.filter((c) => c.name.toLowerCase().includes(needle) || c.externalId.toLowerCase().includes(needle))
    : ownerCabs;
  const selectedList = cabinets.filter((c) => selected.has(c.id));

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (on: boolean) => setSelected((p) => { const n = new Set(p); for (const c of visible) on ? n.add(c.id) : n.delete(c.id); return n; });

  const setCard = (i: number, patch: Partial<Card>) => setCards((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const digits = (s: string) => s.replace(/\D/g, '');

  const validCards = cards.filter((c) => c.number && c.month && c.year && c.cvc);

  const run = () => {
    setMsg(''); setResults([]);
    if (selectedList.length === 0) { setMsg('Выбери хотя бы один кабинет'); return; }
    if (validCards.length === 0) { setMsg('Заполни данные хотя бы одной карты'); return; }
    start(async () => {
      const r = await linkCards({
        accountIds: selectedList.map((c) => c.id),
        cards: validCards.map((c) => ({ number: digits(c.number), month: digits(c.month), year: digits(c.year), cvc: digits(c.cvc), zip: c.zip.trim() || undefined })),
        method,
        billingCountry: billingCountry.trim().toUpperCase() || undefined,
        currency: currency.trim().toUpperCase() || undefined,
        delaySec: Number(delaySec) || 0,
        rebind,
      });
      setResults(r);
      const ok = r.filter((x) => x.ok).length;
      setMsg(`Готово: ${ok}/${r.length} привязано.`);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] border border-amber/40 bg-amber-t/30 px-3.5 py-2.5 text-[11.5px] text-amber">
        Автопривязка карт не реализована: отправлять номер карты и CVC на платёжный эндпоинт FB и массово это повторять — паттерн платёжного абьюза (нарушает правила FB и обращения с картами). Карту добавляй вручную в Ads Manager. Эта вкладка может вести <b>учёт</b> — какая карта (по последним 4 цифрам) на каком кабинете; скажи — переделаю её под это.
      </div>

      {/* Кабинеты */}
      <div className="rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">Кабинеты</span>
          <div className="flex flex-wrap gap-1.5">
            {owners.map((o) => (
              <button key={o} type="button" onClick={() => { setOwner(o); setQ(''); }} className={`rounded-full border px-3 py-1 text-[12px] transition ${o === owner ? 'border-amber bg-amber-t text-amber' : 'border-line2 bg-sub text-soft hover:border-amber'}`}>{o}</button>
            ))}
          </div>
          <span className="ml-auto text-[12px] text-mute">выбрано {selectedList.length}</span>
        </div>
        <div className="scroll-slim mt-3 max-h-[240px] overflow-auto rounded-[12px] border border-line">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-sub px-3 py-1.5">
            <span className="shrink-0 text-[11.5px] font-semibold text-amber">{owner}</span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени или ID…" className="ml-auto h-7 w-[46%] min-w-[140px] rounded-lg border border-line2 bg-bg px-2.5 text-[11.5px] text-soft placeholder:text-dim" />
            <button type="button" onClick={() => toggleAll(!(visible.length > 0 && visible.every((c) => selected.has(c.id))))} className="shrink-0 text-[11px] text-mute transition hover:text-sage">
              {visible.length > 0 && visible.every((c) => selected.has(c.id)) ? 'снять все' : 'выбрать все'}
            </button>
          </div>
          {visible.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-t border-line px-3 py-1.5 text-[12.5px] transition hover:bg-sub/60">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-[#b4c68c]" />
              <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
              {c.name && c.name !== c.externalId ? <span className="n shrink-0 text-[11px] text-dim">{c.externalId}</span> : null}
            </label>
          ))}
          {ownerCabs.length === 0 ? <div className="px-3 py-3 text-[12px] text-mute">У этого овнера нет кабинетов.</div> : null}
        </div>
      </div>

      {/* Карты */}
      <div className="rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold">Карты</span>
          <span className="text-[11.5px] text-mute">по кругу: карта №1 → кабинет №1, №2 → №2…</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {cards.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_64px_64px_72px_88px_auto] items-center gap-2">
              <input value={c.number} onChange={(e) => setCard(i, { number: e.target.value })} inputMode="numeric" placeholder="Номер карты" className={`n ${inp}`} />
              <input value={c.month} onChange={(e) => setCard(i, { month: e.target.value })} inputMode="numeric" maxLength={2} placeholder="ММ" className={`n ${inp}`} />
              <input value={c.year} onChange={(e) => setCard(i, { year: e.target.value })} inputMode="numeric" maxLength={4} placeholder="ГГ" className={`n ${inp}`} />
              <input value={c.cvc} onChange={(e) => setCard(i, { cvc: e.target.value })} inputMode="numeric" maxLength={4} placeholder="CVC" className={`n ${inp}`} />
              <input value={c.zip} onChange={(e) => setCard(i, { zip: e.target.value })} placeholder="ZIP" className={`n ${inp}`} />
              {cards.length > 1 ? (
                <button type="button" onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))} className="grid h-8 w-8 place-items-center rounded-lg text-mute transition hover:text-rust">×</button>
              ) : <span className="w-8" />}
            </div>
          ))}
          <button type="button" onClick={() => setCards((cs) => [...cs, emptyCard()])} className="self-start text-[11.5px] text-mute transition hover:text-sage">+ ещё карта</button>
        </div>
      </div>

      {/* Параметры */}
      <div className="rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="lab mb-1.5">Метод</div>
            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => (
                <button key={m.key} type="button" onClick={() => setMethod(m.key)} title={m.hint} className={`rounded-full border px-3 py-1 text-[12px] transition ${method === m.key ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>{m.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="lab mb-1.5">Задержка, сек</div>
            <input value={delaySec} onChange={(e) => setDelaySec(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="0" className={`n ${inp} w-[90px]`} />
          </div>
          <div>
            <div className="lab mb-1.5">Страна биллинга</div>
            <input value={billingCountry} onChange={(e) => setBillingCountry(e.target.value)} placeholder="US" className={`n ${inp} w-[90px]`} />
          </div>
          <div>
            <div className="lab mb-1.5">Валюта</div>
            <input value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="USD" className={`n ${inp} w-[90px]`} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-1.5 text-[12px] text-soft">
            <input type="checkbox" checked={rebind} onChange={(e) => setRebind(e.target.checked)} className="accent-[#b4c68c]" />
            Перепривязывать, если карта уже есть
          </label>
        </div>
        <p className="mt-2 text-[11px] text-dim">{METHODS.find((m) => m.key === method)?.hint}</p>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={run} disabled={pending} className={`rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition ${pending ? 'opacity-50' : 'hover:brightness-110'}`}>
          {pending ? 'Привязываю…' : `Привязать (${selectedList.length})`}
        </button>
        {msg ? <span className="text-[12px] text-mute">{msg}</span> : null}
      </div>

      {results.length ? (
        <div className="flex flex-col gap-1.5">
          {results.map((r) => (
            <div key={r.cabinetId} className={`flex items-center gap-2 rounded-[12px] border bg-sub px-3.5 py-2.5 text-[12.5px] ${r.ok ? 'border-line' : 'border-rust/40'}`}>
              <span className={r.ok ? 'text-sage' : 'text-rust'}>{r.ok ? '✓' : '✗'}</span>
              <span className="min-w-0 flex-1 truncate text-soft">{r.label}</span>
              <span className={`shrink-0 text-[11.5px] ${r.ok ? 'text-mute' : 'text-rust'}`}>{r.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
