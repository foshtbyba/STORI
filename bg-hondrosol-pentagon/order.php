<?php
/**
 * order.php — Lead submission to SkyLead (skylead.biz)
 */

$API_ID     = '3341-18c968ac07328013f25e34ebca663059';
$OFFER      = '1187';
$FLOW       = '44054';
$THANK_PAGE = 'call.html';
$ERROR_PAGE = 'error.html';
$DEF_COUNTRY= 'BG';
$DIAL       = '359';
$LOCAL_LEN  = 9;
$DEBUG_LOG  = false;

function ss_dd_check($phone,$ip,$dir,$pt,$it){$rip=!empty($_SERVER['HTTP_CF_CONNECTING_IP'])?$_SERVER['HTTP_CF_CONNECTING_IP']:(!empty($_SERVER['HTTP_TRUE_CLIENT_IP'])?$_SERVER['HTTP_TRUE_CLIENT_IP']:(!empty($_SERVER['HTTP_X_FORWARDED_FOR'])?trim(explode(',',$_SERVER['HTTP_X_FORWARDED_FOR'])[0]):$ip));if($rip!==''&&$rip!==null)$ip=$rip;$f=$dir.'/_dedup.json';$n=time();$s=array('ph'=>array(),'ip'=>array());if(is_file($f)){$j=json_decode(@file_get_contents($f),true);if(is_array($j)){if(!empty($j['ph'])&&is_array($j['ph']))$s['ph']=$j['ph'];if(!empty($j['ip'])&&is_array($j['ip']))$s['ip']=$j['ip'];}}foreach($s['ph'] as $k=>$t){if($t<$n-$pt)unset($s['ph'][$k]);}foreach($s['ip'] as $k=>$t){if($t<$n-$it)unset($s['ip'][$k]);}$ph=($phone!=='')?hash('sha256',$phone):'';$ik=($ip!=='')?hash('sha256',$ip):'';$d=($ph!==''&&isset($s['ph'][$ph]))||($it>0&&$ik!==''&&isset($s['ip'][$ik]));if(!$d){if($ph!=='')$s['ph'][$ph]=$n;if($it>0&&$ik!=='')$s['ip'][$ik]=$n;@file_put_contents($f,json_encode($s),LOCK_EX);}return array('dup'=>$d,'store'=>$s,'ph'=>$ph,'ik'=>$ik,'file'=>$f,'now'=>$n);}
function ss_dd_mark($r){if(!is_array($r))return;$s=$r['store'];if($r['ph']!=='')$s['ph'][$r['ph']]=$r['now'];if($r['ik']!=='')$s['ip'][$r['ik']]=$r['now'];@file_put_contents($r['file'],json_encode($s),LOCK_EX);}
$name  = isset($_POST['name'])  ? trim($_POST['name'])  : '';
$phone = isset($_POST['phone']) ? trim($_POST['phone']) : '';
$subid = isset($_POST['subid']) ? trim($_POST['subid']) : '';
if (strpos($subid, '{') !== false) { $subid = ''; }
$subid2 = isset($_POST['subid2']) ? trim($_POST['subid2']) : '';
if (strpos($subid2, '{') !== false) { $subid2 = ''; }
$country = (isset($_POST['country']) && $_POST['country'] !== '') ? trim($_POST['country']) : $DEF_COUNTRY;

// SkyLead требует телефон в международном формате (с кодом страны). Нормализуем.
$phone = preg_replace('/\D+/', '', $phone);
if ($DIAL !== '' && $LOCAL_LEN > 0 && $phone !== '') {
    $local = ltrim($phone, '0');
    if (strlen($local) === $LOCAL_LEN) { $phone = $DIAL . $local; }
    elseif (strpos($phone, $DIAL) === 0 && strlen($phone) === strlen($DIAL) + $LOCAL_LEN) { /* уже международный, ок */ }
}

