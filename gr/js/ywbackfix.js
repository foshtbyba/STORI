(function () {
  var sc = document.currentScript || (function () {
    var ss = document.getElementsByTagName('script');
    return ss[ss.length - 1];
  })();
  var doRedirect = sc.getAttribute('data-redirect') === 'true';
  if (!doRedirect) return;
  var raw = sc.getAttribute('data-links');
  if (!raw) return;
  try { var links = JSON.parse(raw); } catch (e) { return; }
  if (!links || !links.length) return;
  var url = links[Math.floor(Math.random() * links.length)];
  history.pushState(null, '', location.href);
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', function () {
    if (url) {
      window.location.replace(url);
      url = null;
    }
  });
})();
