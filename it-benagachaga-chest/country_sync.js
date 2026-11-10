/*
 * Подключается ПОСЛЕ countrieslist.js и countries.js.
 * 1) Страна из URL: ?c=de или ?country=de — приоритет.
 * 2) Если нет параметра — определяем по IP (ipapi.co → api.country.is).
 * 3) После определения вызывает window.onCountryDetected(code).
 * 4) Смена страны в любой форме переставляет её во всех остальных.
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
    notify(urlCode, true);
  } else {
    detectByIP();
  }

  function applyCountry(code) {
    if (selects[0]) {
      selects[0].value = code;
      selects[0].dispatchEvent(new Event('change'));
    }
  }

  function notify(code, fromUrl) {
    var fn = fromUrl ? 'onCountryConfirmed' : 'onCountryDetected';
    if (typeof window[fn] === 'function') window[fn](code);
    else if (typeof window.onCountryDetected === 'function') window.onCountryDetected(code);
  }

  function getDefault() {
    for (var k in countries) {
      if (countries.hasOwnProperty(k) && countries[k].isDefault) return k;
    }
    return 'it';
  }

  function detectByIP() {
    fetchCode('https://ipapi.co/country_code/', function (text) {
      return (text || '').trim().toLowerCase();
    }, function (code) {
      if (countries[code]) applyCountry(code);
      notify(countries[code] ? code : getDefault(), false);
    }, function () {
      fetchCode('https://api.country.is/', function (text) {
        try { return (JSON.parse(text).country || '').toLowerCase(); }
        catch (e) { return ''; }
      }, function (code) {
        if (countries[code]) applyCountry(code);
        notify(countries[code] ? code : getDefault(), false);
      }, function () {
        notify(getDefault(), false);
      });
    });
  }

  function fetchCode(url, parse, onOk, onFail) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 4000;
      xhr.onload = function () {
        if (xhr.status === 200) {
          var c = parse(xhr.responseText);
          if (c) { onOk(c); return; }
        }
        onFail();
      };
      xhr.onerror = onFail;
      xhr.ontimeout = onFail;
      xhr.send();
    } catch (e) { onFail(); }
  }
});
