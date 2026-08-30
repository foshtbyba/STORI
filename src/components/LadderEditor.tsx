'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveSalaryRule, saveBuyerLadder } from '@/app/actions/salary';

export type LadderTier = { fromDollars: string; ratePct: string };
export type LadderRule = {
  id: string;
  name: string;
  fixedRub: string;
  tiers: LadderTier[];
};

/**
 * Редактор зарплатной лесенки: оклад и ступени. Лесенка общая — правки видит
 * вся команда сразу. Процент считается со всей суммы, а не только с превышения
 * порога, поэтому здесь только «от какой суммы» и «сколько процентов».
 */
export default function LadderEditor({ rule, buyerId }: { rule: LadderRule; buyerId?: string }) {
  const router = useRouter();
  const [fixedRub, setFixedRub] = useState(rule.fixedRub);
  const [tiers, setTiers] = useState<LadderTier[]>(rule.tiers);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const field =
    'n h-9 w-full rounded-lg border border-line bg-sub px-3 text-[13px] text-soft outline-none transition focus:border-sage';

  function setTier(i: number, patch: Partial<LadderTier>) {
    setSaved(false);
    setTiers((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addTier() {
    setSaved(false);
    setTiers((rows) => [...rows, { fromDollars: '', ratePct: '' }]);
  }
  function removeTier(i: number) {
    setSaved(false);
    setTiers((rows) => rows.filter((_, idx) => idx !== i));
  }

  function save() {
    setError(null);
    setSaved(false);
    const parsedTiers = tiers
      .map((t) => ({
        fromCents: Math.round((Number.parseFloat(t.fromDollars.replace(',', '.')) || 0) * 100),
        ratePct: Math.round(Number.parseFloat(t.ratePct.replace(',', '.')) || 0),
      }))
      .filter((t) => t.fromCents > 0);
    if (parsedTiers.length === 0) return setError('Нужна хотя бы одна ступень.');
    const rub = Math.round(Number.parseFloat(fixedRub.replace(/\s/g, '').replace(',', '.')) || 0);

    start(async () => {
      const res = buyerId
        ? await saveBuyerLadder(buyerId, { fixedRub: rub, tiers: parsedTiers })
        : await saveSalaryRule({ id: rule.id, fixedRub: rub, tiers: parsedTiers });
      if (!res.ok) return setError(res.error);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="mt-4">
      <label className="flex flex-wrap items-center gap-3">
        <span className="lab">Оклад за неделю, ₽</span>
        <input
          value={fixedRub}
          onChange={(e) => { setFixedRub(e.target.value); setSaved(false); }}
          inputMode="numeric"
          className={`${field} max-w-[160px]`}
        />
        <span className="text-[11.5px] text-mute">
          нижняя граница выплаты — платится, если процент по порогу его не перебил.
        </span>
      </label>

      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2 pb-1.5">
        <span className="lab">От суммы, $</span>
        <span className="lab">Ставка, %</span>
        <span className="lab" />
      </div>
      <div className="flex flex-col gap-2">
        {tiers.map((t, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <input
              value={t.fromDollars}
              onChange={(e) => setTier(i, { fromDollars: e.target.value })}
              inputMode="decimal"
              placeholder="напр. 800"
              className={field}
            />
            <input
              value={t.ratePct}
              onChange={(e) => setTier(i, { ratePct: e.target.value })}
              inputMode="decimal"
              placeholder="напр. 30"
              className={field}
            />
            <button
              type="button"
              onClick={() => removeTier(i)}
              className="h-9 w-9 rounded-lg bg-sub text-[15px] text-dim transition hover:text-rust"
              title="Убрать ступень"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={addTier}
          className="h-9 rounded-full border border-dashed border-line2 px-4 text-[12.5px] text-mute transition hover:border-sage hover:text-sage"
        >
          + ступень
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="h-9 rounded-full bg-sage px-6 text-[12.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Сохраняем…' : 'Сохранить лесенку'}
        </button>
        {saved ? <span className="text-[12px] text-sage">сохранено</span> : null}
        {error ? <span className="text-[12px] text-rust">{error}</span> : null}
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
        Ставка применяется ко всей сумме, а не только к превышению порога. Пороги
        сортируются сами; действует самый высокий из взятых.
      </p>
    </div>
  );
}
