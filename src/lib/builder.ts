/**
 * Мост между дешбордом и конструктором лендов.
 *
 * Конструктор спрашивает при сборке одно и то же: партнёрку, ID оффера, гео,
 * иногда URL лендинга. Всё это и так известно, когда оффер заводят, — поэтому
 * храним рядом с оффером и отдаём одним куском, который конструктор
 * разбирает у себя. Формат намеренно простой: одна строка JSON, которая
 * кладётся в буфер и вставляется в поле приёма.
 *
 * Список партнёрок обязан совпадать с `PARTNERS` в tools/builder.html: ключ
 * отсюда подставляется прямо в его выпадающий список.
 */

export type Partner = {
  key: string;
  label: string;
  /** Как называется ID оффера в кабинете этой партнёрки. */
  idLabel: string;
  /** У limonad ID нет вообще — там свой lemon.php на каждый оффер. */
  noId?: boolean;
  /** shakes без URL лендинга лид не примет. */
  needsLanding?: boolean;
  /** Код потока — только у shakes и только для статистики. */
  hasStream?: boolean;
  note?: string;
};

export const PARTNERS: Partner[] = [
  { key: 'm1.top', label: 'm1.top', idLabel: 'ID оффера (product_id)' },
  {
    key: 'shakes.pro',
    label: 'shakes.pro',
    idLabel: 'ID оффера (offerId)',
    needsLanding: true,
    hasStream: true,
    note: 'Без точного URL лендинга из кабинета партнёрка не примет лид.',
  },
  { key: 'hamsters.run', label: 'hamsters.run', idLabel: 'OFFER_KEY (key_hash)' },
  {
    key: 'limonad.com',
    label: 'limonad.com',
    idLabel: '',
    noId: true,
    note: 'У этой партнёрки на каждый оффер свой lemon.php — файл берут из архива оффера и грузят в конструктор руками, скопировать его отсюда нельзя.',
  },
  { key: 'everad.com', label: 'everad.com', idLabel: 'Campaign ID (campaign_id)' },
  { key: 'rocketprofit.com', label: 'rocketprofit.com', idLabel: 'Campaign ID (campaign_id)' },
];
// «Другая (вручную)» в этом списке нет намеренно. В конструкторе такой режим
// есть, но там у партнёрки руками задают endpoint, ref и api_key — а они в
// строку оффера не уезжают. Выбрать её здесь значило бы скопировать оффер,
// который в билдере всё равно придётся донастраивать вручную.

export function partnerOf(key: string): Partner | null {
  return PARTNERS.find((p) => p.key === key) ?? null;
}

/** Один оффер под одно гео — ровно то, что уходит в конструктор. */
export type BuilderOffer = {
  name: string;
  partnerKey: string;
  backfix: string;
  langCode: string;
  uiLang: string;
  partnerOfferId: string;
  landingUrl: string;
  streamCode: string;
  price: string;
};

/** Метка формата: по ней конструктор понимает, что ему вставили именно оффер. */
export const BUILDER_TAG = 'msteam-offer';
export const BUILDER_VERSION = 1;

/**
 * Строка для буфера. Пустые поля не кладём: конструктор не должен затирать
 * то, что человек уже набрал руками.
 */
export function builderPayload(o: BuilderOffer): string {
  const body: Record<string, string> = {};
  const put = (k: string, v: string) => {
    if (v && v.trim()) body[k] = v.trim();
  };
  put('name', o.name);
  put('partner', o.partnerKey);
  put('offerId', o.partnerOfferId);
  put('geo', o.langCode);
  put('landingUrl', o.landingUrl);
  put('streamCode', o.streamCode);
  put('price', o.price);
  put('backfix', o.backfix);
  // Язык служебных страниц почти всегда следует из гео — если своего нет,
  // выводим его и не заставляем заполнять одно и то же дважды.
  put('uiLang', o.uiLang || uiLangFor(o.langCode));
  // Картинку в ленде конструктор подбирает сам из папки — не навязываем.
  return JSON.stringify({ [BUILDER_TAG]: BUILDER_VERSION, ...body });
}

/**
 * Чего не хватает, чтобы конструктор собрал ленд без ручной доводки. Показываем
 * прямо на карточке — дешевле поправить здесь, чем обнаружить при сборке.
 */
/**
 * Языки служебных страниц, которые знает конструктор (его же список).
 * Держим здесь, чтобы не отправлять код, который он молча проигнорирует.
 */
const UI_LANGS = new Set([
  'en', 'ru', 'uk', 'fr', 'nl', 'de', 'es', 'pt', 'it', 'pl', 'ro', 'cs', 'sk', 'hu', 'bg',
  'el', 'hr', 'sr', 'sl', 'sv', 'da', 'fi', 'no', 'lt', 'lv', 'et', 'tr', 'id', 'tl', 'th',
  'ar', 'ur', 'he',
]);

/**
 * Гео у партнёрки — код страны, а язык страниц — код языка, и совпадают они не
 * всегда: чехия это `cz`, а её язык `cs`. Где расходятся — переводим по этой
 * таблице, где совпадают — код гео и есть язык.
 */
const GEO_TO_UI: Record<string, string> = {
  cz: 'cs', at: 'de', ch: 'de', be: 'fr', gr: 'el', dk: 'da', se: 'sv', ee: 'et', si: 'sl',
  ua: 'uk', pk: 'ur', ae: 'ar', sa: 'ar', ma: 'ar', eg: 'ar', il: 'he', ph: 'tl', gb: 'en',
  uk: 'en', us: 'en', au: 'en', ie: 'en', ca: 'en', mx: 'es', cl: 'es', co: 'es', pe: 'es',
  ar: 'es', br: 'pt', rs: 'sr', by: 'ru', kz: 'ru', jp: 'en', kr: 'en', vn: 'en', my: 'en',
};

/**
 * Какой язык служебных страниц подставить под это гео. Пусто — значит не
 * угадали, и человек проставит сам: молча подсунуть не тот язык хуже.
 */
export function uiLangFor(geo: string): string {
  const code = geo.trim().toLowerCase().split(/[-_]/)[0];
  if (!code) return '';
  if (UI_LANGS.has(code)) return code;
  return GEO_TO_UI[code] ?? '';
}

/** Ссылка «Назад» у команды одна на все офферы. */
export const DEFAULT_BACKFIX = 'https://nutrivition.top/VXsVxCX?sun={sub_id_30}';

export function builderGaps(o: BuilderOffer): string[] {
  const partner = partnerOf(o.partnerKey);
  if (!partner) return ['партнёрка'];
  const gaps: string[] = [];
  if (!partner.noId && !o.partnerOfferId.trim()) gaps.push(partner.idLabel || 'ID оффера');
  if (!o.langCode.trim()) gaps.push('код гео');
  if (partner.needsLanding && !o.landingUrl.trim()) gaps.push('URL лендинга');
  return gaps;
}