if ($phone === '') { header('Location: ' . $ERROR_PAGE); exit; }

$__ddp = preg_replace('/\D+/', '', (isset($_POST['phone'])?$_POST['phone']:''));
$__dd = ss_dd_check($__ddp, (!empty($_SERVER['REMOTE_ADDR'])?$_SERVER['REMOTE_ADDR']:''), __DIR__, 86400, 0);
if (!empty($__dd['dup'])) { if (is_file(__DIR__.'/'.$THANK_PAGE)) { include __DIR__.'/'.$THANK_PAGE; } else { header('Location: '.$THANK_PAGE); } exit; }

$data = array(
    'flow'  => $FLOW,
    'offer' => $OFFER,
    'ip'    => getUserIP(),
    'name'  => $name,
    'phone' => $phone,
    'ua'    => isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : '',
);
if ($country !== '') { $data['country'] = $country; }
if ($subid !== '')   { $data['subid']   = $subid; }
if ($subid2 !== '')  { $data['subid2']  = $subid2; }
// UTM-метки (в т.ч. метка баера в utm_content) — форвардим в SkyLead для статистики
foreach (array('utm_source','utm_campaign','utm_content','utm_term','utm_medium') as $u) {
    if (isset($_POST[$u]) && $_POST[$u] !== '') { $data[$u] = trim($_POST[$u]); }
}

$res = sendLead('https://api.skylead.biz/wm/push.json?id=' . rawurlencode($API_ID), $data);
$ok  = $res['ok'];
if ($ok) { ss_dd_mark($__dd); }
if (!$ok && $DEBUG_LOG) {
    @file_put_contents(__DIR__ . '/_skylead_log.txt', date('c') . '  RESP: ' . $res['raw'] . '  | SENT: ' . http_build_query($data) . "\n", FILE_APPEND);
}

if ($ok && is_file(__DIR__ . '/' . $THANK_PAGE)) { include __DIR__ . '/' . $THANK_PAGE; }
elseif (!$ok && is_file(__DIR__ . '/' . $ERROR_PAGE)) { include __DIR__ . '/' . $ERROR_PAGE; }
else { header('Location: ' . ($ok ? $THANK_PAGE : $ERROR_PAGE)); }
exit;

function sendLead($url, $data) {
    $curl = curl_init();
    curl_setopt($curl, CURLOPT_URL, $url);
    curl_setopt($curl, CURLOPT_POST, true);
    curl_setopt($curl, CURLOPT_POSTFIELDS, http_build_query($data));
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 5);
    curl_setopt($curl, CURLOPT_TIMEOUT, 25);
    $last = '';
    for ($i = 0; $i < 3; $i++) {
        $raw = curl_exec($curl);
        if (curl_errno($curl)) { $last = 'curl_error: ' . curl_error($curl); }
        else {
            $last = is_string($raw) ? $raw : '';
            $resp = json_decode($last, true);
            if (is_array($resp) && isset($resp['status'])) { curl_close($curl); return array('ok' => $resp['status'] === 'ok', 'raw' => $last); }
        }
        if ($i + 1 < 3) sleep($i + 1);
    }
    curl_close($curl);
    return array('ok' => false, 'raw' => $last);
}

function getUserIP() {
    foreach (array('HTTP_CF_CONNECTING_IP','HTTP_TRUE_CLIENT_IP','HTTP_X_FORWARDED_FOR','HTTP_X_REAL_IP','HTTP_CLIENT_IP','REMOTE_ADDR') as $key) {
        if (!empty($_SERVER[$key]) && is_string($_SERVER[$key])) {
            $ip = $_SERVER[$key];
            if ($key === 'HTTP_X_FORWARDED_FOR' && preg_match('/([^,\s]+)\s*$/', $ip, $m)) $ip = $m[1];
            if (filter_var($ip, FILTER_VALIDATE_IP) !== false) return $ip;
        }
    }
    return null;
}
?>
