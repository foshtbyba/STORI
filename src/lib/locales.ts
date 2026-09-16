/**
 * Локали Меты для мультиязычных объявлений (код → название). Не весь список
 * Меты, а рабочий набор; при заливе видео код уходит в customization_spec.
 * Обычный модуль (не server-only): нужен и клиенту (выпадашка), и серверу.
 */
export const LOCALES: { code: string; name: string }[] = [
  { code: 'ro_RO', name: 'Romanian' },
  { code: 'en_US', name: 'English (US)' },
  { code: 'en_GB', name: 'English (UK)' },
  { code: 'ar_AR', name: 'Arabic' },
  { code: 'af_ZA', name: 'Afrikaans' },
  { code: 'sq_AL', name: 'Albanian' },
  { code: 'de_DE', name: 'German' },
  { code: 'fr_FR', name: 'French' },
  { code: 'es_ES', name: 'Spanish' },
  { code: 'es_LA', name: 'Spanish (Latin America)' },
  { code: 'it_IT', name: 'Italian' },
  { code: 'pt_PT', name: 'Portuguese' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)' },
  { code: 'pl_PL', name: 'Polish' },
  { code: 'nl_NL', name: 'Dutch' },
  { code: 'cs_CZ', name: 'Czech' },
  { code: 'sk_SK', name: 'Slovak' },
  { code: 'hu_HU', name: 'Hungarian' },
  { code: 'el_GR', name: 'Greek' },
  { code: 'bg_BG', name: 'Bulgarian' },
  { code: 'hr_HR', name: 'Croatian' },
  { code: 'sr_RS', name: 'Serbian' },
  { code: 'sl_SI', name: 'Slovenian' },
  { code: 'tr_TR', name: 'Turkish' },
  { code: 'ru_RU', name: 'Russian' },
  { code: 'uk_UA', name: 'Ukrainian' },
  { code: 'sv_SE', name: 'Swedish' },
  { code: 'nb_NO', name: 'Norwegian' },
  { code: 'da_DK', name: 'Danish' },
  { code: 'fi_FI', name: 'Finnish' },
  // Языки под сам залив «языками» — в т.ч. редкие, но реально есть в ФБ.
  { code: 'ko_KR', name: 'Korean' },
  { code: 'ja_JP', name: 'Japanese' },
  { code: 'ml_IN', name: 'Malayalam' },
  { code: 'ta_IN', name: 'Tamil' },
  { code: 'cy_GB', name: 'Welsh' },
  { code: 'eu_ES', name: 'Basque' },
  { code: 'fy_NL', name: 'Frisian' },
  { code: 'cx_PH', name: 'Cebuano' },
  { code: 'si_LK', name: 'Sinhala' },
  { code: 'km_KH', name: 'Khmer' },
  { code: 'gn_PY', name: 'Guarani' },
  { code: 'ff_NG', name: 'Fula' },
  { code: 'ms_MY', name: 'Malay' },
  { code: 'id_ID', name: 'Indonesian' },
  { code: 'vi_VN', name: 'Vietnamese' },
  { code: 'th_TH', name: 'Thai' },
  { code: 'hi_IN', name: 'Hindi' },
  { code: 'et_EE', name: 'Estonian' },
  { code: 'lv_LV', name: 'Latvian' },
  { code: 'lt_LT', name: 'Lithuanian' },
];

const NAMES = new Map(LOCALES.map((l) => [l.code, l.name]));

export function localeName(code: string): string {
  return NAMES.get(code) ?? code;
}

export function isLocale(code: string): boolean {
  return NAMES.has(code);
}

/**
 * Основной язык страны: ISO-2 код гео → код локали Меты. Нужен, когда баер не
 * указал «Язык по умолчанию» вручную: язык гео = язык основного ролика, и без
 * него доп-языки пака не прикрепить. Держим только уверенные соответствия;
 * чего нет — вернём null и оставим прежнее поведение (просьба указать язык).
 */
const GEO_LOCALE: Record<string, string> = {
  RO: 'ro_RO', BG: 'bg_BG', GR: 'el_GR', HR: 'hr_HR', RS: 'sr_RS', SI: 'sl_SI',
  DE: 'de_DE', AT: 'de_DE', CH: 'de_DE', FR: 'fr_FR', BE: 'fr_FR', ES: 'es_ES',
  IT: 'it_IT', PT: 'pt_PT', PL: 'pl_PL', NL: 'nl_NL', CZ: 'cs_CZ', SK: 'sk_SK',
  HU: 'hu_HU', TR: 'tr_TR', RU: 'ru_RU', UA: 'uk_UA', SE: 'sv_SE', NO: 'nb_NO',
  DK: 'da_DK', FI: 'fi_FI', EE: 'et_EE', LV: 'lv_LV', LT: 'lt_LT', AL: 'sq_AL',
  GB: 'en_GB', IE: 'en_GB', AU: 'en_GB', NZ: 'en_GB', ZA: 'en_GB', US: 'en_US',
  CA: 'en_US', MX: 'es_LA', CL: 'es_LA', AR: 'es_LA', CO: 'es_LA', PE: 'es_LA',
  EC: 'es_LA', BO: 'es_LA', PY: 'es_LA', UY: 'es_LA', CR: 'es_LA', PA: 'es_LA',
  DO: 'es_LA', GT: 'es_LA', BR: 'pt_BR', KR: 'ko_KR', JP: 'ja_JP', MY: 'ms_MY',
  ID: 'id_ID', VN: 'vi_VN', TH: 'th_TH', PH: 'en_GB', LK: 'si_LK', KH: 'km_KH',
  IN: 'hi_IN',
};

/** Код локали Меты по стране гео (или null, если соответствие не знаем). */
export function geoDefaultLocale(country: string): string | null {
  return GEO_LOCALE[(country || '').trim().toUpperCase()] ?? null;
}
