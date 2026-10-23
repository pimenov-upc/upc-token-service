# UPC Token Service для Dart

Ця бібліотека надає Dart-клієнт для UPC Token Service. Клієнт перевіряє вхідні дані, формує XML-запити, надсилає їх методом HTTP POST і повертає тіло успішної відповіді як рядок. Реалізація розташована в [upc_token_service.dart](../lib/upc_token_service.dart).

## Можливості

- Підтримка тестового, виробничого та власного HTTPS-середовища.
- Вісім методів для роботи з токенами, вмістом картки та метаданими.
- Формування XML у форматі UPC XMLPay 1.18 із коректним екрануванням XML-значень.
- Тайм-аут HTTP-запитів і помилка `FetchError` для HTTP-відповідей поза діапазоном 2xx.
- Необов’язкові діагностичні журнали з редагуванням чутливих значень XML.

## Передумови

Потрібен Dart SDK версії 3.3 або новішої. Пакет не має зовнішніх залежностей.

З каталогу `Dart` виконайте `dart pub get`, щоб підготувати локальний пакет.

## Створення клієнта

```dart
import 'package:upc_token_service/upc_token_service.dart';

final upc = UpcTokenService(
  'test',
  const UpcTokenServiceOptions(
    merchantId: 'MERCHANT_ID',
    terminalId: 'TERMINAL_ID',
  ),
);

try {
  final xml = await upc.getTokenStatus(
    const TokenRequest(
      trackingId: 'status-1',
      tokenId: 'TOKEN_ID',
    ),
  );
  print(xml);
} finally {
  upc.close();
}
```

Клієнт відкриває пул HTTP-з’єднань. Викличте `close()` після завершення роботи з ним. Якщо потрібно негайно закрити активні з’єднання, можна викликати `close(force: true)`.

### Параметри конструктора

| Параметр | Тип | Обов’язковий | Опис |
| --- | --- | --- | --- |
| `resource` | `String` | Так | `'test'`, `'production'` або базова HTTPS-адреса власного середовища. |
| `options.merchantId` | `String` | Так | Ідентифікатор торговця: непорожній, до 35 символів. |
| `options.terminalId` | `String` | Так | Ідентифікатор термінала: непорожній, до 35 символів. |
| `options.timeout` | `int?` | Ні | Тайм-аут у мілісекундах. За замовчуванням — 60 000 мс. |
| `options.logging` | `bool` | Ні | Увімкнути діагностичні журнали. За замовчуванням — `false`. |

Стандартні адреси також доступні як `UpcTokenServiceResource.Test` і `UpcTokenServiceResource.Production`. Власна адреса має бути базовою HTTPS-адресою, наприклад `https://gateway.example:8443`: не додавайте шлях API, query-параметри або fragment.

## Методи API

Усі методи повертають `Future<String>` із необробленою XML-відповіддю. Відповідь не розбирається автоматично на об’єкт.

| Метод | Тип запиту | Призначення | Шлях API |
| --- | --- | --- | --- |
| `createToken()` | `CreateTokenRequest` | Створити токен картки. | `/go/token/create` |
| `refreshToken()` | `TokenRequest` | Оновити токен і отримати свіжі платіжні дані токена. | `/go/token/refresh` |
| `deleteToken()` | `UpdateTokenRequest` | Видалити токен. Видалений токен не можна відновити. | `/go/token/delete` |
| `getTokenStatus()` | `TokenRequest` | Отримати поточний стан токена. | `/go/token/status` |
| `suspendToken()` | `UpdateTokenRequest` | Призупинити токен, який можна буде відновити. | `/go/token/suspend` |
| `resumeToken()` | `UpdateTokenRequest` | Відновити раніше призупинений токен. | `/go/token/resume` |
| `getCardContent()` | `CardContentRequest` | Отримати вміст картки за `contentId`. | `/go/card/content` |
| `getCardMetadata()` | `CardMetadataRequest` | Отримати метадані картки за токеном. | `/go/card/metadata` |

### Створення токена

```dart
final responseXml = await upc.createToken(
  const CreateTokenRequest(
    trackingId: 'create-1',
    card: CardDetails(
      cardNum: 'CARD_NUMBER',
      expMonth: '12',
      expYear: '2030',
      // cvNum необов’язковий; не передавайте його, якщо він не потрібен.
    ),
  ),
);
```

`cvNum` необов’язковий. Якщо він заданий, його значення додається до XML як `CVNum`.

### Оновлення, перевірка стану та керування токеном

```dart
const token = TokenRequest(
  trackingId: 'status-1',
  tokenId: 'TOKEN_ID',
);

final statusXml = await upc.getTokenStatus(token);
final refreshedXml = await upc.refreshToken(
  const TokenRequest(trackingId: 'refresh-1', tokenId: 'TOKEN_ID'),
);

final suspendedXml = await upc.suspendToken(
  const UpdateTokenRequest(
    trackingId: 'suspend-1',
    tokenId: 'TOKEN_ID',
    reasonCode: TokenReasonCode.DEVICE_LOST,
  ),
);

final resumedXml = await upc.resumeToken(
  const UpdateTokenRequest(
    trackingId: 'resume-1',
    tokenId: 'TOKEN_ID',
    reasonCode: TokenReasonCode.DEVICE_FOUND,
    reason: 'Device recovered',
  ),
);
```

