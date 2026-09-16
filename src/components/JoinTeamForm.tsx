'use client';

import { useActionState } from 'react';
import { submitTeamLead, type LeadState } from '@/app/actions/leads';

/** Форма «хочу в команду»: гость оставляет свой Telegram, заявка уходит админам. */
export default function JoinTeamForm() {
  const [state, action, pending] = useActionState<LeadState, FormData>(submitTeamLead, null);

  if (state?.ok) {
    return (
      <div className="mt-4 rounded-[14px] border border-sage/40 bg-sage-t px-4 py-3 text-[13.5px] text-sage">
        Заявка отправлена — мы напишем тебе в Telegram. Спасибо!
      </div>
    );
  }

  return (
    <form action={action} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="flex-1">
        <input
          name="telegram"
          placeholder="Твой Telegram (например, @username)"
          className="h-11 w-full rounded-xl border border-line2 bg-sub px-4 text-[14px] text-soft placeholder:text-dim"
        />
        {state && !state.ok ? <div className="mt-1.5 text-[12px] text-rust">{state.error}</div> : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        className={`h-11 shrink-0 rounded-xl border border-sage bg-sage-t px-6 text-[13.5px] font-semibold text-sage transition hover:brightness-110 ${pending ? 'opacity-50' : ''}`}
      >
        {pending ? 'Отправляю…' : 'Оставить заявку'}
      </button>
    </form>
  );
}
