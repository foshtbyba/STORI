'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { grossUp, usd } from '@/lib/money';
import { fmtDay, weekdayShort } from '@/lib/period';
import { saveExtraSpend } from '@/app/actions/days';
import { saveAgent, archiveAgent } from '@/app/actions/agents';
import { Panel, PanelHead, Avatar } from './ui';
import AgentSelect from './AgentSelect';
import { IconTag, IconCalendar } from './icons';

export type ExtraBuyer = { id: string; handle: string; initials: string; color: string; owner?: boolean };
export type ExtraAgent = { id: string; name: string; commissionBps: number };
export type ExtraSeed = { buyerId: string; spend: string; note: string; agentId: string };

const toCents = (v: string) => {
  const n = Number.parseFloat(v.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};


/**
 * «31.08, пн» — день, в который уедет цифра. Календарь стоит наверху страницы,
 * у отчёта; отсюда его не видно, а класть расход не в тот день — дорого. Дату
 * поэтому пишем прямо в шапке таблицы, рядом с кнопкой сохранения.
 */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return `${fmtDay(d)}, ${weekdayShort(d)}`;
}

/**
 * Доп. расходы за день — агентские кабинеты.
 *
 * Отдельная таблица, а не колонка в отчёте дня: этот расход не приезжает из
 * Brocard и считается по комиссии АГЕНТА. У разных агентов процент разный,
 * поэтому у каждой строки выбираем агента — его ставка и применяется. Справочник
 * агентов правится тут же, в шапке.
 *
 * Пустые строки не сохраняются, а стёртая сумма удаляет прежнюю запись: иначе
 * ошибочно вбитая агентка осталась бы висеть в профите навсегда.
 */
