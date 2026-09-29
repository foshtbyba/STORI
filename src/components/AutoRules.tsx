'use client';

import { useState, useTransition } from 'react';

import {
  listAutoRules, loadAutoRuleLog,
  saveAutoRule, toggleAutoRule, deleteAutoRule, setRuleAccounts, runAutoRulesNow,
  type RuleRow, type AssignAccount, type LogRow,
} from '@/app/actions/autorules';
import type { AutoRuleParams } from '@/lib/autorules';

type TypeOpt = { type: string; label: string };

const LEVELS = [
  { v: 'campaign', l: 'Кампания' },
  { v: 'adset', l: 'Адсет' },
  { v: 'ad', l: 'Объявление' },
];

const inp = 'rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-[12.5px] text-soft';
const btn = 'rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage disabled:opacity-50';
const btnPrimary = 'rounded-full border border-sage bg-sage-t px-3.5 py-1.5 text-[12px] text-sage transition hover:brightness-110 disabled:opacity-50';

const dollars = (cents?: number) => (cents != null ? (cents / 100).toString() : '');
const toCents = (v: string) => Math.round((parseFloat(v.replace(',', '.')) || 0) * 100);
const toInt = (v: string) => Math.round(parseFloat(v.replace(',', '.')) || 0);

type Draft = { id?: string; name: string; type: string; level: string; windowDays: number; params: AutoRuleParams };

function emptyDraft(types: TypeOpt[]): Draft {
  return { name: '', type: types[0]?.type ?? 'roi_pause', level: 'ad', windowDays: 1, params: { reactivate: true } };
}

