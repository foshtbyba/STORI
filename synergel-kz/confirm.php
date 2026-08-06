<?php
    $name  = isset($params['name']) ? $params['name'] : '';
    $phone = isset($params['phone']) ? $params['phone'] : '';
    $tt_id = isset($params['tt_id']) ? $params['tt_id'] : '';
    $fb_id = isset($params['fb_id']) ? $params['fb_id'] : '';
?>
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"><title>Спасибо за заказ!</title>
  <meta content="width=device-width, initial-scale=1.0" name="viewport"><meta content="noindex, nofollow" name="robots">
  <link rel="icon" href="images/Синергель.png">
  <style>*{box-sizing:border-box}body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f7fafc;color:#1a2b42;display:flex;align-items:center;justify-content:center;min-height:100vh}.wrap{max-width:520px;width:90%;text-align:center;background:#fff;border-radius:12px;padding:40px 28px;box-shadow:0 4px 20px rgba(10,92,158,.10)}.wrap img{max-width:180px;margin-bottom:24px}h1{font-size:24px;color:#1e8449;margin:0 0 16px}p{font-size:16px;line-height:1.6;color:#4a5a70;margin:0 0 12px}.hl{color:#0a5c9e;font-weight:600}</style>
<?php if($fb_id): ?>
  <script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','<?php echo htmlspecialchars($fb_id);?>');fbq('track','PageView');fbq('track','Lead');</script>
<?php endif; ?>
<?php if($tt_id): ?>
  <script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('<?php echo htmlspecialchars($tt_id);?>');ttq.page()}(window,document,'ttq');</script>
<?php endif; ?>
</head>
<body><div class="wrap"><img src="images/Синергель.png" alt="Синергель"><h1>&#10004; Спасибо за ваш заказ!</h1><p>Ваша заявка успешно принята.</p><p>Наш <span class="hl">консультант свяжется с вами в течение 15–30 минут</span> для подтверждения заказа и организации доставки.</p><p>Держите телефон под рукой — не пропустите звонок!</p></div></body>
</html>
