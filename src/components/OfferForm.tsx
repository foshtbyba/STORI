'use client';

import { useState } from 'react';
import Link from 'next/link';
import Select from './Select';
import { PanelHead, Sub } from './ui';
import { IconTag, IconPlus } from './icons';
import { PARTNERS, partnerOf, DEFAULT_BACKFIX, uiLangFor } from '@/lib/builder';

export type GeoDraft = {
  langCode: string;
  uiLang: string;
  partnerOfferId: string;
  landingUrl: string;
  streamCode: string;
  price: string;
};

export type OfferDraft = {
  id?: string;
  name: string;
  vertical: string;
  network: string;
  status: string;
  geos: string;
  bans: string;
  notes: string;
  previewUrl: string;
  payout: string;
  partnerKey: string;
  backfix: string;
  rows: GeoDraft[];
};

const field =
  'w-full rounded-xl border border-line bg-sub px-3.5 py-2.5 text-[14px] outline-none transition placeholder:text-faint hover:border-line2 focus:border-sage';

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  hint,
  wide = false,
}: {
  label: string;
  name?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <label className="mb-1.5 block text-[11.5px] text-mute">{label}</label>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={field}
      />
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{hint}</p> : null}
    </div>
  );
}

const emptyGeo = (): GeoDraft => ({
  langCode: '',
  uiLang: '',
  partnerOfferId: '',
  landingUrl: '',
  streamCode: '',
  price: '',
});

/**
 * Карточка оффера: справочная часть и данные для конструктора лендов.
 *
 * Гео у оффера обычно несколько, и в конструктор под каждое уходит своё: свой
 * ID в кабинете партнёрки, свой лендинг, своя цена. Поэтому не одно поле на
 * оффер, а строка на гео — и копировать в билдер потом можно нужное.
 */
