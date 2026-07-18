<?php

$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
$domain = 'shakes.pro';
$landingUrl = 'https://bg1-benagachaga.jointssh.com';
$offerId = '16764';
$streamCode = '';
$successPage = 'success.html';
$errorPage = 'index.html';

$url = "http://$domain?r=/api/order/in&key=$apiKey";
$order = [
    'createdAt' => date('Y-m-d H:i:s'),
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'ip' => (!empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : null),
    'referrer' => (!empty($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : null),
    'userAgent' => (!empty($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '-'),
    'name' => (!empty($_POST['name']) ? $_POST['name'] : ($_GET['name'] ? $_GET['name'] : '')),
    'phone' => (!empty($_POST['phone']) ? $_POST['phone'] : ($_GET['phone'] ? $_GET['phone'] : '')),
    'countryCode' => (!empty($_POST['country']) ? $_POST['country'] : ($_GET['country'] ? $_GET['country'] : 'BG')),
    'comment' => (!empty($_POST['comment']) ? $_POST['comment'] : ($_GET['comment'] ? $_GET['comment'] : '')),
    'sub1' => (!empty($_POST['sub1']) ? $_POST['sub1'] : ($_GET['sub1'] ? $_GET['sub1'] : '')),
    'sub2' => (!empty($_POST['sub2']) ? $_POST['sub2'] : ($_GET['sub2'] ? $_GET['sub2'] : '')),
    'sub3' => (!empty($_POST['sub3']) ? $_POST['sub3'] : ($_GET['sub3'] ? $_GET['sub3'] : '')),
    'sub4' => (!empty($_POST['sub4']) ? $_POST['sub4'] : ($_GET['sub4'] ? $_GET['sub4'] : '')),
];

$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $url);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $order);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
try {
    $responseBody = curl_exec($curl);

    if (empty($responseBody)) {
        throw new Exception('Error: Empty response for order.');
    }
    $response = json_decode($responseBody, true);
    if (empty($response)) {
        throw new Exception('Error: Broken json format for order.');
    }
    if ($response['status'] != 'ok') {
        throw new Exception('Error: Order rejected.');
    }
    curl_close($curl);

    if (!empty($successPage) && is_file(__DIR__ . '/' . $successPage)) {
        include __DIR__ . '/' . $successPage;
    }
} catch (Exception $e) {
    if (!empty($errorPage) && is_file(__DIR__ . '/' . $errorPage)) {
        include __DIR__ . '/' . $errorPage;
    }
}
