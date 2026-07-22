<?php
$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
$domain = 'shakes.pro';
$landingUrl = 'https://co1v3-joinflex.jointssh.com';
$offerId = '19784';
$streamCode = '';
$successPage = 'success.html';
$errorPage = 'index.html';

$name = isset($_POST['name']) ? trim($_POST['name']) : '';
$phone = isset($_POST['phone']) ? trim($_POST['phone']) : '';
$country = isset($_POST['country']) ? trim($_POST['country']) : 'CO';
$sub1 = isset($_POST['sub1']) ? trim($_POST['sub1']) : '';

$data = [
    'api_key'     => $apiKey,
    'offer_id'    => $offerId,
    'landing_url' => $landingUrl,
    'name'        => $name,
    'phone'       => $phone,
    'country'     => $country,
    'sub1'        => $sub1,
];

if ($streamCode !== '') {
    $data['stream_code'] = $streamCode;
}

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, "https://{$domain}/api/v2/order/create");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($data));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);
$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);

if ($httpCode === 200 && isset($result['status']) && $result['status'] === 'success') {
    header("Location: {$successPage}");
} else {
    header("Location: {$errorPage}");
}
exit;
