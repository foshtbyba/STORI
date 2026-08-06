<?php

// ВСТАВЬТЕ СВОЙ API KEY ИЗ ПРОФИЛЯ https://my.affstar.com/profile
const API_KEY = 'API_KEY';
// ВСТАВЬТЕ ХЕШ ПОТОКА (UUID) ИЗ НАСТРОЕК ПОТОКА В AFFSTAR
const FLOW_UUID = 'FLOW_UUID';

class LeadSender
{
    private $dictionary;
    private $languageCountry;

    public function __construct()
    {
        $this->languageCountry = [
            Dictionary::RUS => ['RU', 'KZ'],
            Dictionary::ESP => ['CO', 'ES', 'EC', 'CL'],
            Dictionary::ENG => ['EN'],
        ];
        $this->dictionary      = new Dictionary();;
    }

    
    private function getRequestPrams()
    {
        return [
            'flow_uuid'    => FLOW_UUID,                // hash flow
            'name'         => $_POST['name'],           // Имя ( Поле обязательное )
            'phone'        => $_POST['phone'],          // Телефон ( Поле обязательное )
            'country_code' => $_POST['country'],        // страна для обзвона ( Поле обязательное ) в формате UA, IT,
            'ip'           => $_SERVER['REMOTE_ADDR'],  // IP адрес ( Поле обязательное )
            'referer'      => $_SERVER['HTTP_REFERER'],
            'user_agent'   => $_SERVER['HTTP_USER_AGENT'],
            'sub_id1'      => isset($_POST['sub_id1']) ? $_POST['sub_id1'] : "",
            'sub_id2'      => isset($_POST['sub_id2']) ? $_POST['sub_id2'] : "",
            'sub_id3'      => isset($_POST['sub_id3']) ? $_POST['sub_id3'] : "",
            'utm_source'   => isset($_POST['utm_source']) ? $_POST['utm_source'] : "",
            'utm_content'  => isset($_POST['utm_content']) ? $_POST['utm_content'] : "",
            'utm_campaign' => isset($_POST['utm_campaign']) ? $_POST['utm_campaign'] : "",
            'utm_term'     => isset($_POST['utm_term']) ? $_POST['utm_term'] : "",
            'utm_medium'   => isset($_POST['utm_medium']) ? $_POST['utm_medium'] : "",
            'fb_id'        => isset($_POST['fb_id']) ? $_POST['fb_id'] : "",
            'tt_id'        => isset($_POST['tt_id']) ? $_POST['tt_id'] : "",
        ];
    }

    public function send()
    {
        foreach ($this->languageCountry as $language => $countries) {
            if (in_array($_POST['country'], $countries)) {
                $this->dictionary->setLanguage($language);
            }
        }

        $params   = $this->getRequestPrams();

        $output   = $this->request($params);

        $response = json_decode($output, true);

        // если неизвестная ошибка
        if (empty($response) || !isset($response['success'])) {
            $this->includeWithVariables(
                'error.php',
                [
                    'output'    => $output,
                    'page_text' => $this->dictionary->getText('errorPage'),
                ]
            );
            return;
        }

        if ($response['success'] === true) {
            $params['lead_uuid'] = $response['data']['lead_uuid']; // для отладки

            $this->includeWithVariables(
                'confirm.php',
                [
                    'params'    => $params,
                    'page_text' => $this->dictionary->getText('confirmPage'),
                ]
            );
            return;
        }

        // если известная ошибка
        if ($response['success'] === false) {
            if (!empty($response['errors']) && filter_var($params['referer'], FILTER_VALIDATE_URL)) {
                $popupErrors = [];
                foreach($response['errors'] as $error){
                    if(isset($error['is_popup']) && $error['is_popup']===true) {                        
                        $popupErrors[] = $error['text'];
                    }
                }
                if(count($popupErrors) > 0){
                    $this->alertError(implode("\n", $popupErrors)); 
                    return;
                }
       
                $this->includeWithVariables(
                    'error.php',
                    [
                        'errors'  => $response['errors'],
                        'page_text' => $this->dictionary->getText('errorPage'),
                    ]
                );
                return;
               
            }
        }

        $this->includeWithVariables(
            'error.php',
            [
                'response'    => $response,
                'page_text' => $this->dictionary->getText('errorPage')
            ]
        );
    }
    
