<?php
// ===== KMA API Configuration =====
$config = [
    'token'    => 'YOUR_TOKEN_HERE',   // KMA API token — replace
    'offer_id' => '',                   // Artonova offer ID — replace
    'api_url'  => 'https://api.kma.biz/',
    'method'   => 'order.create',       // API method — verify with KMA docs
];

$name    = isset($_POST['name'])    ? trim($_POST['name'])    : '';
$phone   = isset($_POST['phone'])   ? trim($_POST['phone'])   : '';
$country = isset($_POST['country']) ? trim($_POST['country']) : 'AM';
$subid   = isset($_POST['subid'])   ? trim($_POST['subid'])   : '';

if (empty($name) || empty($phone)) {
    header('Location: error.html');
    exit;
}

$params = http_build_query([
    'method'   => $config['method'],
    'token'    => $config['token'],
    'name'     => $name,
    'phone'    => $phone,
    'country'  => $country,
    'sub_id'   => $subid,
    'offer_id' => $config['offer_id'],
    'price'    => '19500',
    'currency' => 'AMD',
]);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $config['api_url'],
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $params,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_SSL_VERIFYPEER => true,
]);

$response  = curl_exec($ch);
$curl_err  = curl_error($ch);
curl_close($ch);

$result = json_decode($response, true);

if ($result && isset($result['code']) && $result['code'] == 0) {
    $redirect = 'success.html';
    if (!empty($subid)) $redirect .= '?subid=' . urlencode($subid);
    header('Location: ' . $redirect);
} else {
    header('Location: error.html');
}
exit;
