'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { buyDomain, returnDomain } from '@/app/actions/domains';
import Tip from './Tip';

export type ZoneGroup = {
  zone: string;
  priceCents: number | null;
  domains: { id: string; name: string }[];
};

export type SoldRow = {
  id: string;
  name: string;
  buyerHandle: string;
  priceLabel: string;
  ktMoved: boolean;
  ktError: string;
  soldAt: string | null;
  mine: boolean;
};

export type BuyerOpt = { id: string; handle: string };

/**
 * Витрина доменов + список купленных. Покупка/возврат идут через серверные
 * действия; результат (включая заметку о переносе в Keitaro) показываем рядом.
 * Админ может купить на конкретного баера — для этого сверху выбор «покупаю за».
 */
export default function Storefront({
  zones,
  sold,
  buyers,
  admin,
  canBuy,
}: {
  zones: ZoneGroup[];
  sold: SoldRow[];
  buyers: BuyerOpt[];
  admin: boolean;
  canBuy: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [actingBuyer, setActingBuyer] = useState(admin && buyers[0] ? buyers[0].id : '');

  const buy = (id: string) => {
    if (pending) return;
    setBusyId(id);
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id);
      if (admin) fd.set('buyerId', actingBuyer);
      const r = await buyDomain(fd);
      setBusyId(null);
      if (!r?.ok) {
        setMsg({ ok: false, text: r?.error ?? 'Не вышло купить.' });
      } else {
        setMsg({ ok: true, text: r.ktNote ? `Куплено. ${r.ktNote}` : 'Куплено — домен в твоей группе КТ.' });
      }
      router.refresh();
    });
  };

  const back = (id: string) => {
    if (pending) return;
    setBusyId(id);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id);
      await returnDomain(fd);
      setBusyId(null);
      router.refresh();
    });
  };

  const totalFree = zones.reduce((n, z) => n + z.domains.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {msg ? (
        <div
          className="rounded-[14px] border px-3.5 py-2.5 text-[12.5px]"
          style={
            msg.ok
              ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' }
              : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }
          }
        >
          {msg.text}
        </div>
      ) : null}

      {admin && buyers.length ? (
        <label className="flex flex-wrap items-center gap-2 text-[12px] text-mute">
          Покупаю за баера:
          <select
            value={actingBuyer}
            onChange={(e) => setActingBuyer(e.target.value)}
            className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft"
          >
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>{b.handle}</option>
            ))}
          </select>
        </label>
      ) : null}

      {/* Витрина: свободные домены по зонам, у каждой зоны своя цена. */}
      {totalFree === 0 ? (
        <p className="text-[12.5px] text-mute">Свободных доменов на складе нет.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {zones
            .filter((z) => z.domains.length)
            .map((z) => (
              <div key={z.zone} className="rounded-[16px] border border-line px-3.5 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[13px] font-semibold">
                    .{z.zone}
                    <span className="ml-2 text-[11.5px] font-normal text-mute">{z.domains.length} шт.</span>
                  </span>
                  <span className="text-[12.5px]">
                    {z.priceCents != null ? (
                      <span className="text-sage">${(z.priceCents / 100).toFixed(2)}</span>
                    ) : (
                      <span className="text-rust">цена зоны не задана</span>
                    )}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {z.domains.map((d) => {
                    const disabled = !canBuy || z.priceCents == null || (pending && busyId === d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => buy(d.id)}
                        title={z.priceCents == null ? 'Сначала задай цену зоны' : !canBuy ? 'Нет профиля баера' : 'Купить домен'}
                        className={`inline-flex items-center gap-1.5 rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${
                          disabled ? 'cursor-not-allowed opacity-50 hover:border-line2 hover:text-soft' : ''
                        }`}
                      >
                        <span className="font-medium">{d.name}</span>
                        {pending && busyId === d.id ? <span className="text-mute">…</span> : <span className="text-mute">купить</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Купленные домены. Баер видит свои, команда/админ — все. */}
      {sold.length ? (
        <div className="mt-1">
          <div className="mb-2 text-[13px] font-semibold">Купленные</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[12.5px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-dim">
                  <th className="py-1.5 pr-3 font-medium">Домен</th>
                  <th className="py-1.5 pr-3 font-medium">Баер</th>
                  <th className="py-1.5 pr-3 font-medium">Цена</th>
                  <th className="py-1.5 pr-3 font-medium">КТ</th>
                  <th className="py-1.5 pr-3 font-medium">Куплен</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {sold.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-medium">{s.name}</td>
                    <td className="py-1.5 pr-3 text-mute">{s.buyerHandle}</td>
                    <td className="py-1.5 pr-3">{s.priceLabel}</td>
                    <td className="py-1.5 pr-3">
                      {s.ktMoved ? (
                        <span className="text-sage">в группе</span>
                      ) : s.ktError ? (
                        <Tip label={s.ktError}>
                          <span className="cursor-help text-rust underline decoration-dotted">не перенесён</span>
                        </Tip>
                      ) : (
                        <span className="text-mute">—</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-mute">{s.soldAt ?? '—'}</td>
                    <td className="py-1.5 text-right">
                      {s.mine || admin ? (
                        <button
                          type="button"
                          disabled={pending && busyId === s.id}
                          onClick={() => back(s.id)}
                          className="rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust"
                        >
                          вернуть
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
