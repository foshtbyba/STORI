'use client';

import { useState, useTransition } from 'react';

import {
  listAutoRules, loadAutoRuleLog, saveAutoRule, toggleAutoRule, deleteAutoRule, setRuleAccounts, runAutoRulesNow,
  type RuleRow, type AssignAccount, type LogRow, type RuleInput,
} from '@/app/actions/autorules';
import type { Condition, ActionParams } from '@/lib/autorules';

type Opt = { key: string; label: string; unit?: string };

const LEVELS = [{ key: 'campaign', label: 'Кампании' }, { key: 'adset', label: 'Адсеты' }, { key: 'ad', label: 'Объявления' }];
const STATUSES = [{ key: 'active', label: 'Активные' }, { key: 'paused', label: 'Остановленные' }, { key: 'any', label: 'Любые' }];

const inp = 'rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-[12.5px] text-soft';
const btn = 'rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage disabled:opacity-50';
const btnP = 'rounded-full border border-sage bg-sage-t px-3.5 py-1.5 text-[12px] text-sage transition hover:brightness-110 disabled:opacity-50';
const lbl = 'flex flex-col gap-1 text-[11px] text-mute';

type Draft = RuleInput;

const dollars = (c?: number) => (c != null ? (c / 100).toString() : '');
const toCents = (v: string) => Math.round((parseFloat(v.replace(',', '.')) || 0) * 100);
const num = (v: string) => parseFloat(v.replace(',', '.')) || 0;

function emptyDraft(): Draft {
  return {
    name: '', level: 'adset', statusFilter: 'active', action: 'pause',
    actionParams: { mode: 'pct', value: 10, cooldownMin: 1440 },
    frequency: 'halfhour', hourAt: 0, windowKind: 'today',
    conditions: [{ metric: 'spend', op: '>', value: 10 }], conditionsEnabled: true, groupName: '',
  };
}

