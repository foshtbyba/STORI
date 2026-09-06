'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createMember } from '@/app/actions/team';

/**
 * Добавить участника прямо из ростера. Овнеру логин не нужен (сидят с
 * админского) — у него только ник и имя. Баеру/тимлиду заводим вход, и после
 * создания один раз показываем сгенерированный пароль.
 */
export default function AddMember() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('BUYER');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creds, setCreds] = useState<{ email: string; password: string } | null>(null);

  const owner = role === 'OWNER';
  const field =
    'n h-9 w-full rounded-lg border border-line bg-sub px-3 text-[13px] text-soft outline-none transition focus:border-sage';

  function reset() {
    setHandle(''); setName(''); setEmail(''); setRole('BUYER'); setError(null);
  }

  function submit() {
    setError(null);
    setCreds(null);
    start(async () => {
      const res = await createMember({ handle, name, email, role });
      if (!res.ok) return setError(res.error);
      if (res.password) setCreds({ email: res.email, password: res.password });
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setCreds(null); }}
        className="mt-3 h-9 rounded-full border border-dashed border-line2 px-4 text-[12.5px] text-mute transition hover:border-sage hover:text-sage"
      >
        + добавить участника
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-[16px] bg-sub p-4">
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="lab mb-1.5 block">Ник</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="напр. SKO" className={field} />
        </label>
        <label className="block">
          <span className="lab mb-1.5 block">Имя</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="необязательно" className={field} />
        </label>
        <label className="block">
          <span className="lab mb-1.5 block">Роль</span>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={field}>
            <option value="BUYER">баер</option>
            <option value="LEAD">тимлид</option>
            <option value="OWNER">овнер</option>
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="h-9 rounded-full bg-sage px-5 text-[12.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
          >
            {pending ? '…' : 'Создать'}
          </button>
          <button
            type="button"
            onClick={() => { setOpen(false); reset(); }}
            className="h-9 rounded-full bg-raise px-4 text-[12.5px] text-mute transition hover:text-soft"
          >
            Отмена
          </button>
        </div>
      </div>

      {/* Почта нужна только тем, кто логинится. Овнеру — нет. */}
      {!owner ? (
        <label className="mt-2.5 block max-w-[320px]">
          <span className="lab mb-1.5 block">Почта для входа</span>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@ms.team" className={field} />
        </label>
      ) : (
        <p className="mt-2.5 text-[11.5px] text-mute">
          Овнеру вход не нужен — он виден только тебе, отдельным листом. Ни почты, ни пароля.
        </p>
      )}

      {error ? <p className="mt-2.5 text-[12px] text-rust">{error}</p> : null}
      {creds ? (
        <div className="mt-3 rounded-[12px] bg-panel p-3">
          <p className="text-[12px] text-sage">Участник создан. Передай доступ лично — пароль показывается один раз:</p>
          <p className="n mt-1.5 text-[13px] text-soft">почта: {creds.email}</p>
          <p className="n text-[13px] text-soft">пароль: <span className="text-text">{creds.password}</span></p>
        </div>
      ) : null}
    </div>
  );
}
