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
];

const NAMES = new Map(LOCALES.map((l) => [l.code, l.name]));

export function localeName(code: string): string {
  return NAMES.get(code) ?? code;
}

export function isLocale(code: string): boolean {
  return NAMES.has(code);
}
