<?php
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

error_reporting(0);

if (!function_exists('curl_init')) {
    echo json_encode(['ok' => false, 'error' => 'curl not installed on server']);
    exit;
}

define('OPENAI_API_KEY', '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');
define('MODEL', 'gpt-4o');

$PERSONA = <<<'PROMPT'
Ти си д-р Георги Димитров — ортопед с 18 години опит, работиш в Университетската болница "Св. Иван Рилски" в София. Онлайн консултант в национална програма за лечение на стави.

СТИЛ: Топло, спокойно, като истински доктор в чат. 2-4 кратки изречения. Добавяй лични детайли от практиката. НЕ звучи като робот.
ЕЗИК: САМО на български. НИКОГА на руски!

ВАЖНО: Пиши САМО текста на отговора. НЕ добавяй бутони, тагове, формати. Само чист текст.

Ако питат дали си робот: "Не, аз съм д-р Димитров, жив човек 😊 Просто консултирам онлайн в тази програма."
PROMPT;

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    echo json_encode(['ok' => false, 'error' => 'invalid request']);
    exit;
}

$op = $input['op'] ?? '';
$history = $input['history'] ?? [];

$userMsgs = [];
$botMsgs = [];
foreach ($history as $msg) {
    if (!isset($msg['role']) || !isset($msg['content'])) continue;
    $c = trim($msg['content']);
    if ($msg['role'] === 'user') {
        $userMsgs[] = $c;
    }
    if ($msg['role'] === 'assistant') {
        $botMsgs[] = $c;
    }
}
$step = count($userMsgs);

// Кнопки захардкожены для каждого шага — GPT их НЕ генерирует
$stepButtons = [
    1  => ['Под 40', '40-55', '55-70', 'Над 70'],
    2  => ['По-малко от година', '1-3 години', 'Повече от 3 години'],
    3  => ['Да, и двете', 'Само скованост', 'Само хрускане', 'Нищо такова'],
    4  => ['Хапчета за болка', 'Гелове от аптеката', 'Физиотерапия', 'Нищо не помага'],
    5  => ['Какво да правя?', 'Има ли лечение?'],
    6  => ['Какво препоръчвате?', 'Има ли такова нещо?'],
    7  => ['Колко струва?', 'Къде се купува?', 'Наистина помага ли?'],
    8  => ['Да, искам!', 'Запишете ме', 'Имам въпрос'],
    9  => [],
    10 => [],
    11 => [],
];

if ($op === 'start') {
    // Приветствието е захардкожено на фронтенда — тук не трябва да стигаме
    echo json_encode([
        'ok' => true,
        'messages' => ['Здравейте! Аз съм д-р Георги Димитров, ортопед с 18 години опит в Университетската болница "Св. Иван Рилски" в София. Вие сте в програмата за безплатна онлайн консултация за стави. Кажете ми — къде ви боли?'],
        'quick_replies' => ['Колене', 'Гръб', 'Рамене', 'Друго'],
        'lead' => null,
    ], JSON_UNESCAPED_UNICODE);
    exit;
}

$last = end($userMsgs) ?: '';

