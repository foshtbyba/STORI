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

// ===== ВСТАВЬ СВОЙ API КЛЮЧ =====
define('OPENAI_API_KEY', 'sk-XXXXXXXXXXXXXXXXXXXXXXXX');
define('MODEL', 'gpt-4o-mini');

// ===== SYSTEM PROMPT =====
$SYSTEM_PROMPT = <<<'PROMPT'
Ти си д-р Георги Димитров — онлайн консултант по ставни заболявания. Говориш САМО на български. Ако потребителят пише на друг език, любезно кажи че говориш само български и продължи на български.

ПРОДУКТ: Hondro Sol — гел за стави. Състав: колаген тип II, силиций, куркума, глюкозамин, хондроитин, магнезий, витамин C, Omega-3. Нанася се 2-3 пъти дневно с лек масаж. Не засяга стомаха и черния дроб. Курс: 30 дни, тежки случаи 2-3 месеца. Клинично изпитание: 2100 души, 91% с подобрение за 2 седмици.

ЦЕНА: 25 EUR вместо 40 EUR (промоционална програма, ограничен брой).

ТВОЯТА ЦЕЛ: Води естествен разговор, задавай въпроси един по един, убеди човека в нуждата от Hondro Sol, и накрая събери ИМЕТО и ТЕЛЕФОНА му за поръчка.

ПРАВИЛА ЗА РАЗГОВОРА:
1. Започни: попитай къде го боли (колене, гръб, ръце, няколко зони)
2. Питай възраст (45-55, 55-65, 65-75, 75+)
3. Питай от колко време е болката (по-малко от месец, 1-6 месеца, повече от година)
4. Питай за сутрешна скованост
5. Питай какво приема (хапчета, гелове, нищо)
6. Направи тест (наведи се, завърти се — какво чувства)
7. Обясни проблема: хрущялът се износва, синовиалната течност намалява, кост трие о кост
8. Обясни защо обикновените лекарства не помагат — само маскират болката
9. Представи Hondro Sol — как действа, състав, как се нанася
10. Кажи цената: 25 EUR вместо 40 EUR
11. Събери име и телефон за поръчка

ВАЖНО:
- Задавай САМО по един въпрос наведнъж
- Бъди съпричастен, топъл, професионален
- Не бързай — изчакай отговор преди следващия въпрос
- Ако човек има съмнения — дай примери, обясни механизма
- Когато човек каже "да, искам" или подобно — питай за име, после телефон

ФОРМАТ НА ОТГОВОРА:
Пиши отговора си като обикновен текст. В КРАЯ на всеки отговор добави ред с бутони в точно този формат:
<<BUTTONS>>бутон1|бутон2|бутон3<</BUTTONS>>
Максимум 4 бутона. Бутоните трябва да са кратки (2-5 думи).

Когато си събрал ИМЕ и ТЕЛЕФОН, добави в отговора:
<<LEAD>>name=Иван Петров|phone=+359888123456<</LEAD>>
(замени с истинските данни на човека)

След събиране на lead кажи: "Поръчката ви е регистрирана ✅! Консултант ще ви се обади в следващите 10-15 минути. Дръжте телефона наблизо."

Първото съобщение (когато op=start): Поздрави, представи се като консултант по ставни заболявания, попитай къде боли. Добави бутони за зони.
PROMPT;

// ===== ОБРАБОТКА ЗАПРОСА =====
$input = json_decode(file_get_contents('php://input'), true);
if (!$input) {
    echo json_encode(['ok' => false, 'error' => 'invalid request']);
    exit;
}

$op = $input['op'] ?? '';
$history = $input['history'] ?? [];
$text = $input['text'] ?? '';

// Собираем messages для OpenAI
$messages = [['role' => 'system', 'content' => $SYSTEM_PROMPT]];

// Добавляем историю
foreach ($history as $msg) {
    if (isset($msg['role']) && isset($msg['content'])) {
        $messages[] = ['role' => $msg['role'], 'content' => $msg['content']];
    }
}

// Добавляем новое сообщение
if ($op === 'say' && $text) {
    $messages[] = ['role' => 'user', 'content' => $text];
} elseif ($op === 'start') {
    $messages[] = ['role' => 'user', 'content' => '[Потребителят отвори чата. Започни разговора.]'];
}

// ===== ВЫЗОВ OpenAI API =====
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
        'temperature' => 0.7,
        'max_tokens' => 1024,
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

// ===== ПАРСИМ ОТВЕТ =====
$buttons = [];
$lead = null;

// Извлекаем кнопки
if (preg_match('/<<BUTTONS>>(.+?)<</BUTTONS>>/s', $reply, $m)) {
    $buttons = array_map('trim', explode('|', $m[1]));
    $reply = trim(preg_replace('/<<BUTTONS>>(.+?)<</BUTTONS>>/s', '', $reply));
}

// Извлекаем lead
if (preg_match('/<<LEAD>>(.+?)<</LEAD>>/s', $reply, $m)) {
    $parts = explode('|', $m[1]);
    $lead = [];
    foreach ($parts as $p) {
        list($k, $v) = explode('=', $p, 2);
        $lead[trim($k)] = trim($v);
    }
    $reply = trim(preg_replace('/<<LEAD>>(.+?)<</LEAD>>/s', '', $reply));
}

// Разбиваем на несколько пузырей по двойному переносу
$msgs = array_values(array_filter(
    array_map('trim', preg_split('/\n{2,}/', $reply)),
    function($s) { return $s !== ''; }
));
if (empty($msgs)) $msgs = [$reply];

// Обновляем историю
$newHistory = $history;
if ($op === 'start') {
    $newHistory[] = ['role' => 'user', 'content' => '[Потребителят отвори чата.]'];
} elseif ($text) {
    $newHistory[] = ['role' => 'user', 'content' => $text];
}
$newHistory[] = ['role' => 'assistant', 'content' => $reply];

// Ограничиваем историю (последние 40 сообщений)
if (count($newHistory) > 40) {
    $newHistory = array_slice($newHistory, -40);
}

// ===== ОТВЕТ =====
echo json_encode([
    'ok' => true,
    'messages' => $msgs,
    'quick_replies' => $buttons,
    'history' => array_values($newHistory),
    'lead' => $lead,
], JSON_UNESCAPED_UNICODE);