Допустимі значення `TokenReasonCode`: `DEVICE_LOST`, `DEVICE_STOLEN`, `SUSPECTED_FRAUD`, `ACCOUNT_CLOSED`, `NOT_FRAUD`, `DEVICE_FOUND` та `OTHER`. У XML вони передаються як текстові значення з тим самим написанням.

Видалення токена є остаточним:

```dart
final deletedXml = await upc.deleteToken(
  const UpdateTokenRequest(
    trackingId: 'delete-1',
    tokenId: 'TOKEN_ID',
    reasonCode: TokenReasonCode.SUSPECTED_FRAUD,
    reason: 'Reported lost device',
  ),
);
```

### Вміст картки та метадані

```dart
final contentXml = await upc.getCardContent(
  const CardContentRequest(
    trackingId: 'content-1',
    contentId: 'CONTENT_ID',
    brand: 'VISA', // Необов’язково.
  ),
);

final metadataXml = await upc.getCardMetadata(
  const CardMetadataRequest(
    trackingId: 'metadata-1',
    tokenId: 'TOKEN_ID',
  ),
);
```

Якщо `brand` не задано, XML-елемент `Brand` не додається.

## XML-запити

Кожен запит містить XML-заголовок, кореневий `ECommerceConnect` із посиланням на схему `xmlpay-1.18.xsd` і `Message` із послідовним числовим `id`. Ідентифікатор збільшується між запитами в межах isolate Dart. Наприклад, запит статусу має таку структуру:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd" xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">
  <Message id="1" version="1.0">
    <XMLTokenStatusRequest>
      <MerchantID>MERCHANT_ID</MerchantID>
      <TerminalID>TERMINAL_ID</TerminalID>
      <trackingId>status-1</trackingId>
      <UPCToken><tokenId>TOKEN_ID</tokenId></UPCToken>
    </XMLTokenStatusRequest>
  </Message>
</ECommerceConnect>
```

У фактичному запиті XML надсилається компактним рядком. Спеціальні символи в текстових значеннях екрануються: `&`, `<`, `>`, `"` та `'` перетворюються на відповідні XML entities.

## Валідація вхідних даних

SDK перевіряє:

- `merchantId` і `terminalId`: непорожні значення довжиною не більше 35 символів;
- `trackingId`: непорожнє значення довжиною не більше 10 символів;
- `tokenId`: непорожнє значення;
- у `createToken()` — непорожні `cardNum`, `expMonth` і `expYear`;
- у `getCardContent()` — непорожній `contentId`;
- адресу середовища: коректна HTTPS-адреса без шляху, query або fragment для власного ресурсу.

SDK не перевіряє формат чи довжину `tokenId`, термін дії картки або формат `brand`. Перевірте ці вимоги за специфікацією UPC, що застосовується до вашого середовища. У [схемі XMLPay 2.26](https://secure.upc.ua/go/pub/schema/xmlpay-2.26.xsd) `trackingId` має довжину 1–10 символів, а `tokenId` описаний як 32 шістнадцяткові символи; реалізація SDK посилається на схему 1.18 і навмисно не додає валідацію формату `tokenId`.

## Помилки HTTP і тайм-аут

Для HTTP-статусів поза діапазоном 200–299 метод завершується помилкою `FetchError`. Виняток містить:

- `status` — код HTTP;
- `message` — повідомлення відповіді або текст із кодом статусу;
- `url` — URL запиту;
- `responseBody` — текст тіла помилкової відповіді, якщо сервер його надіслав.

Наприклад:

```dart
try {
  final xml = await upc.getTokenStatus(token);
  print(xml);
} on FetchError catch (error) {
  // Не додавайте responseBody до незахищених журналів: воно може містити дані відповіді.
  stderr.writeln('UPC HTTP ${error.status}: ${error.message}');
}
```

Тайм-аут задається в мілісекундах через `UpcTokenServiceOptions.timeout`. Якщо запит перевищує тайм-аут, виникає `TimeoutException`.

## Журналювання та захист даних

За замовчуванням журналювання вимкнено. Коли `logging: true`, SDK записує URL, тип вмісту, XML запиту та метадані відповіді. Значення в елементах `CardNum`, `CVNum`, `TokenNumber`, `TAVV` і `tokenId` замінюються на `[REDACTED]`; вміст `encodedData` замінюється на `[OMITTED]`. Записи обмежені 2 000 символами.

Не передавайте до журналів чи прикладів реальні платіжні реквізити, токени або інші секрети. Редагування журналів — додатковий захист, а не заміна політик безпечного зберігання й обробки платіжних даних.
