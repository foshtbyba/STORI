(function () {
    'use strict';

    var countries = window.countryList;
    if (!countries) return;

    var defaultCode = '';
    for (var code in countries) {
        if (countries.hasOwnProperty(code) && countries[code].isDefault) {
            defaultCode = code;
            break;
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        fillSelects();
        setActive(defaultCode);
        bindEvents();
    });

    function fillSelects() {
        var html = '';
        for (var code in countries) {
            if (countries.hasOwnProperty(code)) {
                html += '<option value="' + countries[code].code + '">' + countries[code].name + '</option>';
            }
        }
        var selects = document.querySelectorAll('.country_select');
        for (var i = 0; i < selects.length; i++) {
            if (selects[i].nodeName === 'SELECT') {
                selects[i].innerHTML = html;
            }
        }
    }

    function bindEvents() {
        var selects = document.querySelectorAll('.country_select');
        for (var i = 0; i < selects.length; i++) {
            selects[i].addEventListener('change', function (e) {
                applyCountry(e.target.value);
                syncSelects(e.target.value);
            });
        }
    }

    function syncSelects(code) {
        var selects = document.querySelectorAll('.country_select');
        for (var i = 0; i < selects.length; i++) {
            if (selects[i].value !== code) selects[i].value = code;
        }
    }

    function setActive(code) {
        if (!countries[code]) return;
        var selects = document.querySelectorAll('.country_select');
        for (var i = 0; i < selects.length; i++) {
            selects[i].value = code;
        }
        applyCountry(code);
    }

    function applyCountry(code) {
        var c = countries[code];
        if (!c) return;

        var mv = document.querySelectorAll('.price_main_value');
        for (var i = 0; i < mv.length; i++) mv[i].textContent = c.price;
        var mc = document.querySelectorAll('.price_main_currency');
        for (var i = 0; i < mc.length; i++) mc[i].textContent = c.labelPrice;

        var ov = document.querySelectorAll('.price_old_value');
        for (var i = 0; i < ov.length; i++) ov[i].textContent = c.oldPrice;
        var oc = document.querySelectorAll('.price_old_currency');
        for (var i = 0; i < oc.length; i++) oc[i].textContent = c.labelPrice;

        var phones = document.querySelectorAll('input[name="phone"]');
        for (var i = 0; i < phones.length; i++) {
            if (c.phoneHelper) phones[i].setAttribute('placeholder', c.phoneHelper);
        }
    }

    window.applyCountry = applyCountry;
})();
