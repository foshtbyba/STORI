'use client';

import { useState } from 'react';
import LadderEditor, { type LadderRule } from './LadderEditor';
import { Avatar } from './ui';

export type BuyerLadderRow = {
  buyerId: string;
  handle: string;
  initials: string;
  color: string;
  /** Своя лесенка (не общая). */
  custom: boolean;
  rule: LadderRule;
};

/**
 * Лесенка под одного баера, свёрнутая по умолчанию: строка с ником и краткой
 * сводкой (оклад, верхняя ставка), по клику раскрывается полный редактор.
 * Сохранение форкает баера на свою лесенку, не трогая остальных.
 */
export default function BuyerLadder({ row }: { row: BuyerLadderRow }) {
  const [open, setOpen] = useState(false);
  const top = row.rule.tiers.reduce((m, t) => Math.max(m, Number(t.ratePct) || 0), 0);

  return (
    <div className="border-t border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 py-3 text-left"
      >
        <Avatar initials={row.initials} color={row.color} size={30} />
        <span className="flex-1 text-[14px] font-semibold">
          {row.handle}
          {row.custom ? (
            <span className="ml-2 rounded-full bg-sage-t px-2 py-0.5 text-[10px] text-sage">своя лесенка</span>
          ) : (
            <span className="ml-2 rounded-full bg-sub px-2 py-0.5 text-[10px] text-mute">общая</span>
          )}
        </span>
        <span className="n text-[12px] text-mute">
          оклад {row.rule.fixedRub} ₽ · до {top}%
        </span>
        <span className="ml-2 text-[12px] text-dim">{open ? '−' : 'править'}</span>
      </button>
      {open ? (
        <div className="pb-3">
          <LadderEditor rule={row.rule} buyerId={row.buyerId} />
        </div>
      ) : null}
    </div>
  );
}
