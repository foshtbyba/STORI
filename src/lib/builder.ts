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
  { key: 'custom', label: 'Другая (вручную)', idLabel: 'ID оффера' },
];

export function partnerOf(key: string): Partner | null {
  return PARTNERS.find((p) => p.key === key) ?? null;
}

export type BuilderOffer = {
  name: string;
  partnerKey: string;
  offerId: string;
  langCode: string;
  landingUrl: string;
  streamCode: string;
  price: string;
  imagePath: string;
  backfix: string;
  uiLang: string;
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
  put('offerId', o.offerId);
  put('geo', o.langCode);
  put('landingUrl', o.landingUrl);
  put('streamCode', o.streamCode);
  put('price', o.price);
  put('image', o.imagePath);
  put('backfix', o.backfix);
  put('uiLang', o.uiLang);
  return JSON.stringify({ [BUILDER_TAG]: BUILDER_VERSION, ...body });
}

/**
 * Чего не хватает, чтобы конструктор собрал ленд без ручной доводки. Показываем
 * прямо на карточке — дешевле поправить здесь, чем обнаружить при сборке.
 */
export function builderGaps(o: BuilderOffer): string[] {
  const partner = partnerOf(o.partnerKey);
  if (!partner) return ['партнёрка'];
  const gaps: string[] = [];
  if (!partner.noId && !o.offerId.trim()) gaps.push(partner.idLabel || 'ID оффера');
  if (!o.langCode.trim()) gaps.push('код гео');
  if (partner.needsLanding && !o.landingUrl.trim()) gaps.push('URL лендинга');
  return gaps;
}
