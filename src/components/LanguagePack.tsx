'use client';

import { useState, useActionState } from 'react';
import { saveLanguage, deleteLanguage, type TemplateState } from '@/app/actions/autoupload';
import { LOCALES, localeName } from '@/lib/locales';

export type Language = {
  id: string;
  locale: string;
  videoUrl: string;
  headline: string;
  primaryText: string;
  description: string;
  link: string;
};

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';

/**
 * Личный пак фиксированных доп. языков для видео-залива. У каждого свои — как
 * «Мои шаблоны гео». Задаётся один раз: язык, ссылка на видео и тексты; при
 * заливе видео эти языки добавляются к основному автоматически.
 */
export default function LanguagePack({ languages }: { languages: Language[] }) {
  const [edit, setEdit] = useState<Language | null>(null);
  const [saveState, save] = useActionState<TemplateState, FormData>(saveLanguage, null);
  const [, del] = useActionState<TemplateState, FormData>(deleteLanguage, null);
  const key = edit?.id ?? 'new';

  return (
    <div>
      {languages.length === 0 ? (
        <p className="text-[12px] text-mute">Языков пока нет — добавь 3-4 ниже. Они закрепятся за тобой и будут добавляться к каждому видео-заливу.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {languages.map((l) => (
            <div key={l.id} className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-soft">{localeName(l.locale)}</span>
                <span className="ml-2 text-mute">{l.videoUrl ? 'видео есть' : 'без видео'}{l.headline ? ` · ${l.headline}` : ''}</span>
              </span>
              <button type="button" onClick={() => setEdit(l)} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-sage hover:text-sage">
                Править
              </button>
              <form action={del} className="shrink-0">
                <input type="hidden" name="id" value={l.id} />
                <button type="submit" className="rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust">
                  Удалить
                </button>
              </form>
            </div>
          ))}
        </div>
      )}

      <form key={key} action={save} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <div className="text-[12px] font-semibold text-soft">{edit ? `Правка: ${localeName(edit.locale)}` : 'Новый язык'}</div>
        {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
        <div className="grid gap-2 sm:grid-cols-[220px_1fr]">
          <select name="locale" defaultValue={edit?.locale ?? ''} className={inp}>
            <option value="">— язык —</option>
            {LOCALES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          <input name="videoUrl" defaultValue={edit?.videoUrl ?? ''} placeholder="Ссылка на видео этого языка (https://…)" className={inp} />
        </div>
        <input name="headline" defaultValue={edit?.headline ?? ''} placeholder="Заголовок (headline)" className={inp} />
        <textarea name="primaryText" defaultValue={edit?.primaryText ?? ''} placeholder="Основной текст (primary text)" rows={2} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
        <div className="grid gap-2 sm:grid-cols-2">
          <input name="description" defaultValue={edit?.description ?? ''} placeholder="Описание (опц.)" className={inp} />
          <input name="link" defaultValue={edit?.link ?? ''} placeholder="Ссылка лендинга (опц. — иначе основная)" className={inp} />
        </div>
        {saveState && !saveState.ok ? <div className="text-[11.5px] text-rust">{saveState.error}</div> : null}
        {saveState?.ok ? <div className="text-[11.5px] text-sage">Сохранено.</div> : null}
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-full border border-sage bg-sage-t px-4 py-1.5 text-[12px] text-sage transition hover:brightness-110">
            {edit ? 'Сохранить' : 'Добавить язык'}
          </button>
          {edit ? (
            <button type="button" onClick={() => setEdit(null)} className="rounded-full border border-line2 px-4 py-1.5 text-[12px] text-mute transition hover:text-text">
              Отмена
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
