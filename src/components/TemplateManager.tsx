'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { saveTemplate, deleteTemplate, type TemplateState } from '@/app/actions/autoupload';
import { PLACEMENTS, validPlacementKeys, placementSummary } from '@/lib/placements';

export type Template = {
  id: string;
  name: string;
  countries: string;
  excluded: string;
  ageMin: number;
  ageMax: number;
  genders: string;
  dailyBudgetCents: number;
  event: string;
  cta: string;
  placements: string;
};

const EVENTS =['LEAD', 'PURCHASE', 'COMPLETE_REGISTRATION', 'SUBSCRIBE', 'ADD_TO_CART', 'INITIATE_CHECKOUT', 'SUBMIT_APPLICATION', 'CONTACT'];
const CTAS = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'SUBSCRIBE', 'GET_OFFER', 'DOWNLOAD', 'CONTACT_US', 'APPLY_NOW', 'ORDER_NOW', 'GET_QUOTE'];

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft';
const genderLabel = (g: string) => (g === '1' ? 'муж' : g === '2' ? 'жен' : 'все');

/**
 * Админ: шаблоны гео для автозалива. Список готовых + форма добавления/правки.
 * Баер при заливе выбирает шаблон и не собирает таргет руками.
 */
export default function TemplateManager({ templates }: { templates: Template[] }) {
  const [edit, setEdit] = useState<Template | null>(null);
  const [q, setQ] = useState('');
  const [saveState, save] = useActionState<TemplateState, FormData>(saveTemplate, null);
  const [, del] = useActionState<TemplateState, FormData>(deleteTemplate, null);

  // Ключом сбрасываем поля формы при переключении «новый ↔ правка».
  const key = edit?.id ?? 'new';
  const filtered = templates.filter((t) => t.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div>
      {templates.length === 0 ? (
        <p className="text-[12px] text-mute">Шаблонов пока нет — заведи первый ниже.</p>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по названию…" className={`${inp} max-w-[280px]`} />
            <span className="text-[11.5px] text-mute">{filtered.length} из {templates.length}</span>
          </div>
          <div className="scroll-slim flex max-h-[300px] flex-col gap-1.5 overflow-auto pr-1">
            {filtered.length === 0 ? <p className="text-[12px] text-mute">Ничего не найдено.</p> : null}
            {filtered.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-soft">{t.name}</span>
                <span className="ml-2 text-mute">
                  {t.countries || '—'}
                  {t.excluded ? ` (−${t.excluded})` : ''} · {t.ageMin}-{t.ageMax} · {genderLabel(t.genders)} · ${(t.dailyBudgetCents / 100).toFixed(0)}/д · {t.event} · {placementSummary(t.placements)}
                </span>
              </span>
              <button type="button" onClick={() => setEdit(t)} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-sage hover:text-sage">
                Править
              </button>
              <form action={del} className="shrink-0">
                <input type="hidden" name="id" value={t.id} />
                <button type="submit" className="rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust">
                  Удалить
                </button>
              </form>
            </div>
            ))}
          </div>
        </>
      )}

      <form key={key} action={save} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <div className="text-[12px] font-semibold text-soft">{edit ? `Правка: ${edit.name}` : 'Новый шаблон'}</div>
        {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
        <input name="name" defaultValue={edit?.name ?? ''} placeholder="Название (напр. «Европа лид»)" className={inp} />
        <div className="grid grid-cols-2 gap-2">
          <input name="countries" defaultValue={edit?.countries ?? ''} placeholder="Страны: US,DE,FR" className={inp} />
          <input name="excluded" defaultValue={edit?.excluded ?? ''} placeholder="Исключить (опц.)" className={inp} />
        </div>
        <div className="grid grid-cols-4 gap-2">
          <input name="ageMin" type="number" min={13} max={65} defaultValue={edit?.ageMin ?? 18} placeholder="возр. от" className={inp} />
          <input name="ageMax" type="number" min={13} max={65} defaultValue={edit?.ageMax ?? 65} placeholder="возр. до" className={inp} />
          <select name="genders" defaultValue={edit?.genders ?? ''} className={inp}>
            <option value="">все</option>
            <option value="1">муж</option>
            <option value="2">жен</option>
          </select>
          <input name="budget" type="text" inputMode="decimal" defaultValue={edit ? (edit.dailyBudgetCents / 100).toString() : '20'} placeholder="$/день" className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select name="event" defaultValue={edit?.event ?? 'LEAD'} className={inp}>
            {EVENTS.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
          <select name="cta" defaultValue={edit?.cta ?? 'LEARN_MORE'} className={inp}>
            {CTAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Плейсменты: FB и IG — своими колонками; мелкие площадки (Threads,
            Audience Network, Messenger) сложены в одну колонку друг под другом,
            чтобы не пустовало. Ничего не отмечено = авто (Advantage+). */}
        <div>
          <div className="mb-2 text-[11.5px] text-mute">Плейсменты <span className="text-dim">(ничего не отмечено = авто/Advantage+)</span></div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            {(() => {
              const marked = validPlacementKeys((edit?.placements ?? '').split(','));
              const groupBlock = (platform: string, label: string) => {
                const items = PLACEMENTS.filter((p) => p.platform === platform);
                if (items.length === 0) return null;
                return (
                  <div key={platform}>
                    <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-amber">{label}</div>
                    <div className="flex flex-col gap-1">
                      {items.map((p) => (
                        <label key={p.key} className="flex cursor-pointer items-center gap-2 text-[12px] text-soft">
                          <input type="checkbox" name="placements" value={p.key} defaultChecked={marked.includes(p.key)} className="accent-[#b4c68c]" />
                          <span className="truncate">{p.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              };
              return (
                <>
                  {groupBlock('facebook', 'Facebook')}
                  {groupBlock('instagram', 'Instagram')}
                  <div className="flex flex-col gap-3">
                    {groupBlock('threads', 'Threads')}
                    {groupBlock('audience_network', 'Audience Network')}
                    {groupBlock('messenger', 'Messenger')}
                  </div>
                </>
              );
            })()}
          </div>
        </div>

        {saveState && !saveState.ok ? <div className="text-[11.5px] text-rust">{saveState.error}</div> : null}
        {saveState?.ok ? <div className="text-[11.5px] text-sage">Сохранено.</div> : null}
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-full border border-sage bg-sage-t px-4 py-1.5 text-[12px] text-sage transition hover:brightness-110">
            {edit ? 'Сохранить' : 'Добавить шаблон'}
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