    private function request($params)
    {
        $url = 'https://api.affstar.com/api/lead/create/publisher?api_key=' . API_KEY;

        $headers  = [
            // Если авторицация происходит с передачечей api_key в query string строка ниже не нужна
            "ApiKey:" . API_KEY,
            'Content-Type: application/json',
        ];
        $json_str = json_encode($params);
        $ch       = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
        curl_setopt($ch, CURLOPT_POST, 1);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_HEADER, false);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $json_str);
        $output = curl_exec($ch);
        curl_close($ch);

        return $output;
    }

    private function alertError($message)
    {
        echo "<script>alert('$message'); history.back(); </script>";
    }

    private function includeWithVariables($filePath, $variables = [], $print = true)
    {
        $output = null;
        if (file_exists($filePath)) {
            extract($variables);            // Extract the variables to a local namespace
            ob_start();                     // Start output buffering
            include $filePath;              // Include the template file
            $output = ob_get_clean();       // End buffering and return its contents
        }
        if ($print) {
            print $output;
        }
        return $output;
    }
}

class Dictionary
{
    const RUS = 'rus';
    const ENG = 'eng';
    const ESP = 'esp';

    private $language;

    public function __construct()
    {
        $this->language = self::RUS;
    }

    public function setLanguage($language)
    {
        $this->language = $language;
        return $this;
    }

    public function getText($page)
    {
        $dict = [
            'confirmPage' => [
                self::RUS => [
                    'order_confirm'            => 'Подтверждение заказа',
                    'order_thanks_1'           => 'Спасибо за ваш заказ!',
                    'order_thanks_2'           => 'Благодарим за заказ!',
                    'your_name'                => 'Ваше имя:',
                    'your_phone'               => 'Ваш номер телефона:',
                    'about_order_confirmation' => 'В ближайшее время с вами свяжется менеджер, подтвердит наличие товара и ответит на вопросы',
                    'about_order_delivery'     => 'Далее мы бережно упакуем ваш заказ и передадим в службу доставки, которую вы выберете в процессе оформления заказа',
                    'about_order_payment'      => 'Оплатить товар можно при получении',
                    'more_order'               => 'Заказать еще',
                ],
                self::ENG => [
                    'order_confirm'            => 'Confirmation of an order',
                    'order_thanks_1'           => 'Thanks for your order!',
                    'order_thanks_2'           => 'Thank you for your order!',
                    'your_name'                => 'Your name:',
                    'your_phone'               => 'Your phone number:',
                    'about_order_confirmation' => 'In the near future the manager will contact you, confirm the availability of goods and answer your questions',
                    'about_order_delivery'     => 'Next, we will carefully pack your order and transfer it to the delivery service you choose during the checkout process',
                    'about_order_payment'      => 'You can pay for the goods upon receipt',
                    'more_order'               => 'Order more',
                ],

                self::ESP => [
                    'order_confirm'            => 'Confirmación de orden',
                    'order_thanks_1'           => 'Gracias por su orden!',
                    'order_thanks_2'           => 'Gracias por su orden!',
                    'your_name'                => 'Su nombre:',
                    'your_phone'               => 'Su número de teléfono:',
                    'about_order_confirmation' => 'Proximamente el administrador se comunicará con usted, confirmará la disponibilidad del producto y responderá a sus preguntas',
                    'about_order_delivery'     => 'A continuación, empaquetaremos cuidadosamente su pedido y lo transferiremos al servicio de entrega que elija durante el proceso de pedido.',
                    'about_order_payment'      => 'Se puede pagar el producto al recibirlo',
                    'more_order'               => 'Pedir más',
                ],
            ],
            'errorPage'   => [
                self::RUS => [
                    'error'       => 'Ошибка!',
                    'order_error' => 'Возникла ошибка при создании заказа:',
                    'return'      => 'Вернуться назад',
                ],
                self::ENG => [
                    'error'       => 'Error!',
                    'order_error' => 'An error occurred while creating an order:',
                    'return'      => 'Back',
                ],
                self::ESP => [
                    'error'       => '¡Error!',
                    'order_error' => 'Se produjo un error al crear el pedido:',
                    'return'      => 'Por favor, inténtelo de nuevo más tarde',
                ],
            ],
        ];

        return $dict[$page][$this->language];
    }
}

if ($_SERVER['REQUEST_METHOD'] == 'POST') {
    (new LeadSender())->send();
} else {
    echo('error');
}
