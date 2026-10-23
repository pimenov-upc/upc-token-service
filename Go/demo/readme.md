# Go demo

Демо виконує одну операцію через UPC Token Service і друкує XML-відповідь із замаскованими чутливими значеннями.

## Налаштування

Встановіть змінні середовища:

- `UPC_MERCHANT_ID` та `UPC_TERMINAL_ID` — обов’язкові реквізити мерчанта.
- `UPC_ENVIRONMENT` — `test` (типове значення) або `production`.
- `UPC_BASE_URL` — необов’язковий власний базовий HTTPS URL; має пріоритет над `UPC_ENVIRONMENT`.
- `UPC_TRACKING_ID` — ідентифікатор запиту (максимум 10 символів). Для `create-token` можна не задавати — буде згенеровано випадкове значення.
- `UPC_TOKEN_ID` — потрібен для операцій із токеном.
- `UPC_CONTENT_ID` — потрібен для `card-content`.
- `UPC_CARD_NUMBER`, `UPC_CARD_EXP_MONTH`, `UPC_CARD_EXP_YEAR` — потрібні для `create-token`.
- `UPC_CARD_CVV`, `UPC_CARD_BRAND`, `UPC_REASON_CODE`, `UPC_REASON` — необов’язкові поля.
- `UPC_LOGGING` — `true` або `false` (типове значення).

Запуск із каталогу `Go`:

```sh
go run ./demo status
```

Операції: `create-token`, `refresh`, `delete`, `status`, `suspend`, `resume`, `card-content`, `card-metadata`. Видалення незворотне й вимагає явного прапорця `--confirm-delete`.
