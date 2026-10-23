# UPC Token Service SDK for Node.js

TypeScript-клієнт для взаємодії з UPC Token Service. SDK формує XML-запити, надсилає їх через HTTPS і повертає XML-відповіді сервісу.

## Основні можливості

- Керування токенами карток: створення, оновлення, перевірка стану, призупинення, відновлення та видалення.
- Отримання вмісту й метаданих картки.
- Підключення до тестового, виробничого або заданого HTTPS-середовища.
- Перевірка основних обов’язкових параметрів запиту.
- Необов’язкове діагностичне журналювання з маскуванням окремих чутливих XML-значень.

## Підтримка методів

SDK підтримує наступні методи UPC Token Service:
- `createToken()`
- `refreshToken()`
- `deleteToken()`
- `getTokenStatus()`
- `suspendToken()`
- `resumeToken()`
- `getCardContent()`
- `getCardMetadata()`

## Сумісність

- Node.js 22 або новіша версія.
- TypeScript та ES-модулі.

## Документація

Докладніша інформація про налаштування клієнта, методи, формат запитів і помилки доступна в [посібнику модуля](docs/upcTokenService.md).

## Запуск і побудова

Щоб зібрати проєкт у JavaScript:

```bash
npm run build
```

Для запуску демо з конкретною операцією:

```bash
npm run demo -- status
```

Універсальне демо для всіх операцій Upc Token Service SDK:

- `create-token`, `refresh`, `delete`, `status`, `suspend`, `resume`, `card-content`, `card-metadata`
- Команда запуску: `npm run demo -- status` — замініть `status` потрібною операцією.
- Параметри, як-от `UPC_TRACKING_ID`, `UPC_TOKEN_ID` і `UPC_CONTENT_ID`, додані до шаблону `.env.example`.
- Для `delete` потрібне явне підтвердження `--confirm-delete`, оскільки видалення незворотне. 
- XML-відповідь виводиться із замаскованими чутливими значеннями.