export default function AutoRules({
  initialRules, accounts, initialLog, types,
}: {
  initialRules: RuleRow[]; accounts: AssignAccount[]; initialLog: LogRow[]; types: TypeOpt[];
}) {
  const [rules, setRules] = useState<RuleRow[]>(initialRules);
  const [log, setLog] = useState<LogRow[]>(initialLog);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const labelOf = (t: string) => types.find((x) => x.type === t)?.label ?? t;

  const refresh = () => start(async () => {
    const [r, l] = await Promise.all([listAutoRules(), loadAutoRuleLog()]);
    if (r.ok) setRules(r.rules ?? []);
    if (l.ok) setLog(l.rows ?? []);
  });

  const save = () => {
    if (!draft) return;
    start(async () => {
      const r = await saveAutoRule(draft);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой сохранения' }); return; }
      setDraft(null);
      setMsg({ ok: true, text: 'Правило сохранено.' });
      const list = await listAutoRules();
      if (list.ok) setRules(list.rules ?? []);
    });
  };

  const toggle = (id: string, enabled: boolean) => start(async () => {
    await toggleAutoRule(id, enabled);
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r)));
  });

  const remove = (id: string) => start(async () => {
    await deleteAutoRule(id);
    setRules((rs) => rs.filter((r) => r.id !== id));
  });

  const runNow = () => start(async () => {
    const r = await runAutoRulesNow();
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); return; }
    setMsg({ ok: true, text: `Прогон: правил ${r.rules}, действий ${r.actions}${r.errors ? `, ошибок ${r.errors}` : ''}.` });
    const l = await loadAutoRuleLog();
    if (l.ok) setLog(l.rows ?? []);
  });

  return (
    <div className="flex flex-col gap-4">
      {/* Тулбар */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={pending} onClick={() => setDraft(emptyDraft(types))}>+ Новое правило</button>
        <button type="button" className={btn} disabled={pending} onClick={runNow}>▶ Прогнать сейчас</button>
        <button type="button" className={btn} disabled={pending} onClick={refresh}>↻ Обновить</button>
        {msg ? <span className={`text-[12px] ${msg.ok ? 'text-sage' : 'text-rust'}`}>{msg.text}</span> : null}
      </div>

      {/* Редактор */}
      {draft ? (
        <div className="rounded-[14px] border border-line2 bg-sub/40 p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1 text-[11px] text-mute">Название
              <input className={inp} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="напр. Стоп пустышек LT" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-mute">Тип
              <select className={inp} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                {types.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-mute">Уровень
              <select className={inp} value={draft.level} onChange={(e) => setDraft({ ...draft, level: e.target.value })}>
                {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-mute">Окно, дней
              <input className={inp} value={String(draft.windowDays)} inputMode="numeric" onChange={(e) => setDraft({ ...draft, windowDays: toInt(e.target.value) || 1 })} />
            </label>
          </div>

          {/* Параметры под тип */}
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            {(draft.type === 'roi_pause' || draft.type === 'roi_scale') && (
              <label className="flex flex-col gap-1 text-[11px] text-mute">ROI порог, %
                <input className={inp} value={draft.params.roiMin != null ? String(draft.params.roiMin) : ''} inputMode="numeric"
                  onChange={(e) => setDraft({ ...draft, params: { ...draft.params, roiMin: toInt(e.target.value) } })} placeholder="100" />
              </label>
            )}
            {draft.type === 'cpa_pause' && (
              <label className="flex flex-col gap-1 text-[11px] text-mute">CPA макс, $
                <input className={inp} value={dollars(draft.params.cpaMaxCents)} inputMode="decimal"
                  onChange={(e) => setDraft({ ...draft, params: { ...draft.params, cpaMaxCents: toCents(e.target.value) } })} placeholder="5.00" />
              </label>
            )}
            <label className="flex flex-col gap-1 text-[11px] text-mute">Мин. расход, $
              <input className={inp} value={dollars(draft.params.spendMinCents)} inputMode="decimal"
                onChange={(e) => setDraft({ ...draft, params: { ...draft.params, spendMinCents: toCents(e.target.value) } })} placeholder="10.00" />
            </label>
            {draft.type === 'roi_scale' && (
              <>
                <label className="flex flex-col gap-1 text-[11px] text-mute">Шаг бюджета, %
                  <input className={inp} value={draft.params.stepPct != null ? String(draft.params.stepPct) : ''} inputMode="numeric"
                    onChange={(e) => setDraft({ ...draft, params: { ...draft.params, stepPct: toInt(e.target.value) } })} placeholder="20" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-mute">Потолок бюджета, $
                  <input className={inp} value={dollars(draft.params.capCents)} inputMode="decimal"
                    onChange={(e) => setDraft({ ...draft, params: { ...draft.params, capCents: toCents(e.target.value) } })} placeholder="200.00" />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-mute">Пауза между, мин
                  <input className={inp} value={draft.params.cooldownMin != null ? String(draft.params.cooldownMin) : ''} inputMode="numeric"
                    onChange={(e) => setDraft({ ...draft, params: { ...draft.params, cooldownMin: toInt(e.target.value) } })} placeholder="360" />
                </label>
              </>
            )}
            {draft.type !== 'roi_scale' && (
              <label className="flex items-center gap-2 self-end text-[12px] text-soft">
                <input type="checkbox" checked={!!draft.params.reactivate}
                  onChange={(e) => setDraft({ ...draft, params: { ...draft.params, reactivate: e.target.checked } })} />
                Реактивация (вернуть, когда условие ушло)
              </label>
            )}
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={btnPrimary} disabled={pending} onClick={save}>Сохранить</button>
            <button type="button" className={btn} disabled={pending} onClick={() => setDraft(null)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {/* Список правил */}
      {rules.length === 0 ? (
        <p className="text-[12.5px] text-mute">Правил пока нет. Создай первое — потом повесь на кабинеты.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rules.map((r) => (
            <div key={r.id} className="rounded-[14px] border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-medium text-soft">{r.name}</span>
                <span className="rounded-full bg-sub px-2 py-0.5 text-[11px] text-mute">{labelOf(r.type)}</span>
                <span className="rounded-full bg-sub px-2 py-0.5 text-[11px] text-mute">{LEVELS.find((l) => l.v === r.level)?.l ?? r.level}</span>
                <span className="text-[11px] text-dim">окно {r.windowDays}д</span>
                <span className="text-[11px] text-dim">{summarize(r)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <button type="button" className={`text-[11.5px] ${r.enabled ? 'text-sage' : 'text-mute'}`} disabled={pending} onClick={() => toggle(r.id, !r.enabled)}>
                    {r.enabled ? '● вкл' : '○ выкл'}
                  </button>
                  <button type="button" className={btn} disabled={pending} onClick={() => setDraft({ id: r.id, name: r.name, type: r.type, level: r.level, windowDays: r.windowDays, params: r.params })}>ред.</button>
                  <button type="button" className={btn} disabled={pending} onClick={() => setAssignFor(assignFor === r.id ? null : r.id)}>
                    кабинеты ({r.assignments.length})
                  </button>
                  <button type="button" className="text-[11.5px] text-rust hover:brightness-125" disabled={pending} onClick={() => remove(r.id)}>удалить</button>
                </span>
              </div>
              {r.assignments.length ? (
                <div className="mt-1.5 text-[11px] text-mute">На кабинетах: {r.assignments.map((a) => a.accountName).join(', ')}</div>
              ) : (
                <div className="mt-1.5 text-[11px] text-rust">Не назначено — правило ни на что не действует. Жми «кабинеты».</div>
              )}

              {assignFor === r.id ? (
                <AssignPicker
                  accounts={accounts}
                  selected={new Set(r.assignments.map((a) => a.adAccountId))}
                  pending={pending}
                  onSave={(ids) => start(async () => {
                    const res = await setRuleAccounts(r.id, ids);
                    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'сбой' }); return; }
                    const list = await listAutoRules();
                    if (list.ok) setRules(list.rules ?? []);
                    setAssignFor(null);
                    setMsg({ ok: true, text: 'Назначение сохранено.' });
                  })}
                  onCancel={() => setAssignFor(null)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Журнал */}
      <div className="mt-2">
        <div className="mb-1.5 text-[12px] font-medium text-soft">Журнал действий</div>
        {log.length === 0 ? (
          <p className="text-[11.5px] text-mute">Пока пусто — как только правило что-то сделает, здесь появится запись.</p>
        ) : (
          <div className="flex flex-col gap-1">
            {log.map((l) => (
              <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11.5px]">
                <span className={actionColor(l.action)}>{actionLabel(l.action)}</span>
                <span className="text-soft">{l.accountName}</span>
                <span className="text-mute">· {l.targetName || l.targetType}</span>
                <span className="text-dim">· {l.ruleName}</span>
                {l.reason ? <span className="text-mute">— {l.reason}</span> : null}
                <span className="ml-auto text-dim">{new Date(l.createdAt).toLocaleString('ru-RU')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function summarize(r: RuleRow): string {
  const p = r.params;
  const d = (c?: number) => (c != null ? `$${(c / 100).toFixed(0)}` : '');
  if (r.type === 'roi_pause') return `ROI < ${p.roiMin ?? 0}%, расход ≥ ${d(p.spendMinCents)}${p.reactivate ? ', реактивация' : ''}`;
  if (r.type === 'spend_no_conv_pause') return `расход ≥ ${d(p.spendMinCents)}, 0 конв.${p.reactivate ? ', реактивация' : ''}`;
  if (r.type === 'cpa_pause') return `CPA > ${d(p.cpaMaxCents)}, расход ≥ ${d(p.spendMinCents)}${p.reactivate ? ', реактивация' : ''}`;
  if (r.type === 'roi_scale') return `ROI ≥ ${p.roiMin ?? 0}% → +${p.stepPct ?? 20}%${p.capCents ? `, до ${d(p.capCents)}` : ''}`;
  return '';
}

function actionLabel(a: string): string {
  return { pause: '⏸ пауза', start: '▶ старт', budget_up: '⤴ бюджет', error: '✗ ошибка', skip: 'skip' }[a] ?? a;
}
function actionColor(a: string): string {
  if (a === 'pause') return 'text-amber';
  if (a === 'start') return 'text-sage';
  if (a === 'budget_up') return 'text-sage';
  if (a === 'error') return 'text-rust';
  return 'text-mute';
}

function AssignPicker({
  accounts, selected, pending, onSave, onCancel,
}: {
  accounts: AssignAccount[]; selected: Set<string>; pending: boolean;
  onSave: (ids: string[]) => void; onCancel: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(selected));
  const [q, setQ] = useState('');
  const filtered = accounts.filter((a) =>
    !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.buyer.toLowerCase().includes(q.toLowerCase()));
  const flip = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div className="mt-2 rounded-[12px] border border-line2 bg-sub/40 p-2.5">
      <input className={`${inp} mb-2 w-full`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск кабинета…" />
      <div className="flex max-h-56 flex-col gap-1 overflow-auto">
        {filtered.map((a) => (
          <label key={a.id} className="flex items-center gap-2 rounded-lg px-2 py-1 text-[12px] text-soft hover:bg-sub">
            <input type="checkbox" checked={sel.has(a.id)} onChange={() => flip(a.id)} />
            <span>{a.name}</span>
            {a.agency ? <span className="rounded-full bg-sage-t px-1.5 py-0.5 text-[10px] text-sage">агент</span> : null}
            {a.buyer ? <span className="text-[10.5px] text-dim">· {a.buyer}</span> : null}
          </label>
        ))}
        {filtered.length === 0 ? <span className="px-2 py-1 text-[11.5px] text-mute">Ничего не найдено.</span> : null}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" className={btnPrimary} disabled={pending} onClick={() => onSave([...sel])}>Сохранить ({sel.size})</button>
        <button type="button" className={btn} disabled={pending} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
