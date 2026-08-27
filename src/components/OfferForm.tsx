'use client';

import { useState } from 'react';
import Link from 'next/link';
import Select from './Select';
import { PanelHead, Sub } from './ui';
import { IconTag, IconPlus } from './icons';
import { PARTNERS, partnerOf } from '@/lib/builder';

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
  offerId: string;
  landingUrl: string;
  streamCode: string;
  langCode: string;
  price: string;
  imagePath: string;
  backfix: string;
  uiLang: string;
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
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'col-span-2' : ''}>
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

/**
 * Карточка оффера: справочная часть и данные для конструктора лендов.
 *
 * Вторая половина формы подстраивается под партнёрку — у каждой свой набор
 * обязательного. Спрашивать всё подряд бессмысленно: у limonad, например, ID
 * оффера нет вовсе, там на каждый оффер свой файл обработчика.
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
  const set = (k: keyof OfferDraft) => (val: string) => setV((p) => ({ ...p, [k]: val }));
  const partner = partnerOf(v.partnerKey);

  return (
    <form
      action={action}
      className="rounded-[26px] border border-line p-6"
      style={{ background: 'var(--color-panel-glass)' }}
    >
      {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
      <PanelHead
        icon={<IconTag color="#b4c68c" />}
        tint="bg-sage-t"
        title={draft.id ? 'Правка оффера' : 'Новый оффер'}
        aside={
          <span className="text-[12.5px] text-mute">
            справочник · и данные для конструктора
          </span>
        }
        right={
          <Link
            href="/offers"
            className="rounded-full border border-line px-4 py-2 text-[13px] text-mute transition hover:border-line2 hover:text-soft"
          >
            Отмена
          </Link>
        }
      />

      <div className="mt-5 grid grid-cols-3 gap-3">
        <Field label="Название" name="name" value={v.name} onChange={set('name')} placeholder="Имя оффера" />
        <Field label="Вертикаль" name="vertical" value={v.vertical} onChange={set('vertical')} placeholder="Тема, ниша" />
        <div>
          <label className="mb-1.5 block text-[11.5px] text-mute">Статус</label>
          <Select name="status" value={v.status} onChange={set('status')} options={statuses} />
        </div>
        <Field label="Партнёрка · название" name="network" value={v.network} onChange={set('network')} placeholder="Как её называем" />
        <Field label="Гео через запятую" name="geos" value={v.geos} onChange={set('geos')} placeholder="IT, ES, PT" />
        <Field label="Исключения" name="bans" value={v.bans} onChange={set('bans')} placeholder="Гео, куда нельзя" />
        <Field
          wide
          label="Ссылка на превью"
          name="previewUrl"
          value={v.previewUrl}
          onChange={set('previewUrl')}
          placeholder="https://…"
        />
        <Field label="Выплата" name="payout" value={v.payout} onChange={set('payout')} placeholder="как договорились" />
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
      <Sub className="mt-5 p-5">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-t">
            <IconPlus color="#6fa9a0" size={14} width={2.6} />
          </span>
          <span className="text-[15px] font-semibold">Для конструктора лендов</span>
          <span className="h-4 w-px bg-line2" />
          <span className="text-[12px] text-mute">
            заполняется один раз — дальше оффер вставляется в билдер одной кнопкой
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="mb-1.5 block text-[11.5px] text-mute">Партнёрка в конструкторе</label>
            <Select
              name="partnerKey"
              value={v.partnerKey}
              onChange={set('partnerKey')}
              placeholder="Не выбрана"
              options={PARTNERS.map((p) => ({ value: p.key, label: p.label }))}
            />
          </div>

          {partner && !partner.noId ? (
            <Field
              label={partner.idLabel}
              name="offerId"
              value={v.offerId}
              onChange={set('offerId')}
              placeholder="из кабинета партнёрки"
            />
          ) : (
            <input type="hidden" name="offerId" value={v.offerId} />
          )}

          <Field
            label="Код гео (langCode)"
            name="langCode"
            value={v.langCode}
            onChange={set('langCode')}
            placeholder="cz · be · fr"
          />

          {partner?.needsLanding ? (
            <Field
              wide
              label="URL оригинального лендинга"
              name="landingUrl"
              value={v.landingUrl}
              onChange={set('landingUrl')}
              placeholder="https://… — точный адрес со страницы оффера"
              hint="Обязательно для этой партнёрки: с чужим URL заявка не улетит."
            />
          ) : (
            <input type="hidden" name="landingUrl" value={v.landingUrl} />
          )}

          {partner?.hasStream ? (
            <Field
              label="Код потока"
              name="streamCode"
              value={v.streamCode}
              onChange={set('streamCode')}
              placeholder="опционально"
            />
          ) : (
            <input type="hidden" name="streamCode" value={v.streamCode} />
          )}

          <Field label="Цена" name="price" value={v.price} onChange={set('price')} placeholder="39 €" />
          <Field
            label="Картинка в ленде"
            name="imagePath"
            value={v.imagePath}
            onChange={set('imagePath')}
            placeholder="images/product.png"
          />
          <Field
            label="Язык страниц call/error"
            name="uiLang"
            value={v.uiLang}
            onChange={set('uiLang')}
            placeholder="cs · de · fr"
          />
          <Field
            wide
            label="Back-fix ссылка"
            name="backfix"
            value={v.backfix}
            onChange={set('backfix')}
            placeholder="https://… — куда уводить по кнопке «Назад»"
          />
        </div>

        {partner?.note ? (
          <p className="mt-4 border-t border-line pt-3.5 text-[11.5px] leading-relaxed text-mute">
            {partner.note}
          </p>
        ) : null}
      </Sub>

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          className="rounded-full bg-sage px-6 py-2.5 text-[13px] font-semibold text-bg transition hover:opacity-90"
        >
          Сохранить
        </button>
      </div>
    </form>
  );
}
