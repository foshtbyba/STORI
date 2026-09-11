'use client';

import { useActionState, useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  addToken,
  addMyToken,
  saveTracker,
  saveBrocard,
  runSync,
  fullSyncStatus,
  type AdsSyncStatus,
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
  // Токен и куки — два входа в один и тот же кабинет, а не два поля подряд:
  // показываем ровно один. Невыбранное поле не просто спрятано, а не
  // отрисовано — иначе в отправку уехало бы и оно.
  const [mode, setMode] = useState<'token' | 'cookies'>('token');
  // HTTP или SOCKS на глаз не отличить: в списках провайдеров схемы нет, а порт
  // бывает один и тот же. Угадывать нельзя — на «не том» агенте запрос не
  // падает, а молча висит до таймаута; поэтому спрашиваем прямо.
  const [proxyKind, setProxyKind] = useState<'http' | 'socks5'>('http');

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
          <span className="mb-1.5 block text-[11.5px] text-mute">Подпись · можно оставить пустой</span>
          <input name="label" placeholder="подставится имя профиля" className={field} />
        </label>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11.5px] text-mute">Чем подключаем</span>
        <div className="flex items-center gap-1 rounded-full bg-sub p-1">
          {([
            ['token', 'Токен'],
            ['cookies', 'Cookies'],
          ] as const).map(([value, title]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`rounded-full px-3.5 py-1.5 text-[12px] transition ${
                mode === value ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
              }`}
            >
              {title}
            </button>
          ))}
        </div>
      </div>

      {mode === 'token' ? (
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">Токен или мультитокен</span>
          <textarea
            name="token"
            placeholder="EAAB… или мультитокен eyJ…"
            rows={2}
            className={`${field} n h-auto resize-y py-2.5`}
            required
          />
          <span className="mt-1 block text-[11px] text-dim">
            Мультитокен из антидетекта целиком — из него достанутся и ключ, и куки, и user-agent.
            Сессионный ключ Facebook принимает только с ними и прокси аккаунта, поэтому заполни
            прокси ниже. Плоский System-User токен тоже подойдёт — тому прокси не нужен.
          </span>
        </label>
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-[11.5px] text-mute">Куки или мультитокен целиком</span>
          <textarea
            name="cookiesJson"
            placeholder={'[{"name": "c_user", "value": "…"}, …]'}
            rows={4}
            className={`${field} n h-auto resize-y py-2.5 text-[11.5px] leading-relaxed`}
            required
          />
          <span className="mt-1 block text-[11px] text-dim">
            Подойдёт и список кук в JSON, и мультитокен целиком — куки и user-agent достанутся из
            него сами. Ключ добудем, открыв ими Ads Manager. Почти всегда нужен прокси того же
            аккаунта, иначе Facebook покажет вход, а не кабинет.
          </span>
        </label>
      )}

      <div className="block">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11.5px] text-mute">
            Прокси{mode === 'token' ? ' · необязательно' : ''}
          </span>
          <div className="flex items-center gap-1 rounded-full bg-sub p-1">
            {([
              ['http', 'HTTP'],
              ['socks5', 'SOCKS5'],
            ] as const).map(([value, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => setProxyKind(value)}
                aria-pressed={proxyKind === value}
                className={`rounded-full px-3 py-1 text-[11.5px] transition ${
                  proxyKind === value ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
                }`}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="proxyKind" value={proxyKind} />
        <input
          name="proxyUrl"
          placeholder="1.2.3.4:8000:логин:пароль"
          className={`${field} n`}
        />
        <span className="mt-1 block text-[11px] text-dim">
          Вставляй как дал провайдер — строка разбирается сама:{' '}
          <span className="n text-mute">адрес:порт:логин:пароль</span>,{' '}
          <span className="n text-mute">логин:пароль@адрес:порт</span>, тот же список в обратном
          порядке или готовый URL со схемой. Тип уточни у провайдера: на неверном запрос не
          ошибается, а молча висит. Через прокси пойдут все запросы к Facebook — и проверка сейчас,
          и синхронизация потом.
        </span>
      </div>

      <div className="flex justify-end">
        <SubmitButton
          pendingLabel={mode === 'cookies' ? 'Достаю ключ из кук…' : 'Проверяю токен…'}
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

/** Баер привязывает свой кабинет сам — без выбора баера. */
export function MyTokenForm() {
  const [state, action] = useActionState(addMyToken, null);
  const [proxyKind, setProxyKind] = useState<'http' | 'socks5'>('http');
  return (
    <form action={action} className="mt-4 flex flex-col gap-2.5">
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] text-mute">Подпись (необязательно)</span>
        <input name="label" placeholder="BM основной" className={field} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] text-mute">Токен или мультитокен</span>
        <textarea
          name="token"
          placeholder="EAAB… или мультитокен eyJ…"
          rows={2}
          className={`${field} n h-auto resize-y py-2.5`}
          required
        />
        <span className="mt-1 block text-[11px] text-dim">
          Мультитокен из антидетекта целиком — из него достанутся ключ, куки и user-agent.
          Плоский токен тоже подойдёт.
        </span>
      </label>

      <div className="block">
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11.5px] text-mute">Прокси · необязательно</span>
          <div className="flex items-center gap-1 rounded-full bg-sub p-1">
            {([
              ['http', 'HTTP'],
              ['socks5', 'SOCKS5'],
            ] as const).map(([value, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => setProxyKind(value)}
                aria-pressed={proxyKind === value}
                className={`rounded-full px-3 py-1 text-[11.5px] transition ${
                  proxyKind === value ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
                }`}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
        <input type="hidden" name="proxyKind" value={proxyKind} />
        <input name="proxyUrl" placeholder="1.2.3.4:8000:логин:пароль" className={`${field} n`} />
        <span className="mt-1 block text-[11px] text-dim">
          Прокси того же аккаунта. Сессионный токен из антидетекта Facebook принимает только через
          него — тип уточни у провайдера.
        </span>
      </div>

      <div className="flex justify-end">
        <SubmitButton
          pendingLabel="Проверяю токен…"
          className="rounded-full bg-sage px-6 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90"
        >
          Подключить кабинет
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
 * сразу, а не через час. Заход тяжёлый (Brocard + Keitaro + все кабинеты ФБ,
 * минуты), поэтому НЕ держим http-запрос — иначе браузер рвёт соединение по
 * таймауту и страница падает с «ошибкой отрисовки». Запускаем в фоне и
 * опрашиваем статус; по завершении обновляем страницу.
 */
export function SyncNow() {
  const router = useRouter();
  const [status, setStatus] = useState<AdsSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasRunning = useRef(false);

  const poll = useCallback(async () => {
    try {
      const s = await fullSyncStatus();
      setStatus(s);
      if (s.running) {
        wasRunning.current = true;
        setBusy(true);
        timer.current = setTimeout(poll, 4000);
      } else {
        setBusy(false);
        if (wasRunning.current) {
          wasRunning.current = false;
          router.refresh();
        }
      }
    } catch {
      timer.current = setTimeout(poll, 5000);
    }
  }, [router]);

  useEffect(() => {
    poll();
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    wasRunning.current = true;
    try {
      await runSync();
    } catch {
      /* запуск лёгкий; если не долетел — статус ниже покажет, что не идёт */
    }
    if (timer.current) clearTimeout(timer.current);
    poll();
  };

  const finished = status && !status.running && status.finishedAt;

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className={`rounded-full border border-line2 bg-sub px-5 py-2 text-[12.5px] text-soft transition hover:border-sage hover:text-sage ${
          busy ? 'cursor-progress opacity-60' : ''
        }`}
      >
        {busy ? 'Тяну цифры…' : 'Синхронизировать сейчас'}
      </button>

      {!busy && finished ? (
        <div className="mt-3 text-[12px] leading-relaxed">
          <div className="text-soft">
            Обновлено дней: <span className="n text-text">{status!.touched}</span>
            {status!.skipped ? (
              <>
                {' · '}не тронуто (правили руками):{' '}
                <span className="n text-text">{status!.skipped}</span>
              </>
            ) : null}
          </div>
          {status!.problems.map((p) => (
            <div key={p} className="mt-1 text-rust">
              {p}
            </div>
          ))}
          {!status!.problems.length ? (
            <div className="mt-1 text-sage">Всё прошло чисто.</div>
          ) : null}
        </div>
      ) : busy ? (
        <div className="mt-3 text-[12px] text-mute">Идёт в фоне — можно уйти со страницы, догрузится сам.</div>
      ) : null}
    </div>
  );
}