export default function ExtraSpend({
  date,
  buyers,
  agents,
  seed,
  locked,
}: {
  date: string;
  buyers: ExtraBuyer[];
  agents: ExtraAgent[];
  seed: ExtraSeed[];
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAgents, setShowAgents] = useState(false);

  const byId = new Map(seed.map((s) => [s.buyerId, s]));
  const ownerSet = new Set(buyers.filter((b) => b.owner).map((b) => b.id));
  const bpsByAgent = new Map(agents.map((a) => [a.id, a.commissionBps]));
  const [rows, setRows] = useState<ExtraSeed[]>(() =>
    buyers.map((b) => byId.get(b.id) ?? { buyerId: b.id, spend: '', note: '', agentId: '' }),
  );

  function patch(buyerId: string, field: keyof ExtraSeed, value: string) {
    setRows((prev) => prev.map((r) => (r.buyerId === buyerId ? { ...r, [field]: value } : r)));
    setNote(null);
  }

  const calc = useMemo(
    () =>
      rows.map((r) => {
        const spendNetCents = toCents(r.spend);
        const bps = bpsByAgent.get(r.agentId);
        return {
          ...r,
          spendNetCents,
          // Без выбранного агента ставки нет — гросс не считаем (и строку не
          // дадим сохранить). Это заставляет всегда указывать процент явно.
          spendGrossCents: bps != null ? grossUp(spendNetCents, bps) : 0,
          hasAgent: bps != null,
          touched: spendNetCents > 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, agents],
  );

  // Овнеры считаются отдельным листом, в командное «Итого» их агентка не идёт.
  // Но и молчать про неё нельзя: иначе вбитая овнеру сумма даёт «Итого $0» —
  // выглядит как потерянная цифра. Поэтому считаем обе суммы и вторую
  // показываем отдельной строкой.
  const totals = calc.reduce(
    (acc, r) => {
      const owner = ownerSet.has(r.buyerId);
      return {
        net: acc.net + (owner ? 0 : r.spendNetCents),
        gross: acc.gross + (owner ? 0 : r.spendGrossCents),
        ownerGross: acc.ownerGross + (owner ? r.spendGrossCents : 0),
        filled: acc.filled + (r.touched ? 1 : 0),
      };
    },
    { net: 0, gross: 0, ownerGross: 0, filled: 0 },
  );

  // Сохраняем и пустые строки тоже: так стёртая сумма доедет до сервера и
  // удалит прежнюю запись. Кнопка при этом гаснет, только если сохранять
  // действительно нечего и раньше ничего не было.
  const hadSaved = seed.some((s) => toCents(s.spend) > 0);
  // Строка с суммой, но без агента — сохранять нельзя (процент обязателен).
  const missingAgent = calc.some((r) => r.touched && !r.hasAgent);

  function submit() {
    setError(null);
    setNote(null);
    if (missingAgent) {
      setError('У строки с суммой выбери агента — без него процент не задан.');
      return;
    }
    start(async () => {
      const res = await saveExtraSpend(
        date,
        calc.map((r) => ({
          buyerId: r.buyerId,
          spendNetCents: r.spendNetCents,
          note: r.note.slice(0, 200),
          agentId: r.agentId || null,
        })),
      );
      if (!res.ok) return setError(res.error);
      setNote(`Записано строк: ${res.saved ?? 0}.`);
      router.refresh();
    });
  }

  const cell =
    'n h-10 w-full rounded-lg border border-line bg-sub px-3 text-right text-[13.5px] outline-none transition focus:border-sage';
  const cols = 'grid min-w-[760px] grid-cols-[1.3fr_1fr_0.9fr_0.9fr_1.6fr] items-center gap-2.5';

  return (
    <Panel className="flex flex-col p-4 sm:p-6">
      <PanelHead
        icon={<IconTag color="#d2a06a" />}
        tint="bg-amber-t"
        title="Доп. расходы"
        aside={
          <span className="text-[12.5px] text-mute">
            агентские · процент берётся из агента
          </span>
        }
        right={
          <div className="flex flex-wrap items-center justify-end gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setShowAgents((v) => !v)}
              className="h-11 shrink-0 rounded-full bg-raise px-4 text-[12.5px] text-soft transition hover:text-text"
            >
              {showAgents ? 'Скрыть агентов' : `Агенты · ${agents.length}`}
            </button>
            {/* Тот же день, что и у отчёта наверху: календарь там один на всю
                страницу. Дату дублируем сюда, чтобы её было видно с кнопки. */}
            <span className="flex h-11 shrink-0 items-center gap-2 rounded-full bg-amber-t px-4 text-[12.5px] text-amber">
              <IconCalendar color="#d2a06a" size={14} />
              <span className="n">{dayLabel(date)}</span>
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={pending || locked || (totals.filled === 0 && !hadSaved)}
              className="h-11 shrink-0 rounded-full bg-sage px-6 text-[13px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
            >
              {pending ? 'Сохраняем…' : `Сохранить · ${totals.filled}`}
            </button>
          </div>
        }
      />

      {showAgents ? <AgentManager agents={agents} locked={locked} /> : null}

      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
        Сюда вбиваем то, что не приезжает из Brocard: пополнения агентских кабинетов. Расход ляжет
        на <span className="text-soft">{dayLabel(date)}</span> — тот же день, что и в отчёте выше,
        он выбирается календарём в его шапке. Синхронизация эти строки не трогает: они целиком
        ручные. В профит, ROI и зарплату попадают наравне с обычным расходом, а комиссия — по
        проценту выбранного агента (у разных агентов он разный).
      </p>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:overflow-visible sm:px-0">
        <div className={`${cols} mt-4 pb-2.5`}>
          <span className="lab">Баер</span>
          <span className="lab">Агент</span>
          <span className="lab text-right">Расход</span>
          <span className="lab text-right">С комиссией</span>
          <span className="lab">Комментарий</span>
        </div>

        {calc.map((r) => {
          const buyer = buyers.find((b) => b.id === r.buyerId)!;
          const needAgent = r.touched && !r.hasAgent;
          return (
            <div key={r.buyerId} className={`${cols} border-t border-line py-2.5`}>
              <span className="flex items-center gap-2.5">
                <Avatar initials={buyer.initials} color={buyer.color} size={28} />
                <span className="text-[13.5px] font-semibold">{buyer.handle}</span>
                {buyer.owner ? (
                  <span className="rounded-full bg-sage-t px-2 py-0.5 text-[10px] text-sage">овнер</span>
                ) : null}
              </span>
              <AgentSelect
                value={r.agentId}
                agents={agents}
                onChange={(id) => patch(r.buyerId, 'agentId', id)}
                disabled={locked}
                invalid={needAgent}
                size="md"
              />
              <input
                value={r.spend}
                onChange={(e) => patch(r.buyerId, 'spend', e.target.value)}
                inputMode="decimal"
                placeholder="0"
                disabled={locked}
                className={cell}
              />
              <span className="n text-right text-[13.5px] text-amber">
                {r.touched ? (r.hasAgent ? usd(r.spendGrossCents) : '— агент') : '—'}
              </span>
              <input
                value={r.note}
                onChange={(e) => patch(r.buyerId, 'note', e.target.value)}
                placeholder="какой кабинет"
                disabled={locked}
                className={`${cell} text-left`}
              />
            </div>
          );
        })}

        <div className={`${cols} mt-2.5 rounded-[18px] bg-sub px-4 py-3.5`}>
          <span className="lab text-text">Итого</span>
          <span />
          <span className="n text-right text-[13.5px] text-mid">{usd(totals.net)}</span>
          <span className="n text-right text-[16px] font-semibold text-amber">
            {usd(totals.gross)}
          </span>
          <span className="text-[11.5px] text-mute">
            комиссия {usd(totals.gross - totals.net)}
            {totals.ownerGross ? (
              <span className="ml-2 text-amber">+ у овнеров {usd(totals.ownerGross)}</span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
        <span className="text-[12px] text-mute">
          {locked
            ? 'Неделя закрыта для правок — только чтение.'
            : 'Стёртая сумма удаляет строку. В отчётах она видна источником «Агентка».'}
        </span>
        {note ? <span className="text-[12.5px] text-sage">{note}</span> : null}
        {error ? <span className="text-[12.5px] text-rust">{error}</span> : null}
      </div>
    </Panel>
  );
}

/**
 * Справочник агентов: имя + процент. Заводим новых и правим существующих прямо
 * тут. Процент снапшотится в строку расхода при сохранении, так что правка
 * ставки прошлые дни не трогает.
 */
function AgentManager({ agents, locked }: { agents: ExtraAgent[]; locked: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPct, setNewPct] = useState('');
  const [edit, setEdit] = useState<Record<string, { name: string; pct: string }>>({});

  const pctOf = (bps: number) => (bps / 100).toString();
  const num = (v: string) => Number.parseFloat(v.replace(',', '.'));

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setMsg(res.error ?? 'Ошибка.');
      setMsg(okMsg);
      router.refresh();
    });
  }

  return (
    <div className="mt-3 rounded-[18px] border border-line bg-sub p-3.5">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="lab text-text">Агенты и их процент</span>
        {msg ? <span className="text-[12px] text-sage">{msg}</span> : null}
      </div>

      <div className="flex flex-col gap-2">
        {agents.map((a) => {
          const e = edit[a.id] ?? { name: a.name, pct: pctOf(a.commissionBps) };
          const setE = (patch: Partial<{ name: string; pct: string }>) =>
            setEdit((prev) => ({ ...prev, [a.id]: { ...e, ...patch } }));
          return (
            <div key={a.id} className="flex flex-wrap items-center gap-2">
              <input
                value={e.name}
                onChange={(ev) => setE({ name: ev.target.value })}
                disabled={locked}
                className="h-9 min-w-[140px] flex-1 rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-sage"
              />
              <div className="flex items-center gap-1.5">
                <input
                  value={e.pct}
                  onChange={(ev) => setE({ pct: ev.target.value })}
                  inputMode="decimal"
                  disabled={locked}
                  className="n h-9 w-20 rounded-lg border border-line bg-bg px-3 text-right text-[13px] outline-none focus:border-sage"
                />
                <span className="text-[13px] text-mute">%</span>
              </div>
              <button
                type="button"
                disabled={locked || pending}
                onClick={() => run(() => saveAgent({ id: a.id, name: e.name, pct: num(e.pct) }), 'Сохранено.')}
                className="h-9 rounded-lg bg-sage px-4 text-[12.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
              >
                Сохранить
              </button>
              <button
                type="button"
                disabled={locked || pending}
                onClick={() => run(() => archiveAgent(a.id, true), 'Агент скрыт.')}
                title="Скрыть агента из выбора (прошлые строки не трогаются)"
                className="h-9 rounded-lg bg-raise px-3 text-[12.5px] text-soft transition hover:text-rust disabled:opacity-40"
              >
                Скрыть
              </button>
            </div>
          );
        })}

        {/* Новый агент */}
        <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="новый агент"
            disabled={locked}
            className="h-9 min-w-[140px] flex-1 rounded-lg border border-line bg-bg px-3 text-[13px] outline-none focus:border-sage"
          />
          <div className="flex items-center gap-1.5">
            <input
              value={newPct}
              onChange={(e) => setNewPct(e.target.value)}
              inputMode="decimal"
              placeholder="%"
              disabled={locked}
              className="n h-9 w-20 rounded-lg border border-line bg-bg px-3 text-right text-[13px] outline-none focus:border-sage"
            />
            <span className="text-[13px] text-mute">%</span>
          </div>
          <button
            type="button"
            disabled={locked || pending || !newName.trim() || !newPct.trim()}
            onClick={() =>
              run(async () => {
                const res = await saveAgent({ name: newName, pct: num(newPct) });
                if (res.ok) { setNewName(''); setNewPct(''); }
                return res;
              }, 'Агент добавлен.')
            }
            className="h-9 rounded-lg bg-sage px-4 text-[12.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
          >
            Добавить
          </button>
        </div>
      </div>
    </div>
  );
}