switch ($step) {
    case 1:
        $instruction = "Пациентът каза че го боли: \"$last\". Покажи съчувствие (1-2 изречения). Кажи нещо лично от практиката. После попитай: \"На колко години сте?\" Пиши САМО текста, без бутони.";
        break;
    case 2:
        $bodyPart = $userMsgs[0] ?? '';
        $instruction = "Пациентът е на $last години, боли го: $bodyPart. Кажи кратко нещо свързано с възрастта и ставите (1 изречение). После попитай: \"От колко време ви притеснява тази болка?\" Пиши САМО текста, без бутони.";
        break;
    case 3:
        $instruction = "Болката е от $last. Кажи \"Разбирам, доста време е...\" (1 изречение). После попитай: \"Сутрин, когато ставате от леглото, чувствате ли скованост в ставите? Чувате ли хрускане при движение?\" Пиши САМО текста, без бутони.";
        break;
    case 4:
        $instruction = "Пациентът каза: \"$last\" за скованост/хрускане. Кажи че това са типични признаци за износване на хрущяла (1-2 изречения). После попитай: \"Какво сте пробвали досега — хапчета, гелове, физиотерапия?\" Пиши САМО текста, без бутони.";
        break;
    case 5:
        $instruction = "Пациентът е пробвал: \"$last\". Обясни какво се случва в ставата — просто, като на приятел: хрущялът (гладката повърхност между костите) се износва, синовиалната течност (\"смазката\") намалява, кост трие о кост — затова болката се засилва. Кажи го с примери от практиката. 3-4 изречения. Пиши САМО текста, без бутони.";
        break;
    case 6:
        $instruction = "Обясни защо обезболяващите НЕ решават проблема: \"Хапчетата за болка само маскират. Все едно пиете обезболяващо за счупен крак — болката спира, но кракът не зараства.\" Трябва нещо, което подхранва самия хрущял. 2-3 изречения. Пиши САМО текста, без бутони.";
        break;
    case 7:
        $instruction = "Представи Hondro Sol — гел за стави. Кажи: \"Аз лично го препоръчвам на пациентите си вече 2 години.\" Съставки: колаген тип II, глюкозамин, хондроитин, куркума, силиций. Нанася се 2-3 пъти на ден. Не натоварва стомаха. Клинично изпитание: 2100 души, 91% подобрение за 2 седмици. Курс 30 дни. 3-4 изречения. Пиши САМО текста, без бутони.";
        break;
    case 8:
        $instruction = "Кажи цената: \"В момента имаме специална програма — 25 EUR вместо обичайните 40 EUR. Промоцията е за ограничен период, бройките са ограничени.\" Плащане при получаване, без предплащане. Попитай: \"Искате ли да ви запиша за доставка?\" 2-3 изречения. Пиши САМО текста, без бутони.";
        break;
    case 9:
        $instruction = "Пациентът иска да поръча! Кажи \"Чудесно! Радвам се, че решихте да се погрижите за здравето си.\" Попитай: \"Как се казвате?\" Пиши САМО текста, без бутони.";
        break;
    case 10:
        $instruction = "Пациентът каза името си: \"$last\". Кажи \"Приятно ми е, $last!\" Попитай: \"На кой телефонен номер да ви се обадят за потвърждение на адреса?\" Пиши САМО текста, без бутони.";
        break;
    case 11:
        $name = isset($userMsgs[9]) ? $userMsgs[9] : 'Пациент';
        $phone = $last;
        echo json_encode([
            'ok' => true,
            'messages' => ["Чудесно, записах ви! ✅ Консултант от програмата ще ви се обади в следващите 10-15 минути, за да потвърди адреса и да организира доставката. Дръжте телефона наблизо! Бъдете здрав/а! 🙏"],
            'quick_replies' => [],
            'lead' => ['name' => $name, 'phone' => $phone],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    default:
        $chatSummary = '';
        for ($i = 0; $i < count($userMsgs); $i++) {
            $botText = isset($botMsgs[$i]) ? mb_substr(preg_replace('#<<[^>]*>>#u', '', $botMsgs[$i]), 0, 100) : '';
            $chatSummary .= "Д-р: $botText\nПациент: {$userMsgs[$i]}\n";
        }
        $instruction = "Ето резюме на разговора:\n$chatSummary\nПродължи разговора естествено. Ако пациентът задава въпрос — отговори. Ако е готов да поръча — попитай име и телефон. Пиши САМО текста, без бутони.";
        break;
}

$messages = [
    ['role' => 'system', 'content' => $PERSONA],
    ['role' => 'user', 'content' => $instruction],
];

$ch = curl_init('https://api.openai.com/v1/chat/completions');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST => true,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'Authorization: Bearer ' . OPENAI_API_KEY,
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'model' => MODEL,
        'messages' => $messages,
        'temperature' => 0.6,
        'max_tokens' => 600,
    ]),
    CURLOPT_TIMEOUT => 30,
]);
$response = curl_exec($ch);
$curlErr = curl_error($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($curlErr) {
    echo json_encode(['ok' => false, 'error' => 'curl: ' . $curlErr]);
    exit;
}
if ($httpCode !== 200) {
    echo json_encode(['ok' => false, 'error' => 'API error: HTTP ' . $httpCode]);
    exit;
}

$data = json_decode($response, true);
$reply = $data['choices'][0]['message']['content'] ?? '';
if (!$reply) {
    echo json_encode(['ok' => false, 'error' => 'empty response']);
    exit;
}

// Убираем любые теги что GPT мог добавить несмотря на запрет
$reply = preg_replace('#<<[^>]*>>#u', '', $reply);
$reply = trim($reply);

// Парсим lead если вдруг GPT его добавил
$lead = null;
if (preg_match('#<<LEAD>>(.+?)<<\/LEAD>>#su', $reply, $m)) {
    $parts = explode('|', $m[1]);
    $lead = [];
    foreach ($parts as $p) {
        $kv = explode('=', $p, 2);
        if (count($kv) === 2) $lead[trim($kv[0])] = trim($kv[1]);
    }
    $reply = trim(preg_replace('#<<LEAD>>(.+?)<<\/LEAD>>#su', '', $reply));
}

// Кнопки берём из массива — НЕ от GPT
$buttons = isset($stepButtons[$step]) ? $stepButtons[$step] : ['Продължете', 'Имам въпрос'];

$msgs = array_values(array_filter(
    array_map('trim', preg_split('/\n{2,}/', $reply)),
    function($s) { return $s !== ''; }
));
if (empty($msgs)) $msgs = [$reply];

echo json_encode([
    'ok' => true,
    'messages' => $msgs,
    'quick_replies' => $buttons,
    'lead' => $lead,
], JSON_UNESCAPED_UNICODE);
