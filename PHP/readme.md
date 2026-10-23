# UPC Token Service — PHP

PHP 8+ клієнт на стандартних потокових HTTP-засобах. Підключіть `UpcTokenService.php`
і використовуйте namespace `UpcTokenService`:

```php
require_once __DIR__ . '/UpcTokenService.php';

$client = new \UpcTokenService\UpcTokenService(
    'test',
    new \UpcTokenService\UpcTokenServiceOptions('7651243', 'E7651243')
);
$response = $client->createToken(new \UpcTokenService\CreateTokenRequest(
    'tracking-1',
    new \UpcTokenService\CardDetails('4111111111111111', '12', '2030')
));
```

Доступні методи: `createToken`, `refreshToken`, `deleteToken`, `getTokenStatus`,
`suspendToken`, `resumeToken`, `getCardContent`, `getCardMetadata`. Відповідь — сирий
XML; для HTTP-відповідей поза діапазоном 2xx кидається `FetchError`. Тайм-аут задається
в мілісекундах. Для налаштування довжини Unicode-рядків бажано ввімкнути розширення `mbstring`.
