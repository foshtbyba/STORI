'use client';

import { useState } from 'react';
import { fetchTiktokCampaigns, toggleTiktokCampaign, setTiktokCampaignBudget } from '@/app/actions/tiktok';
import type { TiktokCampaignRow } from '@/lib/tiktok';

export type TiktokAccountLite = {
  id: string;
  name: string;
  advertiserId: string;
  currency: string;
  dead: boolean;
};

/** Деньги из центов: USD как $, прочее — округляем и локализуем. */
function money(cents: number, currency: string): string {
  const v = cents / 100;
  return currency === 'USD'
    ? `$${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`
    : `${Math.round(v).toLocaleString('ru-RU')} ${currency}`;
}

const DAYS_OPTS = [7, 14, 30];

/** Читаемый статус кампании + тон бейджа. */
function statusView(row: TiktokCampaignRow): { label: string; tone: 'ok' | 'mute' | 'warn' } {
  if (row.status === 'ENABLE') return { label: 'запущена', tone: 'ok' };
  if (row.status === 'DISABLE') return { label: 'пауза', tone: 'mute' };
  return { label: row.status || '—', tone: 'warn' };
}

const TONE: Record<'ok' | 'mute' | 'warn', string> = {
  ok: 'bg-sage-t text-sage',
  mute: 'bg-sub text-mute',
  warn: 'bg-amber-t text-amber',
};

/**
 * Таблица кампаний TikTok по выбранному кабинету — зеркало FB-кампаний.
 * Данные тянутся по кнопке (серверный экшен → Marketing API). Пауза/запуск и
 * правка бюджета — прямо из строки. До боевого токена экшен вернёт понятную
 * ошибку, а вся раскладка уже на месте.
 */
