<?php

$apiKey = 'f825ffeff11da49a86dc5d095c648f3c';
$domain = 'shakes.pro';
$landingUrl = 'https://eu1it-benagachaga.jointssx.com/';
$offerId = '26584';
$streamCode = '';
$successPage = 'call.html';
$errorPage = 'error.html';

function ss_dd_check($phone,$ip,$dir,$pt,$it){$rip=!empty($_SERVER['HTTP_CF_CONNECTING_IP'])?$_SERVER['HTTP_CF_CONNECTING_IP']:(!empty($_SERVER['HTTP_TRUE_CLIENT_IP'])?$_SERVER['HTTP_TRUE_CLIENT_IP']:(!empty($_SERVER['HTTP_X_FORWARDED_FOR'])?trim(explode(',',$_SERVER['HTTP_X_FORWARDED_FOR'])[0]):$ip));if($rip!==''&&$rip!==null)$ip=$rip;$f=$dir.'/_dedup.json';$n=time();$s=array('ph'=>array(),'ip'=>array());if(is_file($f)){$j=json_decode(@file_get_contents($f),true);if(is_array($j)){if(!empty($j['ph'])&&is_array($j['ph']))$s['ph']=$j['ph'];if(!empty($j['ip'])&&is_array($j['ip']))$s['ip']=$j['ip'];}}foreach($s['ph'] as $k=>$t){if($t<$n-$pt)unset($s['ph'][$k]);}foreach($s['ip'] as $k=>$t){if($t<$n-$it)unset($s['ip'][$k]);}$ph=($phone!=='')?hash('sha256',$phone):'';$ik=($ip!=='')?hash('sha256',$ip):'';$d=($ph!==''&&isset($s['ph'][$ph]))||($it>0&&$ik!==''&&isset($s['ip'][$ik]));if(!$d){if($ph!=='')$s['ph'][$ph]=$n;if($it>0&&$ik!=='')$s['ip'][$ik]=$n;@file_put_contents($f,json_encode($s),LOCK_EX);}return array('dup'=>$d,'store'=>$s,'ph'=>$ph,'ik'=>$ik,'file'=>$f,'now'=>$n);}
function ss_dd_mark($r){if(!is_array($r))return;$s=$r['store'];if($r['ph']!=='')$s['ph'][$r['ph']]=$r['now'];if($r['ik']!=='')$s['ip'][$r['ik']]=$r['now'];@file_put_contents($r['file'],json_encode($s),LOCK_EX);}
$__ddp = preg_replace('/\D+/', '', (isset($_POST['phone'])?$_POST['phone']:''));
$__dd = ss_dd_check($__ddp, (!empty($_SERVER['REMOTE_ADDR'])?$_SERVER['REMOTE_ADDR']:''), __DIR__, 86400, 0);
if (!empty($__dd['dup'])) { if (!empty($successPage) && is_file(__DIR__.'/'.$successPage)) { include __DIR__.'/'.$successPage; } else { header('Location: '.$successPage); } exit; }

$url = "http://$domain?r=/api/order/in&key=$apiKey";
$order = [
    'createdAt' => date('Y-m-d H:i:s'),
    'offerId' => $offerId,
    'landingUrl' => $landingUrl,
    'streamCode' => $streamCode,
    'ip' => (!empty($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : null),
    'referrer' => (!empty($_SERVER['HTTP_REFERER']) ? $_SERVER['HTTP_REFERER'] : null),
    'userAgent' => (!empty($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '-'),
    'name' => (!empty($_POST['name']) ? $_POST['name'] : (!empty($_GET['name']) ? $_GET['name'] : '')),
    'phone' => (!empty($_POST['phone']) ? $_POST['phone'] : (!empty($_GET['phone']) ? $_GET['phone'] : '')),
    'countryCode' => strtoupper(!empty($_POST['country']) ? $_POST['country'] : (!empty($_GET['country']) ? $_GET['country'] : 'IT')),
    'comment' => (!empty($_POST['comment']) ? $_POST['comment'] : (!empty($_GET['comment']) ? $_GET['comment'] : '')),
    'sub1' => (!empty($_POST['sub1']) ? $_POST['sub1'] : (!empty($_GET['sub1']) ? $_GET['sub1'] : '')),
    'sub2' => (!empty($_POST['sub2']) ? $_POST['sub2'] : (!empty($_GET['sub2']) ? $_GET['sub2'] : '')),
    'sub3' => (!empty($_POST['sub3']) ? $_POST['sub3'] : (!empty($_GET['sub3']) ? $_GET['sub3'] : '')),
    'sub4' => (!empty($_POST['sub4']) ? $_POST['sub4'] : (!empty($_GET['sub4']) ? $_GET['sub4'] : '')),
];

$curl = curl_init();
curl_setopt($curl, CURLOPT_URL, $url);
curl_setopt($curl, CURLOPT_POST, true);
curl_setopt($curl, CURLOPT_POSTFIELDS, $order);
curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
$responseBody = curl_exec($curl);
curl_close($curl);
$response = json_decode($responseBody, true);
$__ok = (is_array($response) && isset($response['status']) && $response['status'] == 'ok');
if (!$__ok) {
    if (!empty($errorPage) && is_file(__DIR__ . '/' . $errorPage)) { include __DIR__ . '/' . $errorPage; } else { header('Location: ' . $errorPage); }
    exit;
}
ss_dd_mark($__dd);
if (!empty($successPage) && is_file(__DIR__ . '/' . $successPage)) { include __DIR__ . '/' . $successPage; } else { header('Location: ' . $successPage); }
