<?php
$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
$domain = 'shakes.pro';
$landingUrl = 'https://pt1.hondroten.jointssh.com/';
$offerId = '17814';
$streamCode = '';
$successPage = 'success.html';
$errorPage = 'index.html';

$name = isset($_POST['name']) ? trim($_POST['name']) : '';
$phone = isset($_POST['phone']) ? trim($_POST['phone']) : '';
$sub1 = isset($_POST['sub1']) ? trim($_POST['sub1']) : '';
$country = isset($_POST['country']) ? trim($_POST['country']) : '';

$url = "http://$domain?r=/api/order/in&key=$apiKey";

$postData = [
    'name' => $name,
    'phone' => $phone,
    'ip' => $_SERVER['REMOTE_ADDR'] ?? '',
    'countryCode' => $country,
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'sub1' => $sub1,
];

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL => $url,
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => http_build_query($postData),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 15,
]);
$result = curl_exec($ch);
curl_close($ch);

$response = json_decode($result, true);

if (!$response || $response['status'] != 'ok') {
    include __DIR__ . '/' . $errorPage;
    exit;
}

include __DIR__ . '/' . $successPage;
