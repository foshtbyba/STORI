<?php

$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
$domain = 'shakes.pro';
$landingUrl = 'https://eu1hu-cordycepspulse.jointssx.com/';
$offerId = '25726';
$streamCode = '';
$successPage = 'success.html';
$errorPage = 'index.html';

$url = "https://$domain?r=/api/order/in&key=$apiKey";
if (!empty($_POST['country'])) {
    $countryCode = $_POST['country'];
} else if (!empty($_GET['country'])) {
    $countryCode = $_GET['country'];
} else {
    $countryCode = 'AT';
}
$order = [
    'countryCode' => $countryCode,
    'createdAt' => date('Y-m-d H:i:s'),
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'ip' => (!empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : null),
    'referrer' => (!empty($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : null),
    'userAgent' => (!empty($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '-'),
];
$params = [
    'name' => '', 'phone' => '', 'comment' => '',
    'sub1' => '', 'sub2' => '', 'sub3' => '', 'sub4' => '',
];
foreach ($params as $name => $defaultValue) {
    if (!empty($_POST[$name])) {
        $order[$name] = $_POST[$name];
    } else if (!empty($_GET[$name])) {
        $order[$name] = $_GET[$name];
    } else {
        $order[$name] = $defaultValue;
    }
}

$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $url);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $order);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
curl_setopt($curl, CURLOPT_USERAGENT, 'curl/' . (curl_version()['version'] ?? '7'));
try {
    $responseBody = curl_exec($curl);
    @file_put_contents(
        __DIR__ . '/shakes.response.log',
        date('Y.m.d H:i:s') . PHP_EOL . $responseBody,
        FILE_APPEND
    );
    if (empty($responseBody)) {
        throw new Exception('Error: Empty response for order. ' . var_export($order, true));
    }
    $response = json_decode($responseBody, true);
    if (empty($response)) {
        throw new Exception('Error: Broken json format for order. ' . PHP_EOL . var_export($order, true));
    }
    if ($response['status'] !== 'ok') {
        throw new Exception('Error: Order is not accepted. '
            . PHP_EOL . 'Order: ' . var_export($order, true)
            . PHP_EOL . 'Response: ' . var_export($response, true)
        );
    }
    @file_put_contents(
        __DIR__ . '/order.success.log',
        date('Y.m.d H:i:s') . ' ' . $responseBody,
        FILE_APPEND
    );
    curl_close($curl);
    if(!empty($successPage) && is_file(__DIR__ . '/' . $successPage)) {
        include __DIR__ . '/' . $successPage;
    }
} catch (Exception $e) {
    @file_put_contents(
        __DIR__ . '/order.error.log',
        date('Y.m.d H:i:s') . ' ' . $e->getMessage() . PHP_EOL . $e->getTraceAsString(),
        FILE_APPEND
    );
    if(!empty($errorPage) && is_file(__DIR__ . '/' . $errorPage)) {
        include __DIR__ . '/' . $errorPage;
    }
}
