# UPC Token Service SDK

Клієнти для взаємодії з UPC Token Service. SDK формує XML-запити, надсилає їх через HTTPS і повертає XML-відповіді сервісу.

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

## Реалізації

- [x] Dart: [Dart-клієнт](Dart/readme.md).
- [x] NodeJS: [TypeScript-клієнт](NodeJS/readme.md).
- [x] Python: [Python-клієнт](Python/readme.md).
- [x] Go: [Go-клієнт](Go/readme.md).
- [x] PHP: [PHP-клієнт](PHP/readme.md).
- [x] Kotlin: [Kotlin-клієнт](Kotlin/readme.md).
- [x] Java: [Java-клієнт](Java/readme.md).
- [x] Swift: [Swift-клієнт](Swift/readme.md).
