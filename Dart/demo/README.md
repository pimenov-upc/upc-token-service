# Dart demo

Універсальний приклад виконує одну вибрану операцію UPC Token Service. Підтримуються `create-token`, `refresh`, `delete`, `status`, `suspend`, `resume`, `card-content` і `card-metadata`.

Запускайте з каталогу `Dart` після `dart pub get`:

```powershell
dart run demo/token_operation.dart status
```

Перед запуском задайте змінні середовища. Не зберігайте справжні платіжні дані або секрети в коді чи репозиторії. За замовчуванням використовується тестове середовище.

```powershell
$env:UPC_ENVIRONMENT = 'test'
$env:UPC_MERCHANT_ID = 'your-test-merchant-id'
$env:UPC_TERMINAL_ID = 'your-test-terminal-id'
$env:UPC_TRACKING_ID = 'status-1'
$env:UPC_TOKEN_ID = 'your-test-token-id'
dart run demo/token_operation.dart status
```

`UPC_TRACKING_ID` потрібен для всіх операцій і має бути не довшим за 10 символів. Для `refresh`, `delete`, `status`, `suspend`, `resume` та `card-metadata` потрібен `UPC_TOKEN_ID`. Для `card-content` потрібен `UPC_CONTENT_ID`; поле `UPC_CARD_BRAND` необов’язкове.

Створення токена потребує тестових реквізитів картки у змінних `UPC_CARD_NUMBER`, `UPC_CARD_EXP_MONTH` і `UPC_CARD_EXP_YEAR`. `UPC_CARD_CVV` необов’язковий. Користуйтеся лише тестовими даними, наданими UPC, і лише в тестовому середовищі.

Для власного HTTPS-середовища задайте `UPC_BASE_URL` як базову адресу без шляху API. Без нього виберіть `UPC_ENVIRONMENT=test` або `UPC_ENVIRONMENT=production`. Виробничий режим надсилає реальні запити до production.

Опційні змінні:

- `UPC_LOGGING=true` — увімкнути журнали SDK; чутливі XML-поля редагуються.
- `UPC_REASON_CODE` — один із `DEVICE_LOST`, `DEVICE_STOLEN`, `SUSPECTED_FRAUD`, `ACCOUNT_CLOSED`, `NOT_FRAUD`, `DEVICE_FOUND`, `OTHER` для операцій токена.
- `UPC_REASON` — текстова причина для `delete`, `suspend` або `resume`.

`delete` незворотний і потребує явного підтвердження:

```powershell
dart run demo/token_operation.dart delete --confirm-delete
```

Демо маскує чутливі значення у виведеній XML-відповіді. У разі помилки воно друкує повідомлення та завершується з ненульовим кодом. Приклад не виконує жодних запитів автоматично — кожен запит надсилається лише після явного запуску відповідної команди.
