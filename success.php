<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>تم استلام طلبك بنجاح — JoActive</title>
  <meta content="width=device-width, initial-scale=1.0" name="viewport">
  <meta content="noindex, nofollow" name="robots">
  <link rel="icon" href="images/JoActive.png?=v1">
  <style>
    :root {
      --color-primary: #0a5c9e;
      --color-primary-dark: #084678;
      --color-primary-light: #e8f2fa;
      --color-success: #1e8449;
      --color-success-light: #e8f5ee;
      --color-text: #1a2b42;
      --color-text-muted: #4a5a70;
      --color-bg: #ffffff;
      --color-bg-soft: #f7fafc;
      --color-border: #d9e2ec;
      --radius-md: 8px;
      --radius-lg: 12px;
      --shadow-lg: 0 10px 25px rgba(10,92,158,0.10), 0 4px 10px rgba(10,92,158,0.05);
      --font-sans: 'Segoe UI', Tahoma, 'Noto Naskh Arabic', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      --font-serif: 'Noto Naskh Arabic', Georgia, 'Times New Roman', serif;
    }
    * { box-sizing: border-box; }
    body { margin:0; padding:0; direction:rtl; font-family:var(--font-sans); font-size:17px; line-height:1.75; color:var(--color-text); background:var(--color-bg-soft); }
    .topbar { background:var(--color-primary-dark); color:#fff; font-size:12px; padding:8px 16px; text-align:center; font-weight:500; }
    .container { max-width:700px; margin:40px auto; padding:0 20px; }
    .card { background:#fff; border-radius:var(--radius-lg); box-shadow:var(--shadow-lg); overflow:hidden; text-align:center; }
    .card-header { background:var(--color-success); color:#fff; padding:30px 24px; }
    .card-header h1 { font-family:var(--font-serif); font-size:26px; margin:0 0 8px; font-weight:700; }
    .card-header p { margin:0; font-size:16px; opacity:0.9; }
    .checkmark { font-size:64px; margin-bottom:16px; display:block; }
    .card-body { padding:30px 24px; }
    .card-body p { margin:0 0 16px; font-size:16px; color:var(--color-text-muted); }
    .card-body .highlight { background:var(--color-success-light); border:1px solid rgba(30,132,73,0.2); border-radius:var(--radius-md); padding:16px 20px; margin:20px 0; text-align:right; }
    .card-body .highlight p { margin:0 0 8px; color:var(--color-text); }
    .card-body .highlight p:last-child { margin:0; }
    .card-body .highlight b { color:var(--color-success); }
    .steps { text-align:right; margin:24px 0 0; padding:0; list-style:none; counter-reset:step; }
    .steps li { padding:12px 50px 12px 0; border-bottom:1px solid #eef2f7; position:relative; counter-increment:step; font-size:15px; }
    .steps li::before { content:counter(step); position:absolute; right:0; top:10px; width:34px; height:34px; background:var(--color-primary-light); color:var(--color-primary-dark); border-radius:50%; font-weight:700; font-size:15px; display:flex; align-items:center; justify-content:center; border:2px solid var(--color-primary); }
    .steps li:last-child { border-bottom:0; }
    .footer { text-align:center; padding:20px; font-size:12px; color:var(--color-text-muted); }
    @media (max-width:500px) { .card-header h1 { font-size:22px; } .container { margin:20px auto; } }
  </style>

  <!-- Meta Pixel -->
  <script>
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}
    (window,document,'script','https://connect.facebook.net/en_US/fbevents.js');

    (function(){
      var params = new URLSearchParams(window.location.search);
      var p = params.get('fbpxl');
      if (!p) try { p = localStorage.getItem('fb_pixel'); } catch(e) {}
      if (p) {
        fbq('init', p);
        fbq('track', 'Lead');
      }
    })();
  </script>
  <!-- End Meta Pixel -->
</head>
<body>
  <div class="topbar">JoActive — طلبك قيد المعالجة</div>

  <div class="container">
    <div class="card">
      <div class="card-header">
        <span class="checkmark">&#10004;</span>
        <h1>تم استلام طلبك بنجاح!</h1>
        <p>شكرًا لثقتك — سنتواصل معك قريبًا جدًّا</p>
      </div>
      <div class="card-body">
        <div class="highlight">
          <p><b>ماذا يحدث الآن؟</b></p>
          <p>سيتّصل بك أحد مستشارينا خلال <b>15 إلى 30 دقيقة</b> لتأكيد الطلب وترتيب الشحن إلى عنوانك.</p>
        </div>

        <ol class="steps">
          <li>سيتّصل بك المستشار لتأكيد بياناتك وعنوان الشحن</li>
          <li>يتمّ تجهيز طلبك وشحنه خلال يوم عمل واحد</li>
          <li>يصلك الطرد عبر البريد السريع خلال 2 إلى 3 أيّام</li>
          <li>الدفع عند الاستلام — لا تدفع شيئًا مقدّمًا</li>
        </ol>

        <p style="margin-top:24px">
          <b>يُرجى إبقاء هاتفك مفتوحًا</b> حتى يتمكّن المستشار من الاتّصال بك.
        </p>
      </div>
    </div>

    <div class="footer">
      © صحّة السعودية — JoActive<br>
      المعلومات الواردة ذات طابع إعلاميّ ولا تُغني عن استشارة الطبيب.
    </div>
  </div>
</body>
</html>
