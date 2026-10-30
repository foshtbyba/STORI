<?php

/**
 * SHAKES.PRO — order.php: отправка заказа со своего лендинга по API.
 * Sending an order from a landing page via the API.
 *
 * Заполняются 5 значений, помеченных цифрами 1–5: четыре в блоке «Базовая конфигурация»
 * и страна по умолчанию ($countryCode) ниже. Остальной код не изменяется.
 * Five values marked 1–5 are filled in: four in the "Base configuration" block and the
 * default country ($countryCode) below. The rest of the code is left unchanged.
 *
 * Файл размещается рядом с index.html (в корне лендинга). Форма: action="order.php" method="post".
 * The file is placed next to index.html (landing root). The form: action="order.php" method="post".
 */

/**
 * Базовая конфигурация / Base configuration
 */
// 1. API-ключ аккаунта: Профиль → Редактировать личные данные → API ключ.
//    Account API key: Profile → Edit personal data → API key.
$apiKey = 'YOUR_API_KEY';
// Домен, на который отправляются заказы. Не изменяется. / The orders' target domain. Not changed.
$domain = 'shakes.pro';
// 2. URL оригинального лендинга оффера (со страницы оффера); используется для расчёта статистики.
//    Если лендинга нет (например, приложение), подходит любой URL из оффера.
//    The original offer landing URL (from the offer page); used for statistics.
//    If there is no landing (e.g. an app), any URL from the offer will do.
$landingUrl = 'https://eu1ru-benagachaga.jointssx.com';
// 3. ID оффера — на странице оффера, под логотипом. / Offer ID — on the offer page, under the logo.
$offerId = '26442';
// 4. Код потока — ровно 4 символа (не ссылка). Пусто — заказ передаётся без потока.
//    Stream code — exactly 4 characters (not a link). Empty — the order is sent without a stream.
$streamCode = '';
// Страница «Спасибо» и страница ошибки. / Thank-you page and error page.
$successPage = 'call.html';
$errorPage = 'error.html';
/**
 * Формирование отправляемого заказа
 */
$url = "https://$domain?r=/api/order/in&key=$apiKey";
// Определяем ГЕО
if (!empty($_POST['country'])) {
    $countryCode = $_POST['country'];
} else if (!empty($_GET['country'])) {
    $countryCode = $_GET['country'];
} else {
    // ГЕО заказа, если оно явно не указано в запросе
    $countryCode = 'AT'; // 5. ISO-код страны оффера, например 'DE' / the offer country's ISO code, e.g. 'DE'
}
$order = [
    'countryCode' => $countryCode,
    'createdAt' => date('Y-m-d H:i:s'),
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'ip' => (!empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : null), // ip пользователя
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

/**
 * Отправка заказа
 */
/**
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
curl_setopt($curl, CURLOPT_USERAGENT, 'curl/' . (curl_version()['version'] ?? '7'));
/**
 * @see http://php.net/manual/ru/language.exceptions.php
 */
try {
    $responseBody = curl_exec($curl);
    /**
     * Логгируем все ответы сервера.
     * Если заказ не отправляется, данный файл может быть затребован саппортом
     * для диагностики проблемы.
     * @see http://php.net/manual/ru/function.file-put-contents.php
     */
    @file_put_contents(
        __DIR__ . '/shakes.response.log',
        date('Y.m.d H:i:s') . PHP_EOL . $responseBody,
        FILE_APPEND
    );

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
    if ($response['status'] !== 'ok') {
        throw new Exception('Error: Order is not accepted. '
            . PHP_EOL . 'Order: ' . var_export($order, true)
            . PHP_EOL . 'Response: ' . var_export($response, true)
        );
    }
    /**
     * логируем данные об обработке заказа
     * @see http://php.net/manual/ru/function.file-put-contents.php
     */
    @file_put_contents(
        __DIR__ . '/order.success.log',
        date('Y.m.d H:i:s') . ' ' . $responseBody,
        FILE_APPEND
    );
    if (PHP_VERSION_ID < 80000) { curl_close($curl); }   // с PHP 8.0 не нужен, в 8.5 печатает Deprecated на странице

    if(!empty($successPage) && is_file(__DIR__ . '/' . $successPage)) {
        include __DIR__ . '/' . $successPage;
    }
} catch (Exception $e) {
    /**
     * логируем ошибку
     * @see http://php.net/manual/ru/function.file-put-contents.php
     */
    @file_put_contents(
        __DIR__ . '/order.error.log',
        date('Y.m.d H:i:s') . ' ' . $e->getMessage() . PHP_EOL . $e->getTraceAsString(),
        FILE_APPEND
    );

    if(!empty($errorPage) && is_file(__DIR__ . '/' . $errorPage)) {
        include __DIR__ . '/' . $errorPage;
    }
}
