'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  addToken,
  saveTracker,
  saveBrocard,
  runSync,
  type ActionState,
} from '@/app/actions/integrations';
import SubmitButton from './SubmitButton';

/**
 * Формы настройки интеграций.
 *
 * Ключ проверяется на сервере в момент сохранения, и ответ показывается прямо
 * тут: «принято, кабинетов найдено 7» или «Facebook отказал, код 190». Без
 * этого настройка превращается в гадание — вставил ключ, ушёл, а цифр нет, и
 * непонятно, в ключе дело или в кабинете.
 */

const field =
  'h-10 w-full rounded-xl border border-line2 bg-sub px-3.5 text-[13px] text-text outline-none transition focus:border-sage';

function Answer({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <div
      className="mt-2.5 rounded-xl px-3.5 py-2.5 text-[12px] leading-relaxed"
      style={{
        background: state.ok ? '#252e1e' : '#2c1f1a',
        color: state.ok ? '#b4c68c' : '#ce6e58',
      }}
    >
      {state.ok ? state.message : state.error}
    </div>
  );
}

export function TokenForm({ buyers }: { buyers: { id: string; handle: string }[] }) {
  const [state, action] = useActionState(addToken, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr]">
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">Баер</span>
          <select name="buyerId" className={field} required>
            {buyers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.handle}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">Подпись</span>
          <input name="label" placeholder="BM основной" className={field} />
        </label>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] text-mute">
          Токен или мультитокен
        </span>
        <textarea
          name="token"
          placeholder="EAAB… или мультитокен eyJ…"
          rows={2}
          className={`${field} n h-auto resize-y py-2.5`}
          required
        />
        <span className="mt-1 block text-[11px] text-dim">
          Подойдёт и плоский токен, и мультитокен из антидетекта — из него сам достанется ключ.
        </span>
      </label>
      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Проверяю токен…"
          className="rounded-full bg-sage px-6 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90"
        >
          Проверить и добавить
        </SubmitButton>
      </div>
      <Answer state={state} />
    </form>
  );
}

export function TrackerForm({ baseUrl, hasKey }: { baseUrl: string; hasKey: boolean }) {
  const [state, action] = useActionState(saveTracker, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2.5">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1.4fr_1fr]">
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">Адрес трекера</span>
          <input
            name="baseUrl"
            defaultValue={baseUrl}
            placeholder="https://track.example.com"
            className={field}
            required
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">
            Api-Key {hasKey ? '· уже сохранён, впиши заново чтобы сменить' : ''}
          </span>
          <input name="apiKey" placeholder="ключ из настроек Keitaro" className={`${field} n`} required />
        </label>
      </div>
      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Проверяю связь…"
          className="rounded-full bg-sage px-6 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90"
        >
          Проверить и сохранить
        </SubmitButton>
      </div>
      <Answer state={state} />
    </form>
  );
}

export function BrocardForm({ hasKey }: { hasKey: boolean }) {
  const [state, action] = useActionState(saveBrocard, null);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2.5">
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] text-mute">
          API-ключ Brocard {hasKey ? '· уже сохранён, впиши заново чтобы сменить' : ''}
        </span>
        <input name="apiKey" placeholder="ключ из раздела «Автоматизация» → API" className={`${field} n`} required />
      </label>
      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Проверяю ключ…"
          className="rounded-full bg-sage px-6 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90"
        >
          Проверить и сохранить
        </SubmitButton>
      </div>
      <Answer state={state} />
    </form>
  );
}

/**
 * Ручной запуск. Крон ходит сам, но после настройки хочется увидеть результат
 * сразу, а не через час.
 */
export function SyncNow() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof runSync>> | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setResult(await runSync()))}
        className={`rounded-full border border-line2 bg-sub px-5 py-2 text-[12.5px] text-soft transition hover:border-sage hover:text-sage ${
          pending ? 'cursor-progress opacity-60' : ''
        }`}
      >
        {pending ? 'Тяну цифры…' : 'Синхронизировать сейчас'}
      </button>

      {result ? (
        <div className="mt-3 text-[12px] leading-relaxed">
          <div className="text-soft">
            Обновлено дней: <span className="n text-text">{result.touched}</span>
            {result.skipped ? (
              <>
                {' · '}не тронуто (правили руками):{' '}
                <span className="n text-text">{result.skipped}</span>
              </>
            ) : null}
          </div>
          {result.orphanCents > 0 ? (
            <div className="mt-1 text-rust">
              Доход без баера: ${Math.round(result.orphanCents / 100).toLocaleString('ru-RU')} —
              привяжи группы ниже.
            </div>
          ) : null}
          {result.problems.map((p) => (
            <div key={p} className="mt-1 text-rust">
              {p}
            </div>
          ))}
          {!result.problems.length && !result.orphanCents ? (
            <div className="mt-1 text-sage">Всё прошло чисто.</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
