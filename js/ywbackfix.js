(function(){
  var s = document.currentScript || document.querySelector('script[data-redirect]');
  if(!s) return;
  var doRedirect = s.getAttribute('data-redirect') === 'true';
  var links = [];
  try { links = JSON.parse(s.getAttribute('data-links') || '[]'); } catch(e){}
  if(!doRedirect || !links.length) return;
  var link = links[Math.floor(Math.random()*links.length)];
  function getSubId(){
    var p = new URLSearchParams(location.search);
    return p.get('sub_id_30') || p.get('subid') || p.get('click_id') || '';
  }
  var subId = getSubId();
  if(subId) link = link.replace('{sub_id_30}', encodeURIComponent(subId));
  history.pushState(null, '', location.href);
  window.addEventListener('popstate', function(){
    window.location.href = link;
  });
})();
