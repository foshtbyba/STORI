/*
 * Подключается ПОСЛЕ countrieslist.js и countries.js.
 * 1) Страна из ссылки: ?c=de или ?country=de — выбирается во всех формах сразу.
 *    Без параметра остаётся страна по умолчанию из countrieslist.js (isDefault).
 * 2) Смена страны в любой форме переставляет её во всех остальных формах:
 *    countries.js меняет цену везде, а сам список — только в той форме, где кликнули.
 */
document.addEventListener('DOMContentLoaded', function () {
  var selects = Array.prototype.slice.call(document.querySelectorAll('.country_select'));
  var countries = window.countryList || {};
  if (!selects.length) return;

  selects.forEach(function (select) {
    select.addEventListener('change', function () {
      selects.forEach(function (other) {
        if (other !== select) other.value = select.value;
      });
    });
  });

  var params = new URLSearchParams(window.location.search);
  var code = (params.get('c') || params.get('country') || '').toLowerCase();
  if (countries[code]) {
    selects[0].value = code;
    selects[0].dispatchEvent(new Event('change'));
  }
});