export default function TiktokCampaigns({ accounts }: { accounts: TiktokAccountLite[] }) {
  const live = accounts.filter((a) => !a.dead);
  const [accountId, setAccountId] = useState(live[0]?.id ?? accounts[0]?.id ?? '');
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<TiktokCampaignRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const acc = accounts.find((a) => a.id === accountId);
  const cur = acc?.currency ?? 'USD';

  const load = async () => {
    if (!accountId) return;
    setLoading(true);
    setError('');
    setNote('');
    const r = await fetchTiktokCampaigns(accountId, days);
    setLoading(false);
    if (r.ok) setRows(r.rows);
    else { setRows(null); setError(r.error); }
  };

  const onToggle = async (row: TiktokCampaignRow) => {
    const enable = row.status !== 'ENABLE';
    setNote('');
    const r = await toggleTiktokCampaign(accountId, row.campaignId, enable);
    if (r?.ok) { setNote(r.info ?? 'Готово'); load(); }
    else setError(r?.error ?? 'Не удалось');
  };

  const onBudget = async (row: TiktokCampaignRow) => {
    const cur0 = (row.budgetCents / 100).toString();
    const raw = window.prompt(`Новый бюджет для «${row.name}» (${cur}):`, cur0);
    if (raw == null) return;
    const val = Number(raw.replace(',', '.'));
    if (!(val > 0)) { setError('Бюджет должен быть больше нуля'); return; }
    setNote('');
    const r = await setTiktokCampaignBudget(accountId, row.campaignId, val);
    if (r?.ok) { setNote(r.info ?? 'Готово'); load(); }
    else setError(r?.error ?? 'Не удалось');
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Панель выбора кабинета и периода. */}
      <div className="flex flex-wrap items-end gap-2.5">
        <label className="flex flex-col gap-1 text-[11.5px] text-mute">
          Кабинет
          <select
            value={accountId}
            onChange={(e) => { setAccountId(e.target.value); setRows(null); }}
            className="min-w-[200px] rounded-[10px] border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.advertiserId}{a.dead ? ' — недоступен' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-mute">
          Период
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-[10px] border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft"
          >
            {DAYS_OPTS.map((d) => <option key={d} value={d}>{d} дн.</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={load}
          disabled={loading || !accountId}
          className="rounded-full bg-sage-t px-4 py-2 text-[12.5px] font-semibold text-sage transition hover:brightness-110 disabled:opacity-50"
        >
          {loading ? 'Загружаю…' : rows ? 'Обновить' : 'Загрузить кампании'}
        </button>
      </div>

      {error ? (
        <div className="rounded-[12px] border border-rust/40 bg-rust-t px-3 py-2.5 text-[12px] text-rust">{error}</div>
      ) : null}
      {note ? (
        <div className="rounded-[12px] border border-sage/40 bg-sage-t px-3 py-2.5 text-[12px] text-sage">{note}</div>
      ) : null}

      {rows && rows.length === 0 ? (
        <div className="rounded-[12px] border border-line2 bg-sub/60 px-3 py-6 text-center text-[12.5px] text-mute">
          В этом кабинете кампаний нет.
        </div>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-dim">
                <th className="py-2 pr-3 font-medium">Кампания</th>
                <th className="px-2 py-2 font-medium">Статус</th>
                <th className="px-2 py-2 text-right font-medium">Бюджет</th>
                <th className="px-2 py-2 text-right font-medium">Расход</th>
                <th className="px-2 py-2 text-right font-medium">Показы</th>
                <th className="px-2 py-2 text-right font-medium">Клики</th>
                <th className="px-2 py-2 text-right font-medium">CTR</th>
                <th className="px-2 py-2 text-right font-medium">CPC</th>
                <th className="px-2 py-2 text-right font-medium">Конв.</th>
                <th className="px-2 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const st = statusView(row);
                const mode = row.budgetMode === 'BUDGET_MODE_DAY' ? '/день'
                  : row.budgetMode === 'BUDGET_MODE_TOTAL' ? 'всего'
                  : row.budgetMode === 'BUDGET_MODE_INFINITE' ? 'без лимита' : '';
                return (
                  <tr key={row.campaignId} className="border-b border-line/60 hover:bg-sub/50">
                    <td className="max-w-[240px] py-2 pr-3">
                      <div className="truncate font-medium text-soft" title={row.name}>{row.name || row.campaignId}</div>
                      <div className="truncate text-[10.5px] text-dim">
                        {row.objective}{row.secondaryStatus ? ` · ${row.secondaryStatus}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${TONE[st.tone]}`}>{st.label}</span>
                    </td>
                    <td className="n px-2 py-2 text-right text-soft">
                      {row.budgetMode === 'BUDGET_MODE_INFINITE' ? '—' : (
                        <button type="button" onClick={() => onBudget(row)} className="underline decoration-dotted underline-offset-2 hover:text-teal" title="Изменить бюджет">
                          {money(row.budgetCents, cur)}
                        </button>
                      )}
                      {mode ? <div className="text-[10px] text-dim">{mode}</div> : null}
                    </td>
                    <td className="n px-2 py-2 text-right text-soft">{money(row.spendCents, cur)}</td>
                    <td className="n px-2 py-2 text-right text-mute">{row.impressions.toLocaleString('ru-RU')}</td>
                    <td className="n px-2 py-2 text-right text-mute">{row.clicks.toLocaleString('ru-RU')}</td>
                    <td className="n px-2 py-2 text-right text-mute">{row.ctr.toFixed(2)}%</td>
                    <td className="n px-2 py-2 text-right text-mute">{money(row.cpcCents, cur)}</td>
                    <td className="n px-2 py-2 text-right text-mute">{row.conversions.toLocaleString('ru-RU')}</td>
                    <td className="px-2 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => onToggle(row)}
                        className="rounded-full bg-sub px-2.5 py-1 text-[10.5px] text-soft transition hover:text-text"
                        title={row.status === 'ENABLE' ? 'Поставить на паузу' : 'Запустить'}
                      >
                        {row.status === 'ENABLE' ? 'пауза' : 'запуск'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {!rows && !error && !loading ? (
        <div className="rounded-[12px] border border-line2 bg-sub/60 px-3 py-6 text-center text-[12.5px] text-mute">
          Выбери кабинет и период, затем нажми «Загрузить кампании».
        </div>
      ) : null}
    </div>
  );
}