export default function OfferForm({
  draft,
  action,
  statuses,
}: {
  draft: OfferDraft;
  action: (formData: FormData) => void;
  statuses: { value: string; label: string }[];
}) {
  const [v, setV] = useState(draft);
  const [rows, setRows] = useState<GeoDraft[]>(draft.rows.length ? draft.rows : [emptyGeo()]);
  const set = (k: keyof OfferDraft) => (val: string) => setV((p) => ({ ...p, [k]: val }));
  const partner = partnerOf(v.partnerKey);

  const setRow = (i: number, k: keyof GeoDraft, val: string) =>
    setRows((p) => p.map((r, j) => (j === i ? { ...r, [k]: val } : r)));

  // Пустые строки в базу не пишем: гео без кода — это просто незаполненная форма.
  const payload = JSON.stringify(rows.filter((r) => r.langCode.trim()));

  return (
    <form
      action={action}
      className="rounded-[26px] border border-line p-4 sm:p-6"
      style={{ background: 'var(--color-panel-glass)' }}
    >
      {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
      <input type="hidden" name="geoRows" value={payload} />
      {/* Прежнее название партнёрки: пригодится, если её нет в списке. */}
      <input type="hidden" name="network" value={v.network} />
      <PanelHead
        icon={<IconTag color="#b4c68c" />}
        tint="bg-sage-t"
        title={draft.id ? 'Правка оффера' : 'Новый оффер'}
        aside={<span className="text-[12.5px] text-mute">справочник · и данные для конструктора</span>}
        right={
          <Link
            href="/offers"
            className="rounded-full border border-line px-4 py-2 text-[13px] text-mute transition hover:border-line2 hover:text-soft"
          >
            Отмена
          </Link>
        }
      />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Название" name="name" value={v.name} onChange={set('name')} placeholder="Имя оффера" />
        <Field label="Вертикаль" name="vertical" value={v.vertical} onChange={set('vertical')} placeholder="Тема, ниша" />
        <div>
          <label className="mb-1.5 block text-[11.5px] text-mute">Статус</label>
          <Select name="status" value={v.status} onChange={set('status')} options={statuses} />
        </div>
        <div>
          <label className="mb-1.5 block text-[11.5px] text-mute">Партнёрка</label>
          <Select
            name="partnerKey"
            value={v.partnerKey}
            onChange={set('partnerKey')}
            placeholder="Не выбрана"
            options={PARTNERS.map((p) => ({ value: p.key, label: p.label }))}
          />
        </div>
        <Field label="Гео через запятую" name="geos" value={v.geos} onChange={set('geos')} placeholder="IT, ES, PT" />
        <Field
          label="Регионы-исключения"
          name="bans"
          value={v.bans}
          onChange={set('bans')}
          placeholder="Регионы, куда лить нельзя"
        />
        <Field label="Выплата" name="payout" value={v.payout} onChange={set('payout')} placeholder="как договорились" />
        <Field
          wide
          label="Ссылка на превью (если есть)"
          name="previewUrl"
          value={v.previewUrl}
          onChange={set('previewUrl')}
          placeholder="https://… — можно оставить пустым, превью грузится файлом"
        />
      </div>

      <div className="mt-3">
        <label className="mb-1.5 block text-[11.5px] text-mute">Уточнения, по одному в строке</label>
        <textarea
          name="notes"
          rows={2}
          defaultValue={v.notes}
          placeholder="Что важно помнить по этому офферу"
          className={`${field} resize-y`}
        />
      </div>

      {/* ── Для конструктора ─────────────────────────────────────────── */}
      <Sub className="mt-5 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-t">
            <IconPlus color="#6fa9a0" size={14} width={2.6} />
          </span>
          <span className="text-[15px] font-semibold">Для конструктора лендов</span>
          <span className="hidden h-4 w-px bg-line2 sm:block" />
          <span className="text-[12px] text-mute">
            заполняется один раз — дальше оффер вставляется в билдер одной кнопкой
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-[11.5px] text-mute">Партнёрка</label>
            <div className="flex h-11 items-center rounded-xl border border-line bg-sub px-3.5 text-[14px]">
              {partner ? (
                <span>{partner.label}</span>
              ) : (
                <span className="text-dim">выбери партнёрку выше</span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-dim">
              От неё зависит, что нужно заполнить по каждому гео.
            </p>
          </div>
          <Field
            label="Back-fix ссылка"
            name="backfix"
            value={v.backfix}
            onChange={set('backfix')}
            placeholder={DEFAULT_BACKFIX}
            hint="Одна на все офферы, подставляется сама. Меняй, только если знаешь зачем."
          />
        </div>

        {partner?.note ? (
          <p className="mt-4 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-mute">
            {partner.note}
          </p>
        ) : null}

        {/* ── Гео ────────────────────────────────────────────────────── */}
        <div className="mt-5 flex items-center justify-between border-t border-line pt-4">
          <span className="lab">Гео оффера</span>
          <span className="text-[11.5px] text-mute">у каждого свои ID, лендинг и цена</span>
        </div>

        {rows.map((r, i) => (
          <div key={i} className="mt-3 rounded-[18px] border border-line p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="n text-[13px] font-semibold text-soft">
                {r.langCode.trim() ? r.langCode.trim().toUpperCase() : `Гео ${i + 1}`}
              </span>
              {rows.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                  className="text-[11.5px] text-dim transition hover:text-rust"
                >
                  убрать
                </button>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label="Код гео (langCode)"
                value={r.langCode}
                onChange={(val) => setRow(i, 'langCode', val)}
                placeholder="cz · be · fr"
              />
              {partner && !partner.noId ? (
                <Field
                  label={partner.idLabel}
                  value={r.partnerOfferId}
                  onChange={(val) => setRow(i, 'partnerOfferId', val)}
                  placeholder="из кабинета партнёрки"
                />
              ) : null}
              <Field
                label="Цена"
                value={r.price}
                onChange={(val) => setRow(i, 'price', val)}
                placeholder="39 €"
              />
              {partner?.needsLanding ? (
                <Field
                  wide
                  label="URL оригинального лендинга"
                  value={r.landingUrl}
                  onChange={(val) => setRow(i, 'landingUrl', val)}
                  placeholder="https://… — точный адрес со страницы оффера"
                  hint="Обязательно для этой партнёрки: с чужим URL заявка не улетит."
                />
              ) : null}
              {partner?.hasStream ? (
                <Field
                  label="Код потока"
                  value={r.streamCode}
                  onChange={(val) => setRow(i, 'streamCode', val)}
                  placeholder="опционально"
                />
              ) : null}
              <Field
                label="Язык call/error"
                value={r.uiLang}
                onChange={(val) => setRow(i, 'uiLang', val)}
                placeholder={uiLangFor(r.langCode) || 'из гео'}
                hint={
                  uiLangFor(r.langCode)
                    ? `Пусто — поставим «${uiLangFor(r.langCode)}», это язык выбранного гео.`
                    : 'Пусто — выведем язык из кода гео.'
                }
              />
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows((p) => [...p, emptyGeo()])}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-dashed border-line2 py-2.5 text-[12.5px] text-mute transition hover:border-sage hover:text-sage"
        >
          <IconPlus color="currentColor" size={13} width={2.6} />
          Ещё гео
        </button>
      </Sub>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          className="w-full rounded-full bg-sage px-6 py-3 text-[13px] font-semibold text-bg transition hover:opacity-90 sm:w-auto sm:py-2.5"
        >
          Сохранить
        </button>
      </div>
    </form>
  );
}
