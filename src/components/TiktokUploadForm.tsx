'use client';

import { useActionState, useState } from 'react';
import { launchTiktokUpload, fetchTiktokIdentities, type TiktokState } from '@/app/actions/tiktok';
import type { TiktokAccountLite } from './TiktokCampaigns';
import type { TiktokIdentity } from '@/lib/tiktok';

const OBJECTIVES = [
  { v: 'TRAFFIC', l: 'Трафик (на сайт)' },
  { v: 'CONVERSIONS', l: 'Конверсии' },
  { v: 'VIDEO_VIEWS', l: 'Просмотры видео' },
  { v: 'REACH', l: 'Охват' },
];
const AGES = ['AGE_13_17', 'AGE_18_24', 'AGE_25_34', 'AGE_35_44', 'AGE_45_54', 'AGE_55_100'];
const AGE_LABEL: Record<string, string> = {
  AGE_13_17: '13–17', AGE_18_24: '18–24', AGE_25_34: '25–34',
  AGE_35_44: '35–44', AGE_45_54: '45–54', AGE_55_100: '55+',
};
const CTAS = [
  'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'DOWNLOAD', 'CONTACT_US',
  'APPLY_NOW', 'BOOK_NOW', 'ORDER_NOW', 'SUBSCRIBE',
];

const field = 'rounded-[10px] border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft placeholder:text-dim';
const lbl = 'flex flex-col gap-1 text-[11.5px] text-mute';

/**
 * Автозалив TikTok: кампания → группа → ролик → объявление одним нажатием.
 * Форма собирает все поля и валидируется на сервере. До боевого токена сабмит
 * вернёт понятную заметку, что заработает после одобрения API, — раскладка и
 * логика уже готовы, останется «накатить только апи».
 */
export default function TiktokUploadForm({ accounts }: { accounts: TiktokAccountLite[] }) {
  const live = accounts.filter((a) => !a.dead);
  const [state, action, pending] = useActionState<TiktokState, FormData>(launchTiktokUpload, null);
  const [accountId, setAccountId] = useState(live[0]?.id ?? accounts[0]?.id ?? '');
  const [identities, setIdentities] = useState<TiktokIdentity[]>([]);
  const [idLoading, setIdLoading] = useState(false);
  const [idErr, setIdErr] = useState('');

  const loadIdentities = async () => {
    if (!accountId) return;
    setIdLoading(true); setIdErr('');
    const r = await fetchTiktokIdentities(accountId);
    setIdLoading(false);
    if (r.ok) { setIdentities(r.list); if (r.list.length === 0) setIdErr('Identity не найдены — заполни id вручную'); }
    else setIdErr(r.error);
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      {/* Кабинет + название кампании */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}>
          Кабинет
          <select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={field}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name || a.advertiserId}{a.dead ? ' — недоступен' : ''}</option>
            ))}
          </select>
        </label>
        <label className={lbl}>
          Название кампании
          <input name="campaignName" required placeholder="напр. UZ · клип 1" className={field} />
        </label>
      </div>

      {/* Цель + бюджет */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className={lbl}>
          Цель
          <select name="objective" defaultValue="TRAFFIC" className={field}>
            {OBJECTIVES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </label>
        <label className={lbl}>
          Тип бюджета
          <select name="budgetMode" defaultValue="BUDGET_MODE_DAY" className={field}>
            <option value="BUDGET_MODE_DAY">Дневной</option>
            <option value="BUDGET_MODE_TOTAL">На весь срок</option>
          </select>
        </label>
        <label className={lbl}>
          Бюджет (в валюте кабинета)
          <input name="budget" type="number" min="1" step="1" required placeholder="50" className={field} />
        </label>
      </div>

      {/* Таргет */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}>
          Гео — location id через запятую
          <input name="locationIds" required placeholder="напр. 6252001" className={field} />
          <span className="text-[10.5px] text-dim">Числовые id локаций TikTok (страна/регион). Список — из справочника TikTok.</span>
        </label>
        <label className={lbl}>
          Пол
          <select name="gender" defaultValue="GENDER_UNLIMITED" className={field}>
            <option value="GENDER_UNLIMITED">Любой</option>
            <option value="GENDER_MALE">Мужской</option>
            <option value="GENDER_FEMALE">Женский</option>
          </select>
        </label>
      </div>

      <div className={lbl}>
        Возраст
        <div className="flex flex-wrap gap-2">
          {AGES.map((a) => (
            <label key={a} className="flex cursor-pointer items-center gap-1.5 rounded-full bg-sub px-3 py-1.5 text-[11.5px] text-soft">
              <input type="checkbox" name="ageGroups" value={a} className="accent-sage" />
              {AGE_LABEL[a]}
            </label>
          ))}
        </div>
      </div>

      {/* Identity */}
      <div className="rounded-[12px] border border-line2 bg-sub/50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-soft">Identity — от чьего имени показывать</div>
          <button type="button" onClick={loadIdentities} disabled={idLoading || !accountId} className="rounded-full bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:text-text disabled:opacity-50">
            {idLoading ? 'Загружаю…' : 'Подтянуть identity'}
          </button>
        </div>
        {idErr ? <div className="mt-2 text-[11px] text-amber">{idErr}</div> : null}
        {identities.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {identities.map((i) => (
              <span key={i.identityId} className="rounded-full bg-teal-t px-2.5 py-1 text-[10.5px] text-teal" title={i.identityId}>
                {i.displayName || i.identityId}
              </span>
            ))}
          </div>
        ) : null}
        <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
          <label className={lbl}>
            identity_id
            <input name="identityId" required placeholder="вставь id identity" className={field} />
          </label>
          <label className={lbl}>
            identity_type
            <select name="identityType" defaultValue="CUSTOMIZED_USER" className={field}>
              <option value="CUSTOMIZED_USER">CUSTOMIZED_USER</option>
              <option value="TT_USER">TT_USER</option>
              <option value="AUTH_CODE">AUTH_CODE</option>
            </select>
          </label>
        </div>
      </div>

      {/* Креатив */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}>
          Видеоролик
          <input name="video" type="file" accept="video/*" required className={`${field} file:mr-3 file:rounded-full file:border-0 file:bg-raise file:px-3 file:py-1 file:text-[11px] file:text-soft`} />
        </label>
        <label className={lbl}>
          Ссылка (landing url)
          <input name="landingUrl" type="url" required placeholder="https://…" className={field} />
        </label>
      </div>

      <label className={lbl}>
        Текст объявления
        <textarea name="adText" required rows={3} placeholder="Текст, который увидит пользователь" className={field} />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className={lbl}>
          Кнопка (call to action)
          <select name="callToAction" defaultValue="LEARN_MORE" className={field}>
            {CTAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={lbl}>
          Режим запуска
          <select name="mode" defaultValue="paused" className={field}>
            <option value="paused">Создать на паузе</option>
            <option value="active">Запустить сразу</option>
          </select>
        </label>
      </div>

      {state && !state.ok ? (
        <div className="rounded-[12px] border border-rust/40 bg-rust-t px-3 py-2.5 text-[12px] text-rust">{state.error}</div>
      ) : null}
      {state && state.ok ? (
        <div className="rounded-[12px] border border-sage/40 bg-sage-t px-3 py-2.5 text-[12px] text-sage">{state.info ?? 'Готово'}</div>
      ) : null}

      <div>
        <button type="submit" disabled={pending || !accountId} className="rounded-full bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition hover:brightness-110 disabled:opacity-50">
          {pending ? 'Заливаю…' : 'Запустить автозалив'}
        </button>
      </div>
    </form>
  );
}
