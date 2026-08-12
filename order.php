<?php
header('Content-Type: text/html; charset=utf-8');

$kma_token = 'C1z9J8bVZbdQAB-weqUV043f1GQz3iSC';
$kma_offer = 'aUoKXZ';

$name    = isset($_POST['name'])    ? trim($_POST['name'])    : '';
$phone   = isset($_POST['phone'])   ? trim($_POST['phone'])   : '';
$country = isset($_POST['country']) ? trim($_POST['country']) : 'AM';
$subid   = isset($_POST['subid'])   ? trim($_POST['subid'])   : '';
$ip      = $_SERVER['REMOTE_ADDR'];
$ua      = $_SERVER['HTTP_USER_AGENT'];

if (empty($name) || empty($phone)) {
    header('Location: error.html');
    exit;
}

$api_url = 'https://api.kma.biz/';
$params = [
    'method'    => 'order.create',
    'token'     => $kma_token,
    'offer_id'  => $kma_offer,
    'name'      => $name,
    'phone'     => $phone,
    'country'   => $country,
    'ip'        => $ip,
    'ua'        => $ua,
    'sub_id'    => $subid,
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $api_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$result = json_decode($response, true);

if ($result && isset($result['code']) && $result['code'] == 0) {
    header('Location: success.html');
} else {
    header('Location: error.html');
}
exit;
