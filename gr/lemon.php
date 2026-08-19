<?php
const API_URL = "https://sendmelead.com/api/v3/lead/add";
const OFFER_ID = '87012cdc-16a7-4a45-95b4-6a146dce5e8b';
const WEBMASTER_TOKEN = '7206a9920d325fd9e6297a89b537b004';
const COST = 39;
const NAME_FIELD = 'name';
const PHONE_FIELD = 'phone';

$urlForNotPost = 'index.php';
$urlForEmptyRequiredFields = 'index.php';
$urlForNotJson = 'index.php';
$urlSuccess = 'success.php';

function writeToLog(array $data, $response) {
    $log  = date("F j, Y, g:i a").PHP_EOL.
        "----------- DATA -------------".PHP_EOL.
        print_r($data, true) .PHP_EOL.
        "----------- RESPONSE ---------".PHP_EOL.
        $response .PHP_EOL.
        "----------- END --------------".PHP_EOL;

    file_put_contents('./log_'.date("j.n.Y").'.log', $log, FILE_APPEND);
}

function getUserIP() {
    if (isset($_SERVER["HTTP_CF_CONNECTING_IP"])) {
        $_SERVER['REMOTE_ADDR'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
        $_SERVER['HTTP_CLIENT_IP'] = $_SERVER["HTTP_CF_CONNECTING_IP"];
    }
    $client  = @$_SERVER['HTTP_CLIENT_IP'];
    $forward = @$_SERVER['HTTP_X_FORWARDED_FOR'];
    $remote  = $_SERVER['REMOTE_ADDR'];

    if (filter_var($client, FILTER_VALIDATE_IP)) {
        $ip = $client;
    } elseif (filter_var($forward, FILTER_VALIDATE_IP)) {
        $ip = $forward;
    } else {
        $ip = $remote;
    }

    return $ip;
}

$isCurlEnabled = function_exists('curl_version');

if (!$isCurlEnabled) {
    echo "<pre>";
    echo "pls install curl\n";
    echo "For *unix open terminal and type this:\n";
    echo 'sudo apt-get install curl && apt-get install php-curl';
    die;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (empty($_POST[NAME_FIELD]) || empty($_POST[PHONE_FIELD])) {
        header('Location: '.$urlForEmptyRequiredFields);
        exit;
    }

    $args = array(
        'name' => $_POST[NAME_FIELD],
        'phone' => $_POST[PHONE_FIELD],
        'offerId' => OFFER_ID,
        'domain' => "http://" . $_SERVER["HTTP_HOST"] . $_SERVER["REQUEST_URI"],
        'ip' => getUserIp(),
        'utm_campaign' => key_exists('utm_campaign', $_POST) ? $_POST['utm_campaign'] : null,
        'utm_content' => key_exists('utm_content', $_POST) ? $_POST['utm_content'] : null,
        'utm_medium' => key_exists('utm_medium', $_POST) ? $_POST['utm_medium'] : null,
        'utm_source' => key_exists('utm_source', $_POST) ? $_POST['utm_source'] : null,
        'utm_term' => key_exists('utm_term', $_POST) ? $_POST['utm_term'] : null,
        'clickid' => key_exists('clickid', $_POST) ? $_POST['clickid'] : null,
        'fbpxl' => key_exists('fbpxl', $_POST) ? $_POST['fbpxl'] : null,
        'cost' => COST,
    );

    $data = json_encode($args);
    $curl = curl_init();
    curl_setopt_array($curl, array(
        CURLOPT_URL => API_URL,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $data,
        CURLOPT_HTTPHEADER => array(
            'Content-Type: application/json',
            'Content-Length: ' . strlen($data),
            'X-Token: '.WEBMASTER_TOKEN,
        ),
    ));

    $result = curl_exec($curl);
    curl_close($curl);
    writeToLog($args, $result);

    $result = json_decode($result, true);

    if ($result === null) {
        header('Location: '.$urlForEmptyRequiredFields);
        exit;
    } else {
        $parameters = [
            'fbpxl' => $args['fbpxl'],
            'fio' => $args['name'],
            'name' => $args['name'],
            'phone' => $args['phone']
        ];

        $urlSuccess .= '?' . http_build_query($parameters);

        header('Location: '.$urlSuccess);
        exit;
    }
}
?>
