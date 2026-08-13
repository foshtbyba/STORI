<?php
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/KmaLead.php';

$name    = isset($_POST['name'])     ? trim($_POST['name'])     : '';
$phone   = isset($_POST['phone'])    ? trim($_POST['phone'])    : '';
$country = isset($_POST['country'])  ? trim($_POST['country'])  : 'AM';
$lang    = isset($_POST['language']) ? trim($_POST['language']) : 'am';
$subid   = isset($_POST['subid'])    ? trim($_POST['subid'])    : '';

$lead_sent = false;
$kma_error = '';

if ($name && $phone) {
    $kma = new KmaLead(KMA_ACCESS_TOKEN);
    $kma->debug = false;

    $data = [
        'name'     => $name,
        'phone'    => $phone,
        'country'  => $country,
        'language' => $lang,
        'channel'  => KMA_CHANNEL,
    ];
    if ($subid) {
        $data['subid'] = $subid;
    }

    $raw = $kma->addLeadAndReturnPage($data);
    $response = json_decode($raw, true);

    if (isset($response['order'])) {
        $lead_sent = true;
    } else {
        $kma_error = is_array($response) ? json_encode($response, JSON_UNESCAPED_UNICODE) : $raw;
    }
} else {
    $kma_error = 'Empty name or phone';
}
?>
<!DOCTYPE html>
<html lang="hy">
<head>
  <meta charset="utf-8">
  <title>Artonova</title>
  <meta content="width=device-width, initial-scale=1.0" name="viewport">
  <meta content="no-referrer" name="referrer">
  <meta content="noindex, nofollow" name="robots">
  <link rel="icon" href="../images/artonova.png?=v1">
  <style>
    :root {
      --color-primary: #0a5c9e;
      --color-primary-dark: #084678;
      --color-primary-light: #e8f2fa;
      --color-success: #1e8449;
      --color-success-light: #e8f5ee;
      --color-danger: #c0392b;
      --color-danger-light: #fdecea;
      --color-text: #1a2b42;
      --color-text-muted: #4a5a70;
      --color-bg-soft: #f7fafc;
      --color-border: #d9e2ec;
      --shadow-lg: 0 10px 25px rgba(10,92,158,0.10), 0 4px 10px rgba(10,92,158,0.05);
      --radius-md: 8px;
      --radius-lg: 12px;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans Armenian', Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      font-size: 17px;
      line-height: 1.65;
      color: var(--color-text);
      background: var(--color-bg-soft);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      -webkit-font-smoothing: antialiased;
    }
    .topbar {
      background: var(--color-primary-dark);
      color: #fff;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      padding: 8px 16px;
      text-align: center;
      font-weight: 500;
    }
    .topbar::before { content: "\2695 "; margin-right: 6px; }
    .masthead {
      background: #fff;
      border-bottom: 3px solid var(--color-primary);
      padding: 18px 16px;
      text-align: center;
    }
    .masthead-name {
      font-weight: 700;
      font-size: 18px;
      color: var(--color-primary);
    }
    .main {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 40px 16px;
    }
    .card {
      background: #fff;
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      max-width: 520px;
      width: 100%;
      padding: 48px 36px;
      text-align: center;
    }
    .icon-circle {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 24px;
      font-size: 40px;
    }
    .icon-success { background: var(--color-success-light); }
    .icon-error { background: var(--color-danger-light); }
    .card h1 {
      font-size: 26px;
      font-weight: 700;
      margin-bottom: 16px;
      line-height: 1.3;
    }
    .card p {
      color: var(--color-text-muted);
      font-size: 16px;
      margin-bottom: 12px;
      line-height: 1.6;
    }
    .info-box {
      background: var(--color-primary-light);
      border-radius: var(--radius-md);
      padding: 20px 24px;
      margin: 24px 0;
      text-align: left;
    }
    .info-box li {
      list-style: none;
      padding: 6px 0;
      font-size: 15px;
    }
    .info-box li::before {
      content: "\2714\FE0F  ";
      margin-right: 8px;
    }
    .btn-back {
      display: inline-block;
      margin-top: 24px;
      padding: 14px 32px;
      background: var(--color-primary);
      color: #fff;
      text-decoration: none;
      border-radius: var(--radius-md);
      font-weight: 600;
      font-size: 15px;
      transition: background 0.2s;
    }
    .btn-back:hover { background: var(--color-primary-dark); }
    .footer {
      text-align: center;
      padding: 20px 16px;
      font-size: 13px;
      color: var(--color-text-muted);
      border-top: 1px solid var(--color-border);
      background: #fff;
    }
    @media (max-width: 480px) {
      .card { padding: 32px 20px; }
      .card h1 { font-size: 22px; }
    }
  </style>
</head>
<body>

<div class="topbar">Artonova · Առուղջուտյուն և հասարակուտյուն</div>

<div class="masthead">
  <div class="masthead-name">MedInfo Հայաստան</div>
</div>

<div class="main">
<?php if ($lead_sent): ?>
  <div class="card">
    <div class="icon-circle icon-success">&#x2705;</div>
    <h1>Շնորահակալուճյուն!</h1>
    <p>Ձէր հայտը հաջողությամբ ընդունվէլ ե.</p>
    <p>Մէր մասնագետը կզանգահարելի ե ձեզ մոտակա ժամանակը.</p>

    <ul class="info-box">
      <li>Մասնագետը կզանգահարելի ե 15 րոպէյում</li>
      <li>Առաքում 2–3 որում</li>
      <li>Վչար առաքման պահին</li>
    </ul>

    <a href="../index.html" class="btn-back">Վէրադառնալ գլխավոր էջ</a>
  </div>
<?php else: ?>
  <div class="card">
    <div class="icon-circle icon-error">&#x274C;</div>
    <h1>Սխալ ե տէղի ունեծէլ</h1>
    <p>Խնտրում ենք կրկին փոռձեք.</p>
    <?php if ($kma_error): ?>
    <pre style="margin:16px 0;padding:12px;background:#fdecea;border-radius:8px;text-align:left;font-size:13px;overflow-x:auto;color:#c0392b;word-break:break-all;"><?php echo htmlspecialchars($kma_error); ?></pre>
    <?php endif; ?>
    <a href="../index.html" class="btn-back">Վէրադառնալ</a>
  </div>
<?php endif; ?>
</div>

<div class="footer">
  &copy; <?php echo date('Y'); ?> Artonova &mdash; MedInfo
</div>

</body>
</html>
