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

$SYSTEM_PROMPT = <<<'PROMPT'
Ти си д-р Георги Димитров — ортопед с 18 години опит в Университетската болница "Св. Иван Рилски" в София.

ЕЗИК: Пиши САМО на български.

СТИЛ: Топло, спокойно, кратко (2-4 изречения). Добавяй лични детайли от практиката.

ПРОДУКТ (САМО след стъпка 7):
Hondro Sol — гел за стави. Колаген II, куркума, глюкозамин, хондроитин. 25 EUR вместо 40 EUR.

ПЛАН (по 1 въпрос наведнъж):
1. Попитай къде боли
2. На колко години е
3. От колко време е болката
4. Скованост сутрин? Хрускане?
5. Какво е пробвал досега
6. Обясни: хрущялът се износва, кост трие о кост
7. Хапчетата само маскират, не лекуват
8. Представи Hondro Sol
9. Цена: 25 EUR вместо 40
10. "Искате ли да ви запиша?"
11. Питай име, после телефон

ПРАВИЛА:
- НИКОГА не повтаряй поздрава. Поздравявай САМО веднъж — в първото си съобщение
- Ако вече си питал нещо — НЕ питай пак
- Кратък отговор като "Колене", "31-40" = валиден отговор, премини напред

TAG FORMAT (Latin letters ONLY):
<<BUTTONS>>бутон1|бутон2|бутон3<</BUTTONS>>
<<LEAD>>name=Име|phone=+359...<</LEAD>>

Ако питат дали си робот: "Не, жив лекар съм 😊"
PROMPT;

$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    echo json_encode(['ok' => false, 'error' => 'invalid request']);
    exit;
}

$op = $input['op'] ?? '';
$history = $input['history'] ?? [];
$text = $input['text'] ?? '';

// Чистим историю: оставляем только ПЕРВОЕ приветствие, убираем повторные
function cleanHistory($history) {
    $cleaned = [];
    $greetingSeen = false;
    $greetingPatterns = ['Здравейте', 'Аз съм д-р', 'къде ви боли'];

    foreach ($history as $msg) {
        if (!isset($msg['role']) || !isset($msg['content'])) continue;

        if ($msg['role'] === 'assistant') {
            $isGreeting = false;
            foreach ($greetingPatterns as $p) {
                if (mb_strpos($msg['content'], $p) !== false) {
                    $isGreeting = true;
                    break;
                }
            }
            if ($isGreeting) {
                if ($greetingSeen) continue;
                $greetingSeen = true;
            }
        }

        $clean = preg_replace('#<<[^>]*>>#u', '', $msg['content']);
        $role = ($msg['role'] === 'assistant') ? 'assistant' : 'user';
        $cleaned[] = ['role' => $role, 'content' => trim($clean)];
    }
    return $cleaned;
}

function callGPT($messages) {
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
            'temperature' => 0.4,
            'max_tokens' => 1024,
        ]),
        CURLOPT_TIMEOUT => 30,
    ]);
    $response = curl_exec($ch);
    $curlErr = curl_error($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($curlErr) return ['error' => 'curl: ' . $curlErr];
    if ($httpCode !== 200) return ['error' => 'API error: HTTP ' . $httpCode];

    $data = json_decode($response, true);
    $reply = $data['choices'][0]['message']['content'] ?? '';
    if (!$reply) return ['error' => 'empty response'];

    return ['reply' => $reply, 'model' => $data['model'] ?? 'unknown'];
}

function isGreeting($text) {
    $patterns = ['Здравейте', 'Аз съм д-р', 'къде ви боли?', 'Кажете ми —'];
    $count = 0;
    foreach ($patterns as $p) {
        if (mb_strpos($text, $p) !== false) $count++;
    }
    return $count >= 2;
}

$messages = [
    ['role' => 'system', 'content' => $SYSTEM_PROMPT],
];

if ($op === 'start') {
    $messages[] = ['role' => 'user', 'content' => 'Започни разговора — поздрави и попитай къде боли.'];
} else {
    $cleanedHistory = cleanHistory($history);
    foreach ($cleanedHistory as $msg) {
        $messages[] = $msg;
    }
}

$result = callGPT($messages);
if (isset($result['error'])) {
    echo json_encode(['ok' => false, 'error' => $result['error']]);
    exit;
}

$reply = $result['reply'];

// ЗАЩИТА: если GPT ответил приветствием НЕ на старте — перезапрос с жёстким указанием
if ($op !== 'start' && isGreeting($reply)) {
    $messages[] = ['role' => 'assistant', 'content' => $reply];
    $messages[] = ['role' => 'user', 'content' => 'СТОП! Ти вече се представи. НЕ повтаряй поздрава. Отговори на последното съобщение на пациента и задай СЛЕДВАЩИЯ въпрос от плана. Започни директно, БЕЗ "Здравейте".'];

    $result2 = callGPT($messages);
    if (isset($result2['reply'])) {
        $reply = $result2['reply'];
    }
}

$buttons = [];
$lead = null;

if (preg_match('#<<(?:BUTTONS|КНОПКИ)>>(.+?)<<\/(?:BUTTONS|КНОПКИ)>>#su', $reply, $m)) {
    $buttons = array_map('trim', explode('|', $m[1]));
    $reply = trim(preg_replace('#<<(?:BUTTONS|КНОПКИ)>>(.+?)<<\/(?:BUTTONS|КНОПКИ)>>#su', '', $reply));
}

if (preg_match('#<<(?:LEAD|ЛИД)>>(.+?)<<\/(?:LEAD|ЛИД)>>#su', $reply, $m)) {
    $parts = explode('|', $m[1]);
    $lead = [];
    foreach ($parts as $p) {
        list($k, $v) = explode('=', $p, 2);
        $lead[trim($k)] = trim($v);
    }
    $reply = trim(preg_replace('#<<(?:LEAD|ЛИД)>>(.+?)<<\/(?:LEAD|ЛИД)>>#su', '', $reply));
}

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