export default function AutoRules({
  initialRules, accounts, initialLog, metrics, actions, frequencies, windows,
}: {
  initialRules: RuleRow[]; accounts: AssignAccount[]; initialLog: LogRow[];
  metrics: Opt[]; actions: Opt[]; frequencies: Opt[]; windows: Opt[];
}) {
  const [rules, setRules] = useState<RuleRow[]>(initialRules);
  const [log, setLog] = useState<LogRow[]>(initialLog);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [assignFor, setAssignFor] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const metricLabel = (k: string) => metrics.find((m) => m.key === k)?.label ?? k;
  const actionLabelOf = (k: string) => actions.find((a) => a.key === k)?.label ?? k;
  const setD = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setAP = (patch: Partial<ActionParams>) => setDraft((d) => (d ? { ...d, actionParams: { ...d.actionParams, ...patch } } : d));

  const reloadRules = async () => { const r = await listAutoRules(); if (r.ok) setRules(r.rules ?? []); };
  const reloadLog = async () => { const l = await loadAutoRuleLog(); if (l.ok) setLog(l.rows ?? []); };

  const save = () => { if (!draft) return; start(async () => {
    const r = await saveAutoRule(draft);
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); return; }
    setDraft(null); setMsg({ ok: true, text: 'Правило сохранено.' }); await reloadRules();
  }); };

  const toggle = (id: string, enabled: boolean) => start(async () => { await toggleAutoRule(id, enabled); setRules((rs) => rs.map((r) => (r.id === id ? { ...r, enabled } : r))); });
  const remove = (id: string) => start(async () => { await deleteAutoRule(id); setRules((rs) => rs.filter((r) => r.id !== id)); });
  const runNow = () => start(async () => {
    const r = await runAutoRulesNow();
    if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); return; }
    setMsg({ ok: true, text: `Прогон: правил ${r.rules}, отработало ${r.ran}, действий ${r.actions}${r.errors ? `, ошибок ${r.errors}` : ''}.` });
    await reloadLog();
  });

  const editFrom = (r: RuleRow) => setDraft({
    id: r.id, name: r.name, level: r.level, statusFilter: r.statusFilter, action: r.action,
    actionParams: r.actionParams ?? {}, frequency: r.frequency, hourAt: r.hourAt, windowKind: r.windowKind,
    conditions: r.conditions ?? [], conditionsEnabled: r.conditionsEnabled, groupName: r.groupName,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnP} disabled={pending} onClick={() => setDraft(emptyDraft())}>+ Создать правило</button>
        <button type="button" className={btn} disabled={pending} onClick={runNow}>▶ Прогнать сейчас</button>
        <button type="button" className={btn} disabled={pending} onClick={() => start(async () => { await reloadRules(); await reloadLog(); })}>↻ Обновить</button>
        {msg ? <span className={`text-[12px] ${msg.ok ? 'text-sage' : 'text-rust'}`}>{msg.text}</span> : null}
      </div>

      {/* Конструктор */}
      {draft ? (
        <div className="rounded-[14px] border border-line2 bg-sub/40 p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <label className={lbl}>Название правила
              <input className={inp} value={draft.name} onChange={(e) => setD({ name: e.target.value })} placeholder="напр. Стоп пустышек LT" />
            </label>
            <label className={lbl}>Частота
              <select className={inp} value={draft.frequency} onChange={(e) => setD({ frequency: e.target.value })}>
                {frequencies.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
            {draft.frequency === 'hour_at' ? (
              <label className={lbl}>Час (МСК)
                <input className={inp} inputMode="numeric" value={String(draft.hourAt ?? 0)} onChange={(e) => setD({ hourAt: Math.min(23, Math.max(0, Math.round(num(e.target.value)))) })} placeholder="0..23" />
              </label>
            ) : null}
            <label className={lbl}>Период статы
              <select className={inp} value={draft.windowKind} onChange={(e) => setD({ windowKind: e.target.value })}>
                {windows.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
              </select>
            </label>
            <label className={lbl}>С чем работать
              <select className={inp} value={draft.level} onChange={(e) => setD({ level: e.target.value })}>
                {LEVELS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
              </select>
            </label>
            <label className={lbl}>Какие статусы брать
              <select className={inp} value={draft.statusFilter} onChange={(e) => setD({ statusFilter: e.target.value })}>
                {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
            <label className={lbl}>Что делать
              <select className={inp} value={draft.action} onChange={(e) => setD({ action: e.target.value })}>
                {actions.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
              </select>
            </label>
            <label className={lbl}>Группа
              <input className={inp} value={draft.groupName} onChange={(e) => setD({ groupName: e.target.value })} placeholder="без группы" />
            </label>
          </div>

          {/* Параметры действия — бюджет */}
          {draft.action === 'budget_daily' ? (
            <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <label className={lbl}>Как менять
                <select className={inp} value={draft.actionParams.mode ?? 'pct'} onChange={(e) => setAP({ mode: e.target.value as 'pct' | 'set' })}>
                  <option value="pct">На процент (±%)</option>
                  <option value="set">Задать сумму ($)</option>
                </select>
              </label>
              <label className={lbl}>{draft.actionParams.mode === 'set' ? 'Сумма, $' : 'Процент, % (можно −)'}
                {draft.actionParams.mode === 'set' ? (
                  <input className={inp} inputMode="decimal" value={dollars(draft.actionParams.value)} onChange={(e) => setAP({ value: toCents(e.target.value) })} placeholder="30.00" />
                ) : (
                  <input className={inp} inputMode="decimal" value={draft.actionParams.value != null ? String(draft.actionParams.value) : ''} onChange={(e) => setAP({ value: num(e.target.value) })} placeholder="10" />
                )}
              </label>
              <label className={lbl}>Потолок бюджета, $
                <input className={inp} inputMode="decimal" value={dollars(draft.actionParams.capCents)} onChange={(e) => setAP({ capCents: toCents(e.target.value) })} placeholder="50.00" />
              </label>
              <label className={lbl}>Не чаще, мин
                <input className={inp} inputMode="numeric" value={draft.actionParams.cooldownMin != null ? String(draft.actionParams.cooldownMin) : ''} onChange={(e) => setAP({ cooldownMin: Math.round(num(e.target.value)) })} placeholder="1440" />
              </label>
            </div>
          ) : null}

          {/* Условия */}
          <div className="mt-3 flex items-center gap-2">
            <label className="flex items-center gap-2 text-[12px] text-soft">
              <input type="checkbox" checked={!draft.conditionsEnabled} onChange={(e) => setD({ conditionsEnabled: !e.target.checked })} />
              Без условий (только по времени)
            </label>
          </div>
          {draft.conditionsEnabled ? (
            <div className="mt-2 flex flex-col gap-2">
              {draft.conditions.map((c, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-dim">Условие {i + 1}</span>
                  <select className={inp} value={c.metric} onChange={(e) => setD({ conditions: draft.conditions.map((x, j) => (j === i ? { ...x, metric: e.target.value } : x)) })}>
                    {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}{m.unit ? ` (${m.unit})` : ''}</option>)}
                  </select>
                  <select className={`${inp} w-16`} value={c.op} onChange={(e) => setD({ conditions: draft.conditions.map((x, j) => (j === i ? { ...x, op: e.target.value as Condition['op'] } : x)) })}>
                    <option value=">">&gt;</option><option value="<">&lt;</option><option value="=">=</option>
                  </select>
                  <input className={`${inp} w-28`} inputMode="decimal" value={String(c.value)} onChange={(e) => setD({ conditions: draft.conditions.map((x, j) => (j === i ? { ...x, value: num(e.target.value) } : x)) })} placeholder="число" />
                  <button type="button" className="text-[12px] text-rust" onClick={() => setD({ conditions: draft.conditions.filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <button type="button" className={`${btn} w-max`} onClick={() => setD({ conditions: [...draft.conditions, { metric: 'spend', op: '>', value: 0 }] })}>+ условие</button>
            </div>
          ) : (
            <p className="mt-1.5 text-[11px] text-mute">Правило сработает по времени (частота), без проверки метрик — как чистое расписание (напр. включить/выключить в час X).</p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button type="button" className={btnP} disabled={pending} onClick={save}>Сохранить</button>
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
                {r.groupName ? <span className="rounded-full bg-amber-t px-2 py-0.5 text-[10.5px] text-amber">{r.groupName}</span> : null}
                <span className="text-[13px] font-medium text-soft">{r.name}</span>
                <span className="rounded-full bg-sub px-2 py-0.5 text-[11px] text-mute">{LEVELS.find((l) => l.key === r.level)?.label} · {STATUSES.find((s) => s.key === r.statusFilter)?.label}</span>
                <span className="rounded-full bg-sub px-2 py-0.5 text-[11px] text-mute">{actionLabelOf(r.action)}</span>
                <span className="text-[11px] text-dim">{summarize(r, metricLabel)}</span>
                <span className="ml-auto flex items-center gap-2">
                  <button type="button" className={`text-[11.5px] ${r.enabled ? 'text-sage' : 'text-mute'}`} disabled={pending} onClick={() => toggle(r.id, !r.enabled)}>{r.enabled ? '● вкл' : '○ выкл'}</button>
                  <button type="button" className={btn} disabled={pending} onClick={() => editFrom(r)}>ред.</button>
                  <button type="button" className={btn} disabled={pending} onClick={() => setAssignFor(assignFor === r.id ? null : r.id)}>кабинеты ({r.assignments.length})</button>
                  <button type="button" className="text-[11.5px] text-rust hover:brightness-125" disabled={pending} onClick={() => remove(r.id)}>удалить</button>
                </span>
              </div>
              {r.assignments.length ? (
                <div className="mt-1.5 text-[11px] text-mute">На кабинетах: {r.assignments.map((a) => a.accountName).join(', ')}</div>
              ) : (
                <div className="mt-1.5 text-[11px] text-rust">Не назначено — жми «кабинеты».</div>
              )}
              {assignFor === r.id ? (
                <AssignPicker accounts={accounts} selected={new Set(r.assignments.map((a) => a.adAccountId))} pending={pending}
                  onSave={(ids) => start(async () => {
                    const res = await setRuleAccounts(r.id, ids);
                    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'сбой' }); return; }
                    await reloadRules(); setAssignFor(null); setMsg({ ok: true, text: 'Назначение сохранено.' });
                  })}
                  onCancel={() => setAssignFor(null)} />
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Журнал */}
      <div className="mt-2">
        <div className="mb-1.5 text-[12px] font-medium text-soft">Журнал действий</div>
        {log.length === 0 ? (
          <p className="text-[11.5px] text-mute">Пусто — как только правило что-то сделает, здесь появится запись.</p>
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

function summarize(r: RuleRow, metricLabel: (k: string) => string): string {
  const freq = { halfhour: 'кажд. 30м', hour: 'кажд. час', midnight: 'в полночь', hour_at: `в ${r.hourAt ?? 0}:00` }[r.frequency] ?? r.frequency;
  if (!r.conditionsEnabled || !r.conditions.length) return `${freq} · без условий`;
  const conds = r.conditions.map((c) => `${metricLabel(c.metric)} ${c.op} ${c.value}`).join(' И ');
  return `${freq} · ${conds}`;
}

function actionLabel(a: string): string { return { pause: '⏸ пауза', start: '▶ старт', budget_up: '⤴ бюджет', error: '✗ ошибка' }[a] ?? a; }
function actionColor(a: string): string { return a === 'error' ? 'text-rust' : a === 'pause' ? 'text-amber' : 'text-sage'; }

function AssignPicker({ accounts, selected, pending, onSave, onCancel }: {
  accounts: AssignAccount[]; selected: Set<string>; pending: boolean; onSave: (ids: string[]) => void; onCancel: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(selected));
  const [q, setQ] = useState('');
  const filtered = accounts.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()) || a.buyer.toLowerCase().includes(q.toLowerCase()));
  const flip = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
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
        <button type="button" className={btnP} disabled={pending} onClick={() => onSave([...sel])}>Сохранить ({sel.size})</button>
        <button type="button" className={btn} disabled={pending} onClick={onCancel}>Отмена</button>
      </div>
    </div>
  );
}
