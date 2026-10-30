<?php
$api_id = 'API_ID'; // подставь свой SkyLead API ID

$name  = isset($_POST['name'])  ? trim($_POST['name'])  : '';
$phone = isset($_POST['phone']) ? trim($_POST['phone']) : '';

if (empty($name) || empty($phone)) {
    header('Location: error.html');
    exit;
}

$flow = isset($_POST['subid']) ? $_POST['subid'] : '';
$offer = '';

$url = 'https://api.skylead.biz/wm/push.json?id=' . $api_id;

$postData = http_build_query([
    'flow'  => $flow,
    'offer' => $offer,
    'name'  => $name,
    'phone' => $phone,
]);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 15);
curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode == 200) {
    header('Location: call.html');
} else {
    header('Location: error.html');
}
exit;
