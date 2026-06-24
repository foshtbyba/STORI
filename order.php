<?php

/**
 * Базовая конфигурация
 */
// API-ключ Вашего аккаунта
$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
// Домен проекта, на который происходит отправка заказов
$domain = 'shakes.pro';
// URL оригинального лендинга, необходим для корректного расчета Вашей статистики
$landingUrl = 'https://ng1-posteron.prostsh.com';
// Идентификатор оффера на который Вы льете (Posteron, NG)
$offerId = '14609';
// Код потока заведенного в системе, если указан, статистика будет записываться на данный поток
$streamCode = '';
// Страница, отдаваемая при успешном заказе
$successPage = 'success.html';
// Страница, отдаваемая в случае ошибки
$errorPage = 'index.html';

/**
 * Формирование отправляемого заказа
 */
$url = "http://$domain?r=/api/order/in&key=$apiKey";
$order = [
    'createdAt' => date('Y-m-d H:i:s'),
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'ip' => (!empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : null), // ip пользователя
    'referrer' => (!empty($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : null),
    'userAgent' => (!empty($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '-'),
    'name' => (!empty($_POST['name']) ? $_POST['name'] : ($_GET['name'] ? $_GET['name'] : '')),
    'phone' => (!empty($_POST['phone']) ? $_POST['phone'] : ($_GET['phone'] ? $_GET['phone'] : '')),
    'countryCode' => (!empty($_POST['country']) ? $_POST['country'] : ($_GET['country'] ? $_GET['country'] : 'NG')),
    'comment' => (!empty($_POST['comment']) ? $_POST['comment'] : ($_GET['comment'] ? $_GET['comment'] : '')),
    'sub1' => (!empty($_POST['sub1']) ? $_POST['sub1'] : ($_GET['sub1'] ? $_GET['sub1'] : '')),
    'sub2' => (!empty($_POST['sub2']) ? $_POST['sub2'] : ($_GET['sub2'] ? $_GET['sub2'] : '')),
    'sub3' => (!empty($_POST['sub3']) ? $_POST['sub3'] : ($_GET['sub3'] ? $_GET['sub3'] : '')),
    'sub4' => (!empty($_POST['sub4']) ? $_POST['sub4'] : ($_GET['sub4'] ? $_GET['sub4'] : '')),
];

/**
 * Отправка заказа
 * @see http://php.net/manual/ru/book.curl.php
 */
$curl = curl_init();
/**
 * @see http://php.net/manual/ru/function.curl-setopt.php
 */
curl_setopt($curl, CURLOPT_URL, $url);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $order);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
/**
 * @see http://php.net/manual/ru/language.exceptions.php
 */
try {
    $responseBody = curl_exec($curl);

    // тело оказалось пустым
    if (empty($responseBody)) {
        throw new Exception('Error: Empty response for order. ' . var_export($order, true));
    }
    /**
     * @var StdClass $response
     */
    $response = json_decode($responseBody, true);
    // возможно пришел некорректный формат
    if (empty($response)) {
        throw new Exception('Error: Broken json format for order. ' . PHP_EOL . var_export($order, true));
    }
    // заказ не принят API
    if ($response['status'] != 'ok') {
        throw new Exception('Success: Order is accepted. '
            . PHP_EOL . 'Order: ' . var_export($order, true)
            . PHP_EOL . 'Response: ' . var_export($response, true)
        );
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
