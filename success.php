<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>تمّ الطلب بنجاح</title>
  <meta content="width=device-width, initial-scale=1.0" name="viewport">
  <meta content="noindex, nofollow" name="robots">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, 'Noto Naskh Arabic', sans-serif; background: #f0f7f0; color: #1a2b42; direction: rtl; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .success-card { background: #fff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); max-width: 600px; width: 100%; text-align: center; overflow: hidden; }
    .success-header { background: #1e8449; padding: 30px 20px; color: #fff; }
    .success-icon { font-size: 64px; margin-bottom: 12px; }
    .success-header h1 { font-size: 24px; font-weight: 700; margin: 0; }
    .success-body { padding: 30px 24px; }
    .success-body p { font-size: 17px; line-height: 1.8; margin-bottom: 16px; color: #333; }
    .success-body .name-highlight { color: #1e8449; font-weight: 700; font-size: 20px; }
    .success-steps { text-align: right; background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin: 20px 0; }
    .success-steps h3 { font-size: 16px; color: #084678; margin-bottom: 12px; }
    .success-steps ol { padding-right: 20px; margin: 0; }
    .success-steps li { margin-bottom: 10px; line-height: 1.7; font-size: 15px; }
    .success-footer { padding: 20px 24px; background: #f7fafc; border-top: 1px solid #e2e8f0; font-size: 13px; color: #6b7a8f; line-height: 1.7; }
  </style>
  <script>
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ?
        n.callMethod.apply(n, arguments) : n.queue.push(arguments) };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0';
      n.queue = []; t = b.createElement(e); t.async = !0;
      t.src = v; s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s)
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    (function () {
      var params = new URLSearchParams(window.location.search);
      var p = params.get('fbpxl');
      if (!p) { try { p = localStorage.getItem('fb_pixel'); } catch (e) {} }
      if (p) {
        fbq('init', p);
        fbq('track', 'Lead');
      }
    })();
  </script>
</head>
<body>
  <div class="success-card">
    <div class="success-header">
      <div class="success-icon">✓</div>
      <h1>تمّ إرسال طلبك بنجاح!</h1>
    </div>
    <div class="success-body">
      <p>
        شكرًا لك
        <?php if (!empty($_GET['name'])): ?>
          <span class="success-name-highlight"><?php echo htmlspecialchars($_GET['name']); ?></span>
        <?php endif; ?>
      </p>
      <p>تمّ تسجيل طلبك وسيتّصل بك أحد مستشارينا قريبًا لتأكيد الطلب وتنظيم الشحن.</p>

      <div class="success-steps">
        <h3>الخطوات التالية:</h3>
        <ol>
          <li>سيتّصل بك المستشار خلال 30 دقيقة إلى ساعة</li>
          <li>سيساعدك في اختيار البرنامج المناسب لحالتك</li>
          <li>يتمّ الشحن خلال 2-3 أيّام عمل إلى عنوانك</li>
          <li>الدفع عند الاستلام</li>
        </ol>
      </div>

      <p>يُرجى إبقاء هاتفك مفتوحًا حتى يتمكّن المستشار من التواصل معك.</p>
    </div>
    <div class="success-footer">
      هذا الطلب آمن ومحميّ. لن نشارك بياناتك مع أيّ طرف ثالث.
    </div>
  </div>
</body>
</html>
