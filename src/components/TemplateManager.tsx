'use client';

import { useState, useRef } from 'react';
import { useActionState } from 'react';
import { saveTemplate, deleteTemplate, type TemplateState } from '@/app/actions/autoupload';
import { PLACEMENTS, validPlacementKeys, placementSummary } from '@/lib/placements';
import Select from './Select';

export type Template = {
  id: string;
  name: string;
  countries: string;
  excluded: string;
  excludedRegions: string;
  excludedCities: string;
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
export default function TemplateManager({ templates, query = '' }: { templates: Template[]; query?: string }) {
  const [edit, setEdit] = useState<Template | null>(null);
  const [saveState, save] = useActionState<TemplateState, FormData>(saveTemplate, null);
  const [, del] = useActionState<TemplateState, FormData>(deleteTemplate, null);

  // Проверка на дубль по ГЕО перед созданием нового шаблона: если уже есть
  // шаблон(ы) с тем же набором стран — покажем какие и спросим подтверждение.
  const formRef = useRef<HTMLFormElement>(null);
  const [dups, setDups] = useState<Template[] | null>(null);
  const normGeo = (s: string) => [...new Set((s || '').toUpperCase().split(/[,;\s]+/).filter(Boolean))].sort().join(',');
  const submitForm = () => { setDups(null); formRef.current?.requestSubmit(); };
  const onCreateClick = () => {
    // Правку не проверяем — дубль касается только создания нового шаблона.
    if (edit) { submitForm(); return; }
    const geo = normGeo(String(new FormData(formRef.current!).get('countries') ?? ''));
    if (!geo) { submitForm(); return; } // без стран проверять нечего
    const found = templates.filter((t) => normGeo(t.countries) === geo);
    if (found.length) { setDups(found); return; }
    submitForm();
  };

  // Ключом сбрасываем поля формы при переключении «новый ↔ правка».
  const key = edit?.id ?? 'new';
  // Поиск живёт в шапке (таб-бар автозалива) и приходит пропом.
  const filtered = templates.filter((t) => t.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div>
      {templates.length === 0 ? (
        <p className="text-[12px] text-mute">Шаблонов пока нет — заведи первый ниже.</p>
      ) : (
        <>
          <div className="mb-2 text-[11.5px] text-mute">{filtered.length} из {templates.length}</div>
          <div className="scroll-slim flex max-h-[300px] flex-col gap-1.5 overflow-auto pr-1">
            {filtered.length === 0 ? <p className="text-[12px] text-mute">Ничего не найдено.</p> : null}
            {filtered.map((t) => (
            <div key={t.id} className="flex items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[12px]">
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-soft">{t.name}</span>
                <span className="ml-2 text-mute">
                  {t.countries || '—'}
                  {t.excluded ? ` (−${t.excluded})` : ''}
                  {t.excludedRegions ? ` (−рег.: ${t.excludedRegions})` : ''}
                  {t.excludedCities ? ` (−гор.: ${t.excludedCities})` : ''} · {t.ageMin}-{t.ageMax} · {genderLabel(t.genders)} · ${(t.dailyBudgetCents / 100).toFixed(0)}/д · {t.event} · {placementSummary(t.placements)}
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

      <form key={key} ref={formRef} action={save} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <div className="text-[12px] font-semibold text-soft">{edit ? `Правка: ${edit.name}` : 'Новый шаблон'}</div>
        {edit ? <input type="hidden" name="id" value={edit.id} /> : null}
        <input name="name" defaultValue={edit?.name ?? ''} placeholder="Название (напр. «Европа лид»)" className={inp} />
        <div className="grid grid-cols-2 gap-2">
          <input name="countries" defaultValue={edit?.countries ?? ''} placeholder="Страны: US,DE,FR" className={inp} />
          <input name="excluded" defaultValue={edit?.excluded ?? ''} placeholder="Исключить страны: PL,RO (опц.)" className={inp} />
        </div>
        <div>
          <input name="excludedRegions" defaultValue={edit?.excludedRegions ?? ''} placeholder="Исключить регионы: Madeira, Azores (опц.)" className={inp} />
          <p className="mt-1 text-[11px] text-dim">Названия регионов через запятую (области/штаты). Ключи FB подставим при заливе; что не найдётся — попадёт в журнал.</p>
        </div>
        <div>
          <textarea name="excludedCities" defaultValue={edit?.excludedCities ?? ''} placeholder="Исключить города: LAS CONDES; PROVIDENCIA; NUNOA (опц.)" rows={2} className={`${inp} h-auto min-h-[38px] resize-y py-2 leading-relaxed`} />
          <p className="mt-1 text-[11px] text-dim">Города/комуны через запятую или «;» (можно с новой строки). FB исключает их отдельно от регионов — ключи подставим при заливе, ненайденные попадут в журнал.</p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <input name="ageMin" type="number" min={13} max={65} defaultValue={edit?.ageMin ?? 18} placeholder="возр. от" className={inp} />
          <input name="ageMax" type="number" min={13} max={65} defaultValue={edit?.ageMax ?? 65} placeholder="возр. до" className={inp} />
          <Select
            name="genders"
            defaultValue={edit?.genders ?? ''}
            triggerClassName={inp}
            options={[
              { value: '', label: 'все' },
              { value: '1', label: 'муж' },
              { value: '2', label: 'жен' },
            ]}
          />
          <input name="budget" type="text" inputMode="decimal" defaultValue={edit ? (edit.dailyBudgetCents / 100).toString() : '20'} placeholder="$/день" className={inp} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Select name="event" defaultValue={edit?.event ?? 'LEAD'} triggerClassName={inp} options={EVENTS.map((e) => ({ value: e, label: e }))} />
          <Select name="cta" defaultValue={edit?.cta ?? 'LEARN_MORE'} triggerClassName={inp} options={CTAS.map((c) => ({ value: c, label: c }))} />
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
                        <label key={p.key} className="inline-flex w-fit cursor-pointer items-center gap-2 text-[12px] text-soft">
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

        {/* Найден дубль по гео — показываем какой и просим подтвердить создание. */}
        {!edit && dups && dups.length ? (
          <div className="flex flex-col gap-2 rounded-[12px] border px-3 py-2.5 text-[12px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
            <div className="text-soft">
              Уже есть шаблон{dups.length > 1 ? 'ы' : ''} с таким же гео (<span className="font-medium text-amber">{normGeo(dups[0].countries) || '—'}</span>):{' '}
              <span className="text-soft">{dups.map((d) => `«${d.name}»`).join(', ')}</span>. Точно создать ещё один?
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={submitForm} className="rounded-full border border-sage bg-sage-t px-4 py-1.5 text-[12px] text-sage transition hover:brightness-110">
                Всё равно создать
              </button>
              <button type="button" onClick={() => setDups(null)} className="rounded-full border border-line2 px-4 py-1.5 text-[12px] text-mute transition hover:text-text">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" onClick={onCreateClick} className="rounded-full border border-sage bg-sage-t px-4 py-1.5 text-[12px] text-sage transition hover:brightness-110">
              {edit ? 'Сохранить' : 'Добавить шаблон'}
            </button>
            {edit ? (
              <button type="button" onClick={() => setEdit(null)} className="rounded-full border border-line2 px-4 py-1.5 text-[12px] text-mute transition hover:text-text">
                Отмена
              </button>
            ) : null}
          </div>
        )}
      </form>
    </div>
  );
}
