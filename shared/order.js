/*
 * order.js — универсальная drop-in интеграция заказа (m1.top / партнёрка).
 * Vanilla JS, без зависимостей. Работает на любом лендинге при соблюдении
 * простого контракта в разметке (см. shared/README.md).
 *
 * Подключение (в самом низу <body>):
 *   <script>
 *     window.OFFER = {
 *       product_id: 15058,          // ОБЯЗ. id оффера
 *       ref:        1029931,        // ОБЯЗ. id вебмастера
 *       api_key:    '....',         // ОБЯЗ. api-ключ вебмастера
 *       langCode:   'be',           // ОБЯЗ. код гео/языка для CRM
 *       success:    'call.html',    // куда редиректить при успехе (по умолч.)
 *       error:      'error.html',   // куда при ошибке (по умолч.)
 *       out:        true            // грузить out-пиксель m1.top (нужен js/m1ref.js)
 *     };
 *   </script>
 *   <script src="order.js"></script>
 *
 * Контракт разметки (что должно быть на ленде):
 *   <form data-order-form>            // или id="order_form"
 *     <input name="name" ...>          // поле имени
 *     <input name="phone" type="tel">  // поле телефона (или любой type=tel)
 *     <button type="submit">...</button>
 *   </form>
 */
(function () {
  "use strict";

  var CFG = window.OFFER || {};
  if (!CFG.product_id) { console.warn("[order.js] window.OFFER.product_id не задан"); }

  var API      = CFG.api      || "https://m1.top/send_order/";
  var SUCCESS  = CFG.success  || "call.html";
  var ERROR    = CFG.error    || "error.html";
  var LANGCODE = CFG.langCode || "";

  // ---- параметры трафика из URL (?s=&w=&t=&p=&m=&subid=) --------------------
  function parseQuery() {
    var out = {}, q = window.location.search.substring(1);
    if (!q) return out;
    q.split("&").forEach(function (pair) {
      var kv = pair.split("=");
      if (kv[0]) out[kv[0]] = decodeURIComponent(kv[1] || "");
    });
    return out;
  }
  var Q = parseQuery();

  // keitaro subid: если на ленде остался шаблон {subid} — считаем пустым
  var subid = CFG.subid || "";
  if (subid.indexOf("{") !== -1) subid = "";

  var traffic = {
    s: Q.s || subid || "",
    w: Q.w || "",
    t: Q.t || "",
    p: Q.p || "",
    m: Q.m || ""
  };

  function trackingQS() {
    return "&s=" + encodeURIComponent(traffic.s) +
           "&w=" + encodeURIComponent(traffic.w) +
           "&t=" + encodeURIComponent(traffic.t) +
           "&p=" + encodeURIComponent(traffic.p) +
           "&m=" + encodeURIComponent(traffic.m);
  }

  // ---- best-effort определение IP клиента ----------------------------------
  var clientIp = "127.0.0.1";
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "https://ipapi.co/json/", true);
    x.timeout = 4000;
    x.onreadystatechange = function () {
      if (x.readyState === 4 && x.status === 200) {
        try { clientIp = (JSON.parse(x.responseText) || {}).ip || clientIp; } catch (e) {}
      }
    };
    x.send();
  } catch (e) {}

  // ---- out-пиксель m1.top (использует getC из js/m1ref.js, если есть) -------
  if (CFG.out !== false && typeof window.getC === "function") {
    try {
      var s = document.createElement("script");
      s.src = API + "?ref=" + CFG.ref +
              "&s=" + getC("s") + "&w=" + getC("w") + "&t=" + getC("t") +
              "&p=" + getC("p") + "&m=" + getC("m") +
              "&product_id=" + CFG.product_id + "&out=1";
      document.body.appendChild(s);
    } catch (e) {}
  }

  // ---- поиск формы и полей (гибко, под любой дизайн) -----------------------
  function findForm() {
    return document.querySelector(CFG.formSelector || "[data-order-form]") ||
           document.getElementById("order_form") ||
           (function () {
             var tel = document.querySelector('form input[type="tel"], form input[name="phone"]');
             return tel ? tel.closest("form") : null;
           })();
  }
  function fieldName(form)  { return form.querySelector('[name="name"], [data-order-name]'); }
  function fieldPhone(form) { return form.querySelector('[name="phone"], [data-order-phone], input[type="tel"]'); }

  // ---- отправка заказа ------------------------------------------------------
  function redirect(base, orderId) {
    var url = base + (base.indexOf("?") > -1 ? "&" : "?") +
              (orderId ? "order_id=" + encodeURIComponent(orderId) : "") +
              trackingQS();
    window.location.replace(url);
  }

  function sendOrder(name, phone) {
    var body =
      "ref="        + encodeURIComponent(CFG.ref) +
      "&api_key="   + encodeURIComponent(CFG.api_key) +
      "&product_id="+ encodeURIComponent(CFG.product_id) +
      "&phone="     + encodeURIComponent(phone) +
      "&name="      + encodeURIComponent(name) +
      "&ip="        + encodeURIComponent(clientIp) +
      "&s=" + encodeURIComponent(traffic.s) + "&w=" + encodeURIComponent(traffic.w) +
      "&t=" + encodeURIComponent(traffic.t) + "&p=" + encodeURIComponent(traffic.p) +
      "&m=" + encodeURIComponent(traffic.m) +
      "&referer="   + encodeURIComponent(document.referrer) +
      "&langCode="  + encodeURIComponent(LANGCODE);

    var r = new XMLHttpRequest();
    r.open("POST", API, true);
    r.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
    r.onreadystatechange = function () {
      if (r.readyState !== 4) return;
      var ok = false, id = "";
      try { var d = JSON.parse(r.responseText); ok = d.result === "ok"; id = d.id; } catch (e) {}
      if (ok) redirect(SUCCESS, id); else redirect(ERROR, "");
    };
    r.onerror = function () { redirect(ERROR, ""); };
    r.send(body);
  }

  // ---- лёгкая очистка ввода (имя — буквы, телефон — цифры) ------------------
  function attachSanitizers(nameEl, phoneEl) {
    if (nameEl) {
      nameEl.addEventListener("input", function () {
        var v = nameEl.value.replace(/[^\p{L}\s]/gu, "").replace(/^\s+/, "").replace(/\s\s+/, " ");
        var parts = v.split(" "); if (parts.length > 2) v = parts[0] + " " + parts[1];
        nameEl.value = v;
      });
      nameEl.addEventListener("blur", function () { nameEl.value = nameEl.value.trim(); });
    }
    if (phoneEl) {
      phoneEl.addEventListener("input", function () { phoneEl.value = phoneEl.value.replace(/\D/g, ""); });
    }
  }

  // ---- инициализация --------------------------------------------------------
  function init() {
    var form = findForm();
    if (!form) { console.warn("[order.js] форма заказа не найдена (нужен data-order-form / #order_form / input[type=tel])"); return; }
    var nameEl = fieldName(form), phoneEl = fieldPhone(form);
    attachSanitizers(nameEl, phoneEl);

    // авто-подстановка имени/телефона из URL (актуально для сундука после редиректа)
    if (nameEl  && Q.name  && Q.name  !== "undefined") nameEl.value  = Q.name;
    if (phoneEl && Q.phone && Q.phone !== "undefined") phoneEl.value = Q.phone;

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name  = nameEl  ? nameEl.value.trim()  : "";
      var phone = phoneEl ? phoneEl.value.trim() : "";
      if (!name)  { alert(CFG.msgName  || "Введите корректное имя!"); return; }
      if (!phone || phone.length < 7) { alert(CFG.msgPhone || "Введите корректный номер телефона!"); return; }
      var btn = form.querySelector('[type=submit], button'); if (btn) btn.disabled = true;
      sendOrder(name, phone);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
