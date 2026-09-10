'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Badge } from './ui';
import { IconRocket } from './icons';
import Tip from './Tip';
import SyncAds from './SyncAds';
import AdActions from './AdActions';
import { campaignBadge, type StatusTone } from '@/lib/fb-status';
import { setAdBudget } from '@/app/actions/integrations';

export type AdRow = {
  id: string;
  adId: string;
  name: string;
  status: string;
  thumbnailUrl: string;
  linkUrl: string;
  ktToken: string;
  adsetName: string;
  campaignId: string;
  campaignName: string;
  dailyBudgetCents: number | null;
  targeting: string;
  account: string;
  act: string;
  currency: string;
  buyer: string;
  initials: string;
  color: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  leads: number;
  revenueCents: number;
};

const TONE: Record<StatusTone, string> = {
  ok: 'bg-sage-t text-sage',
  warn: 'bg-amber-t text-amber',
  bad: 'bg-rust-t text-rust',
  mute: 'bg-sub text-mute',
};

const money = (cents: number) =>
  '$' + (cents / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = (n: number) => Math.round(n).toLocaleString('ru-RU');
const pct = (part: number, whole: number, digits = 2) =>
  whole ? ((part / whole) * 100).toFixed(digits).replace('.', ',') + '%' : '—';

type Enriched = AdRow & {
  cpc: number; // центы
  ctr: number; // доля
  cpm: number; // центы
  cpl: number; // центы
  cr: number; // доля
  profitCents: number;
  roi: number; // доля
  /** В режиме группировки по кампании: сколько объявлений свёрнуто в строку. */
  adCount?: number;
  /** Строка — это кампания (агрегат), а не одно объявление. */
  isCampaign?: boolean;
};

/** Из «сырых» сумм собираем производные метрики (CPC/CTR/…). */
function derive(base: { spendCents: number; impressions: number; clicks: number; leads: number; revenueCents: number }) {
  const profitCents = base.revenueCents - base.spendCents;
  return {
    cpc: base.clicks ? Math.round(base.spendCents / base.clicks) : 0,
    ctr: base.impressions ? base.clicks / base.impressions : 0,
    cpm: base.impressions ? Math.round((base.spendCents / base.impressions) * 1000) : 0,
    cpl: base.leads ? Math.round(base.spendCents / base.leads) : 0,
    cr: base.clicks ? base.leads / base.clicks : 0,
    profitCents,
    roi: base.spendCents ? profitCents / base.spendCents : 0,
  };
}

type SortKey =
  | 'name' | 'buyer' | 'status' | 'budget'
  | 'impressions' | 'clicks' | 'cpc' | 'ctr' | 'cpm'
  | 'leads' | 'cpl' | 'cr' | 'spend' | 'revenue' | 'profit' | 'roi';

const COLS: { key: SortKey; label: string; hint: string }[] = [
  { key: 'impressions', label: 'Показы', hint: 'Показы объявления (impressions)' },
  { key: 'clicks', label: 'Клики', hint: 'Клики по ссылке (inline link clicks)' },
  { key: 'cpc', label: 'CPC', hint: 'Цена клика: расход / клики' },
  { key: 'ctr', label: 'CTR', hint: 'Кликабельность: клики / показы' },
  { key: 'cpm', label: 'CPM', hint: 'Цена 1000 показов: расход / показы × 1000' },
  { key: 'leads', label: 'Лиды', hint: 'Результаты из Facebook (конверсионные actions)' },
  { key: 'cpl', label: 'CPL', hint: 'Цена лида: расход / лиды' },
  { key: 'cr', label: 'CR', hint: 'Конверсия: лиды / клики' },
  { key: 'spend', label: 'Расход', hint: 'Расход из Facebook' },
  { key: 'revenue', label: 'Доход', hint: 'Доход из Keitaro по ad_id (Sub ID 4)' },
  { key: 'profit', label: 'Профит', hint: 'Доход − расход' },
  { key: 'roi', label: 'ROI', hint: 'Профит / расход' },
];

export default function CampaignsTable({
  rows,
  win,
  day,
  owners,
  ktRevenue,
  admin,
  updated,
}: {
  rows: AdRow[];
  win: number;
  day: string;
  owners: { handle: string; initials: string; color: string }[];
  /** Авторитетный подтверждённый доход из Keitaro по баерам (handle → суммы). */
  ktRevenue: Record<string, { revenueCents: number; conversions: number }>;
  admin: boolean;
  updated: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Группировка: по объявлениям или свёрнуто по кампаниям. И показывать ли
  // объявления без открута. Оба выбора запоминаем в браузере.
  const [group, setGroupState] = useState<'ad' | 'campaign'>('ad');
  const [showZero, setShowZeroState] = useState(false);
  const setGroup = (v: 'ad' | 'campaign') => { setGroupState(v); try { localStorage.setItem('ads.campaigns.group', v); } catch {} };
  const setShowZero = (v: boolean) => { setShowZeroState(v); try { localStorage.setItem('ads.campaigns.zero', v ? '1' : '0'); } catch {} };

  const enrich = (r: AdRow): Enriched => ({ ...r, ...derive(r) });

  const all = useMemo(() => rows.map(enrich), [rows]);

  // Переключатель профилей. Для админа список овнеров приходит с сервера (SKO/MPR
  // есть всегда, даже без данных за период); иначе берём из строк. Порядок:
  // сначала SKO, потом MPR, дальше по алфавиту.
  const buyers = useMemo(() => {
    const list = owners.length
      ? owners.map((o) => ({ handle: o.handle, initials: o.initials, color: o.color }))
      : [...new Map(all.map((r) => [r.buyer, { handle: r.buyer, initials: r.initials, color: r.color }])).values()];
    const rank = (h: string) => (h === 'SKO' ? 0 : h === 'MPR' ? 1 : 2);
    return [...list].sort((a, b) => rank(a.handle) - rank(b.handle) || a.handle.localeCompare(b.handle));
  }, [all, owners]);

  // По умолчанию — первый профиль (SKO). Выбор запоминаем в браузере, чтобы при
  // следующем заходе открывался тот же. localStorage читаем после монтирования,
  // иначе серверный и клиентский рендер разойдутся.
  const [buyer, setBuyerState] = useState<string>(buyers.length > 1 ? buyers[0].handle : 'all');
  const setBuyer = (v: string) => {
    setBuyerState(v);
    try { localStorage.setItem('ads.campaigns.buyer', v); } catch { /* приватный режим */ }
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ads.campaigns.buyer');
      if (saved && (saved === 'all' || buyers.some((b) => b.handle === saved))) setBuyerState(saved);
      if (localStorage.getItem('ads.campaigns.group') === 'campaign') setGroupState('campaign');
      if (localStorage.getItem('ads.campaigns.zero') === '1') setShowZeroState(true);
    } catch { /* нет доступа к localStorage */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Строки выбранного овнера (без учёта поиска) — на них считаем сводку.
  const byBuyer = useMemo(
    () => (buyer === 'all' ? all : all.filter((r) => r.buyer === buyer)),
    [all, buyer],
  );

  const summary = useMemo(() => {
    let spend = 0, clicks = 0, leads = 0, attributed = 0, impressions = 0;
    let foreign = false;
    for (const r of byBuyer) {
      clicks += r.clicks; leads += r.leads; impressions += r.impressions;
      if (r.currency === 'USD') { spend += r.spendCents; attributed += r.revenueCents; }
      else foreign = true;
    }
    // Доход — авторитетный из Keitaro (подтверждённый по кампаниям), а не сумма
    // привязанного к объявлениям. Для 'all' складываем по всем баерам списка.
    const kt = (h: string) => ktRevenue[h]?.revenueCents ?? 0;
    const revenue =
      buyer === 'all' ? buyers.reduce((s, b) => s + kt(b.handle), 0) : kt(buyer);
    // Сколько дохода не привязалось к объявлению (нет sub_id_4 / нет открута).
    const unattributed = Math.max(0, revenue - attributed);
    return { spend, clicks, leads, revenue, attributed, unattributed, impressions, profit: revenue - spend, foreign };
  }, [byBuyer, ktRevenue, buyer, buyers]);

  const view = useMemo(() => {
    // Фильтр открута: по умолчанию только то, что реально крутилось в окне.
    const active = (r: Enriched) => r.spendCents > 0 || r.impressions > 0 || r.clicks > 0;
    const base = showZero ? byBuyer : byBuyer.filter(active);

    // Группировка по кампании: сворачиваем объявления одной FB-кампании в одну
    // строку с суммарными метриками. Расход/доход суммируем только по USD.
    let list: Enriched[];
    if (group === 'campaign') {
      const m = new Map<string, { name: string; spendCents: number; impressions: number; clicks: number; leads: number; revenueCents: number; count: number; foreign: boolean }>();
      for (const r of base) {
        const key = r.campaignId || `adset:${r.adsetName}`;
        const g = m.get(key) ?? { name: r.campaignName || r.adsetName || 'Без кампании', spendCents: 0, impressions: 0, clicks: 0, leads: 0, revenueCents: 0, count: 0, foreign: false };
        g.impressions += r.impressions; g.clicks += r.clicks; g.leads += r.leads;
        if (r.currency === 'USD') { g.spendCents += r.spendCents; g.revenueCents += r.revenueCents; } else g.foreign = true;
        g.count += 1;
        m.set(key, g);
      }
      list = [...m.entries()].map(([key, g]) => ({
        id: key, adId: '', name: g.name, status: '', thumbnailUrl: '', linkUrl: '', ktToken: '',
        adsetName: '', campaignId: key, campaignName: g.name, dailyBudgetCents: null, targeting: '',
        account: '', act: '', currency: g.foreign ? 'MIXED' : 'USD', buyer: '', initials: '', color: '',
        spendCents: g.spendCents, impressions: g.impressions, clicks: g.clicks, leads: g.leads, revenueCents: g.revenueCents,
        ...derive(g), adCount: g.count, isCampaign: true,
      }));
    } else {
      list = base;
    }

    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((r) =>
        `${r.name} ${r.adsetName} ${r.act} ${r.targeting} ${r.account}`.toLowerCase().includes(needle),
      );
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (r: Enriched): number | string => {
      switch (sortKey) {
        case 'name': return r.name.toLowerCase();
        case 'buyer': return r.buyer.toLowerCase();
        case 'status': return r.status;
        case 'budget': return r.dailyBudgetCents ?? -1;
        case 'spend': return r.spendCents;
        case 'revenue': return r.revenueCents;
        case 'profit': return r.profitCents;
        default: return (r as unknown as Record<string, number>)[sortKey] ?? 0;
      }
    };
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (typeof x === 'string' || typeof y === 'string') return String(x).localeCompare(String(y)) * dir;
      return (x - y) * dir;
    });
  }, [byBuyer, q, sortKey, sortDir, group, showZero]);

  const sortBy = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  const saveBudget = (id: string) => {
    const v = budgets[id];
    if (!v) return;
    setMsg(null);
    start(async () => {
      const fd = new FormData();
      fd.set('id', id); fd.set('budget', v);
      const res = await setAdBudget(null, fd);
      if (res && !res.ok) setMsg(res.error ?? 'Не вышло');
      else { setBudgets((b) => { const n = { ...b }; delete n[id]; return n; }); router.refresh(); }
    });
  };

  // Для левой колонки — стрелка в потоке. Для числовых колонок центрирование
  // важнее, поэтому там стрелка абсолютная (caret): она не сдвигает подпись, и
  // заголовок стоит ровно над числом.
  const arrow = (k: SortKey) => (
    <span className="mx-0.5 inline-block w-3 text-center align-middle text-[9px] text-dim">
      {k === sortKey ? (sortDir === 'asc' ? '▲' : '▼') : ''}
    </span>
  );
  const caret = (k: SortKey) =>
    k === sortKey ? (
      <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-dim">
        {sortDir === 'asc' ? '▲' : '▼'}
      </span>
    ) : null;
  const tile = (label: string, value: string, sub?: string, tone?: 'sage' | 'rust') => (
    <div className="rounded-[18px] bg-sub px-4 py-3">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`n mt-1 text-[20px] font-semibold ${tone === 'sage' ? 'text-sage' : tone === 'rust' ? 'text-rust' : ''}`}>{value}</div>
      {sub ? <div className="n mt-0.5 text-[11px] text-dim">{sub}</div> : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Шапка: ракета, переключатель овнеров (слева от названия), период, кнопка. */}
      <div className="flex flex-wrap items-center justify-between gap-y-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <Badge tint="bg-sage-t"><IconRocket color="#b4c68c" /></Badge>
          {buyers.length > 1 ? (
            <div className="flex items-center gap-1 rounded-full bg-sub p-1">
              {buyers.map((b) => (
                <button
                  key={b.handle}
                  type="button"
                  onClick={() => setBuyer(b.handle)}
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition ${
                    buyer === b.handle ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
                  }`}
                >
                  <Avatar initials={b.initials} color={b.color} size={16} />
                  {b.handle}
                </button>
              ))}
            </div>
          ) : null}
          <h2 className="text-[17px] font-semibold tracking-[-0.015em]">Кампании</h2>
          <span className="hidden h-5 w-px bg-line2 sm:block" />
          <span className="text-[12.5px] text-mute">
            {day ? `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}` : win === 1 ? 'сегодня' : `${win} дней`}
            {updated ? ` · обновлено ${updated}` : ''}
          </span>
        </div>
        {admin ? <SyncAds /> : null}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-[18px] border border-line2 px-6 py-10 text-center text-[13px] text-mute">
          Статистики пока нет. Нажми «Обновить стату» (у админа) или дождись крона.
        </div>
      ) : null}

      {/* Сводка */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {tile('Расход', money(summary.spend))}
        {tile('Клики', int(summary.clicks), `CPC ${summary.clicks ? money(Math.round(summary.spend / summary.clicks)) : '—'}`)}
        {tile('Лиды', int(summary.leads), `CPL ${summary.leads ? money(Math.round(summary.spend / summary.leads)) : '—'}`)}
        {tile('Доход', money(summary.revenue), summary.unattributed > 0 ? `${money(summary.unattributed)} без привязки к объявл.` : 'подтв. из Keitaro')}
        {tile('Профит', money(summary.profit), undefined, summary.profit >= 0 ? 'sage' : 'rust')}
        {tile('ROI', summary.spend ? pct(summary.profit, summary.spend, 1) : '—', undefined, summary.profit >= 0 ? 'sage' : 'rust')}
      </div>

      {/* Панель управления списком */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск: объявление, адсет, act, гео…"
          className="h-9 min-w-[220px] flex-1 rounded-full border border-line2 bg-sub px-4 text-[12.5px] text-text outline-none transition focus:border-sage"
        />
        {/* Объявления / Кампании — общая стата по кампании, если у неё много объявлений. */}
        <div className="flex items-center gap-1 rounded-full bg-sub p-1">
          {([['ad', 'Объявления'], ['campaign', 'Кампании']] as const).map(([v, t]) => (
            <button
              key={v}
              type="button"
              onClick={() => setGroup(v)}
              className={`rounded-full px-3 py-1 text-[11.5px] transition ${
                group === v ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        {/* Показывать ли объявления без открута (свежие дубли, паузы). */}
        <button
          type="button"
          onClick={() => setShowZero(!showZero)}
          className={`h-9 rounded-full border px-3 text-[11.5px] transition ${
            showZero ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-mute hover:text-soft'
          }`}
          title="Показывать объявления без открута за период"
        >
          {showZero ? 'все' : 'без открута'}
        </button>
        <div className="flex items-center gap-1 rounded-full bg-sub p-1">
          {([['1', 'сегодня'], ['7', '7 дней'], ['14', '14 дней']] as const).map(([v, t]) => (
            <a
              key={v}
              href={`/ads/campaigns${v === '1' ? '' : `?d=${v}`}`}
              className={`rounded-full px-3 py-1 text-[11.5px] transition ${
                !day && String(win) === v ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
              }`}
            >
              {t}
            </a>
          ))}
        </div>
        {/* Конкретный день из календаря — стата ровно за него. */}
        <input
          type="date"
          value={day}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => router.push(e.target.value ? `/ads/campaigns?day=${e.target.value}` : '/ads/campaigns')}
          className={`h-9 rounded-full border bg-sub px-3 text-[12px] outline-none transition focus:border-sage ${
            day ? 'border-sage text-text' : 'border-line2 text-mute'
          }`}
          title="Стата за конкретный день"
        />
      </div>

      {msg ?<div className="rounded-xl px-3.5 py-2.5 text-[12px]" style={{ background: '#2c1f1a', color: '#ce6e58' }}>{msg}</div> : null}
      {notice ? <div className="flex items-center justify-between gap-3 rounded-xl bg-sage-t px-3.5 py-2.5 text-[12px] text-sage"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} className="text-[13px] opacity-70 hover:opacity-100">✕</button></div> : null}

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-mute">
              <th className="cursor-pointer whitespace-nowrap py-2 pr-3 font-medium" onClick={() => sortBy('name')}>{group === 'campaign' ? 'Кампания' : 'Объявление'}{arrow('name')}</th>
              {COLS.map((c) => (
                <th
                  key={c.key}
                  className={`relative cursor-pointer whitespace-nowrap px-3 py-2 text-center font-medium ${c.key === 'profit' ? 'text-soft' : ''}`}
                  onClick={() => sortBy(c.key)}
                >
                  <Tip label={c.hint}>{c.label}</Tip>{caret(c.key)}
                </th>
              ))}
              <th className="relative cursor-pointer whitespace-nowrap px-3 py-2 text-center font-medium text-soft" onClick={() => sortBy('budget')}>
                <Tip label="Дневной бюджет (адсета или кампании, если CBO). Клик по значению — изменить.">Бюджет</Tip>{caret('budget')}
              </th>
              <th className="whitespace-nowrap px-3 py-2 text-center font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const badge = campaignBadge(r.status);
              const active = r.status === 'ACTIVE';
              const editing = budgets[r.id] !== undefined;
              return (
                <tr key={r.id} className="border-t border-line align-middle">
                  {/* Кампания (агрегат) или объявление */}
                  <td className="py-2.5 pr-3">
                    {r.isCampaign ? (
                      <div className="min-w-0">
                        <div className="truncate text-[12.5px] text-soft" title={r.name}>{r.name}</div>
                        <div className="mt-0.5 text-[10.5px] text-dim">{r.adCount} объявл.{r.currency === 'MIXED' ? ' · разные валюты' : ''}</div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2.5">
                        {r.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumbnailUrl} alt="" className="mt-0.5 h-9 w-9 shrink-0 rounded-md object-cover" />
                        ) : (
                          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sub text-dim">—</span>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 truncate text-[12.5px] text-soft" title={r.name}>{r.name || `#${r.adId}`}</span>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${TONE[badge.tone]}`}>{badge.label}</span>
                            {r.ktToken ? null : <span className="shrink-0 rounded-full bg-sub px-2 py-0.5 text-[10px] text-dim" title="Токен КТ в ссылке не распознан">нет потока</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-x-2 text-[10.5px] text-dim">
                            <Tip label="act_ID кабинета в Facebook"><span className="n cursor-help">{r.act}</span></Tip>
                            {r.targeting ? <span className="n">· {r.targeting}</span> : null}
                            {r.linkUrl ? <a href={r.linkUrl} target="_blank" rel="noreferrer" className="text-steel hover:underline">· ссылка</a> : null}
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{int(r.impressions)}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{int(r.clicks)}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{r.clicks ? money(r.cpc) : '—'}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{pct(r.clicks, r.impressions)}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{r.impressions ? money(r.cpm) : '—'}</td>
                  <td className="n px-3 py-2.5 text-center text-[13px] text-soft">{int(r.leads)}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{r.leads ? money(r.cpl) : '—'}</td>
                  <td className="n px-3 py-2.5 text-center text-[12px] text-mute">{pct(r.leads, r.clicks)}</td>
                  <td className="n px-3 py-2.5 text-center text-[13px] text-soft">
                    {money(r.spendCents)}
                    {r.currency !== 'USD' ? <span className="ml-1 text-[10px] text-rust">{r.currency}</span> : null}
                  </td>
                  <td className="n px-3 py-2.5 text-center text-[13px] text-soft">{money(r.revenueCents)}</td>
                  <td className={`n px-3 py-2.5 text-center text-[13px] font-semibold ${r.profitCents >= 0 ? 'text-sage' : 'text-rust'}`}>{money(r.profitCents)}</td>
                  <td className={`n px-3 py-2.5 text-center text-[13px] font-semibold ${r.profitCents >= 0 ? 'text-sage' : 'text-rust'}`}>{r.spendCents ? pct(r.profitCents, r.spendCents, 1) : '—'}</td>
                  {/* Бюджет — редактируемый, выделен; идёт перед кнопкой запуска */}
                  <td className="px-3 py-2.5 text-center">
                    {r.isCampaign ? (
                      <span className="text-dim">—</span>
                    ) : editing ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          value={budgets[r.id]}
                          onChange={(e) => setBudgets((b) => ({ ...b, [r.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') saveBudget(r.id); }}
                          className="n h-7 w-16 rounded-md border border-line2 bg-sub px-2 text-center text-[12px] outline-none focus:border-sage"
                          autoFocus
                        />
                        <button type="button" disabled={pending} onClick={() => saveBudget(r.id)} className="text-sage">✓</button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setBudgets((b) => ({ ...b, [r.id]: r.dailyBudgetCents != null ? String(Math.round(r.dailyBudgetCents / 100)) : '' }))}
                        className="n rounded-md bg-sub px-2.5 py-1 text-[13px] font-semibold text-text transition hover:text-sage"
                        title="Изменить дневной бюджет адсета"
                      >
                        {r.dailyBudgetCents != null ? money(r.dailyBudgetCents) : '—'}
                      </button>
                    )}
                  </td>
                  {/* Действия */}
                  <td className="px-2 py-2.5 text-center">
                    {r.isCampaign ? <span className="text-dim">—</span> : <AdActions id={r.id} active={active} name={r.name} onError={(m) => { setNotice(null); setMsg(m); }} onOk={(m) => { setMsg(null); setNotice(m); }} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="text-[11px] text-dim">{group === 'campaign' ? 'Кампаний' : 'Объявлений'}: {view.length}. Клик по заголовку — сортировка{group === 'campaign' ? '' : ', клик по бюджету — правка'}.</div>
    </div>
  );
}
