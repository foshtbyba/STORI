/*
 * Подключается ПОСЛЕ countrieslist.js и countries.js.
 * 1) Страна из ссылки: ?c=de или ?country=de — приоритет.
 * 2) Если нет параметра — определяем по IP через ipapi.co.
 * 3) Если IP-гео не сработал — остаётся страна по умолчанию из countrieslist.js (isDefault).
 * 4) Смена страны в любой форме переставляет её во всех остальных формах.
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
  var urlCode = (params.get('c') || params.get('country') || '').toLowerCase();

  if (urlCode && countries[urlCode]) {
    applyCountry(urlCode);
  } else {
    detectByIP();
  }

  function applyCountry(code) {
    if (selects[0]) {
      selects[0].value = code;
      selects[0].dispatchEvent(new Event('change'));
    }
  }

  function detectByIP() {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://ipapi.co/country_code/', true);
      xhr.timeout = 3000;
      xhr.onload = function () {
        if (xhr.status === 200) {
          var code = (xhr.responseText || '').trim().toLowerCase();
          if (countries[code]) {
            applyCountry(code);
          }
        }
      };
      xhr.send();
    } catch (e) {}
  }
});
