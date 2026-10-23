# `UpcTokenService`: посібник для розробника-початківця

Цей модуль надає TypeScript-клієнт для роботи з UPC Token Service. Він перевіряє вхідні дані, формує XML-запити, надсилає їх до UPC і повертає тіло відповіді як рядок. Вихідний код розташований у [upcTokenService.ts](../src/core/upcTokenService.ts).

## Для чого потрібен модуль

Замість того щоб вручну формувати HTTP-запити й XML, створіть екземпляр `UpcTokenService` і викликайте відповідний метод. Клієнт автоматично:

- додає дані торговця (`MerchantID`, `TerminalID`) до кожного запиту;
- створює XML у форматі, який очікує сервіс UPC;
- надсилає POST-запит до відповідної кінцевої точки;
- перевіряє частину обов’язкових вхідних значень;
- повертає XML-відповідь без її перетворення на об’єкт.

HTTP-логіку, тайм-аут і обробку невдалих HTTP-статусів реалізує [http.ts](../src/utils/http.ts).

## Передумови

Пакет вимагає Node.js версії 22 або новішої та використовує ES-модулі. Скрипти збірки й тестування описані у [package.json](../package.json).

## Створення клієнта

Для роботи потрібні ідентифікатори торговця та термінала. Перше значення в конструкторі обирає тестове, виробниче або власне HTTPS-середовище.

```ts
import { UpcTokenService } from './core/upcTokenService.js';

const upc = new UpcTokenService('test', {
  merchantId: '7651243',
  terminalId: 'E7651243',
});

const xml = await upc.getTokenStatus({
  trackingId: 'status-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
});

console.info(xml);
```

У реальному застосунку не зберігайте ідентифікатори або платіжні дані у відкритому коді. Отримуйте їх із захищеної конфігурації застосунку.

### Параметри конструктора

| Параметр | Тип | Обов’язковий | Опис |
| --- | --- | --- | --- |
| `resource` | `UpcTokenServiceResource` | Так | `'test'`, `'production'` або базова HTTPS-адреса власного середовища. |
| `merchantId` | `string` | Так | Ідентифікатор торговця. Не може бути порожнім і має бути не довшим за 35 символів. |
| `terminalId` | `string` | Так | Ідентифікатор термінала. Не може бути порожнім і має бути не довшим за 35 символів. |
| `timeout` | `number` | Ні | Тайм-аут HTTP-запиту в мілісекундах. Якщо не задано, HTTP-клієнт використовує 60 000 мс. |
| `logging` | `boolean` | Ні | Вмикає діагностичні повідомлення. За замовчуванням `false`. |

Власна адреса має використовувати HTTPS і бути лише базовою адресою, наприклад `https://gateway.example:8443`. Не додавайте до неї шлях API, параметри запиту або фрагмент: SDK додає шлях самостійно.

## Методи API

Усі методи асинхронні та повертають `Promise<string>` із XML-відповіддю UPC.

| Метод | Призначення | Шлях API |
| --- | --- | --- |
| `createToken()` | Створити токен картки. | `/go/token/create` |
| `refreshToken()` | Оновити токен і отримати свіжі платіжні дані токена. | `/go/token/refresh` |
| `deleteToken()` | Видалити токен. Видалений токен не можна відновити. | `/go/token/delete` |
| `getTokenStatus()` | Отримати поточний стан токена. | `/go/token/status` |
| `suspendToken()` | Призупинити токен, який можна буде відновити. | `/go/token/suspend` |
| `resumeToken()` | Відновити раніше призупинений токен. | `/go/token/resume` |
| `getCardContent()` | Отримати вміст картки за її `contentId`. | `/go/card/content` |
| `getCardMetadata()` | Отримати метадані картки за токеном. | `/go/card/metadata` |

### Приклади всіх методів та XML-запитів

У прикладах використано ідентифікатори з тестового середовища. Замініть їх на власні тестові дані. Не додавайте реальні платіжні реквізити до прикладів, тестів або журналів. SDK формує XML у компактному вигляді; форматування нижче додано лише для читабельності. `Message id` генерується автоматично, тому в прикладах наведено умовне значення `1`.

Кожен запит містить спільну XML-обгортку. У повному запиті об’єкт операції розміщується всередині `Message`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"
  xmlns:xenc="http://www.w3.org/2001/04/xmlenc#"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">
  <Message id="1" version="1.0">
    <!-- Тут розміщується один з XML-запитів, показаних нижче. -->
  </Message>
</ECommerceConnect>
```

#### `createToken()` — створити токен

```ts
const responseXml = await upc.createToken({
  trackingId: 'create-1',
  card: {
    cardNum: '4111111111111111',
    expMonth: '12',
    expYear: '2030',
    cvNum: '123',
  },
});
```

XML-операція всередині спільної обгортки:

```xml
<XMLCreateTokenRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>create-1</trackingId>
  <Card>
    <CardNum>4111111111111111</CardNum>
    <ExpYear>2030</ExpYear>
    <ExpMonth>12</ExpMonth>
    <CVNum>123</CVNum>
  </Card>
</XMLCreateTokenRequest>
```

Поле `cvNum` необов’язкове; якщо його не передати, елемент `CVNum` не потрапить до XML.

#### `refreshToken()` — оновити токен

```ts
const responseXml = await upc.refreshToken({
  trackingId: 'refresh-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
});
```

```xml
<XMLRefreshTokenRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>refresh-1</trackingId>
  <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
</XMLRefreshTokenRequest>
```

#### `deleteToken()` — видалити токен

```ts
const responseXml = await upc.deleteToken({
  trackingId: 'delete-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  reasonCode: 'SUSPECTED_FRAUD',
  reason: 'Reported lost device',
});
```

```xml
<XMLDeleteTokenRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>delete-1</trackingId>
  <UpdateTokenRequest>
    <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
    <reasonCode>SUSPECTED_FRAUD</reasonCode>
    <reason>Reported lost device</reason>
  </UpdateTokenRequest>
</XMLDeleteTokenRequest>
```

Видалення є остаточним: видалений токен не можна відновити.

#### `getTokenStatus()` — отримати стан токена

```ts
const responseXml = await upc.getTokenStatus({
  trackingId: 'status-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
});
```

```xml
<XMLTokenStatusRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>status-1</trackingId>
  <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
</XMLTokenStatusRequest>
```

#### `suspendToken()` — призупинити токен

```ts
const responseXml = await upc.suspendToken({
  trackingId: 'suspend-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  reasonCode: 'DEVICE_LOST',
});
```

```xml
<XMLSuspendTokenRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>suspend-1</trackingId>
  <UpdateTokenRequest>
    <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
    <reasonCode>DEVICE_LOST</reasonCode>
  </UpdateTokenRequest>
</XMLSuspendTokenRequest>
```

#### `resumeToken()` — відновити призупинений токен

```ts
const responseXml = await upc.resumeToken({
  trackingId: 'resume-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  reasonCode: 'DEVICE_FOUND',
  reason: 'Device recovered',
});
```

```xml
<XMLResumeTokenRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>resume-1</trackingId>
  <UpdateTokenRequest>
    <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
    <reasonCode>DEVICE_FOUND</reasonCode>
    <reason>Device recovered</reason>
  </UpdateTokenRequest>
</XMLResumeTokenRequest>
```

#### `getCardContent()` — отримати вміст картки

```ts
const responseXml = await upc.getCardContent({
  trackingId: 'content-1',
  contentId: 'content-1-id',
  brand: 'VISA',
});
```

```xml
<XMLGetCardContentRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>content-1</trackingId>
  <contentId>content-1-id</contentId>
  <Brand>VISA</Brand>
</XMLGetCardContentRequest>
```

Поле `brand` необов’язкове; без нього елемент `Brand` не додається.

#### `getCardMetadata()` — отримати метадані картки

```ts
const responseXml = await upc.getCardMetadata({
  trackingId: 'metadata-1',
  tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
});
```

```xml
<XMLGetCardMetadataRequest>
  <MerchantID>7651243</MerchantID>
  <TerminalID>E7651243</TerminalID>
  <trackingId>metadata-1</trackingId>
  <UPCToken><tokenId>a1b2c3d4e5f60718293a4b5c6d7e8f90</tokenId></UPCToken>
</XMLGetCardMetadataRequest>
```

### Приклад XML-відповіді

Методи повертають XML-відповідь як рядок і не розбирають її автоматично. У базовому тестовому сценарії SDK отримує таку відповідь-заглушку:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ECommerceConnect>
  <Message>
    <XMLResponse>
      <TranCode>000</TranCode>
    </XMLResponse>
  </Message>
</ECommerceConnect>
```

Це лише тестова заглушка, а не гарантований приклад повної відповіді UPC для кожної операції. Реальний XML залежить від методу й результату обробки на стороні UPC; перевіряйте його згідно з документацією сервісу. За HTTP-помилки, наприклад статусу `502`, Promise відхиляється з помилкою, а XML-відповідь не повертається.

### Формат `tokenId`

У доступній [схемі UPC XMLPay 2.26](https://secure.upc.ua/go/pub/schema/xmlpay-2.26.xsd) елемент `tokenId` має тип `typeUPCTokenId` з шаблоном `[a-fA-F0-9]{32}`. Отже, значення має містити рівно 32 шістнадцяткові символи (`0–9`, `a–f` або `A–F`), без дефісів чи інших роздільників. Наприклад: `a1b2c3d4e5f60718293a4b5c6d7e8f90`.

Важливо: поточний SDK посилається у XML на схему `xmlpay-1.18.xsd`, а її адресу під час перевірки не вдалося відкрити. Код SDK перевіряє для `tokenId` лише непорожнє значення, але не перевіряє його довжину чи шістнадцятковий формат. Тому використовуйте 32-символьний hex-ідентифікатор і звірте сумісність цього обмеження зі специфікацією UPC, що застосовується саме до вашого середовища.

### Формат `trackingId`

У доступній [схемі UPC XMLPay 2.26](https://secure.upc.ua/go/pub/schema/xmlpay-2.26.xsd) елемент `trackingId` визначений як `xs:string` із `minLength` 1 та `maxLength` 10. Окремого шаблону символів (`pattern`) у цій схемі немає: обмеження задають довжину, а не спеціальний формат. Наприклад, `status-1` відповідає цим вимогам.

SDK також відхиляє порожній рядок і значення, що складається лише з пробілів, та не дозволяє довжину понад 10 символів. Значення не обрізається перед додаванням до XML. Як і для `tokenId`, клієнт посилається на `xmlpay-1.18.xsd`, яку не вдалося отримати під час перевірки; сумісність обмежень потрібно підтвердити для конкретного середовища UPC.

### Спільні поля запитів

- `trackingId` потрібен для кожного методу. Дотримуйтеся довжини 1–10 символів із розділу [«Формат `trackingId`»](#формат-trackingid).
- `tokenId` потрібен методам роботи з токеном. Дотримуйтеся формату з розділу [«Формат `tokenId`»](#формат-tokenid); SDK наразі не перевіряє цей формат локально.
- `reasonCode` та `reason` можна передати методам `deleteToken()`, `suspendToken()` і `resumeToken()`.
- `reasonCode` приймає одне зі значень: `DEVICE_LOST`, `DEVICE_STOLEN`, `SUSPECTED_FRAUD`, `ACCOUNT_CLOSED`, `NOT_FRAUD`, `DEVICE_FOUND` або `OTHER`.
- `getCardContent()` вимагає `contentId`; необов’язкове поле `brand` додається до XML, якщо його передано.
- `createToken()` перевіряє наявність номера картки, місяця й року завершення строку дії. Формат цих значень додатково тут не перевіряється.

## Як формується запит

Клієнт створює XML-документ із кореневим елементом `ECommerceConnect` і повідомленням `Message`. Назва XML-операції залежить від методу, наприклад `XMLCreateTokenRequest` або `XMLTokenStatusRequest`. Дані вкладених об’єктів перетворюються на вкладені XML-елементи, а текстові значення екрануються для XML.

Запит надсилається методом HTTP POST із заголовком `Content-Type: application/xml`. Відповідь повертається як звичайний рядок. Цей модуль **не розбирає XML-відповідь** і не вирішує, чи успішна саме платіжна операція: застосунок має перевірити вміст відповіді UPC.

## Перевірка даних і помилки

Якщо обов’язкове значення не передано, воно порожнє або перевищує задокументоване обмеження довжини, метод відхиляє Promise з помилкою `TypeError` або `RangeError`. У таких випадках HTTP-запит не надсилається.

Якщо сервер відповідає неуспішним HTTP-статусом, HTTP-клієнт кидає `FetchError`. Для неї доступне поле `status` із HTTP-статусом. Інші проблеми мережі, зокрема тайм-аут, також відхиляють Promise. Обробляйте помилки на рівні виклику:

```ts
try {
  const responseXml = await upc.getTokenStatus({
    trackingId: 'status-2',
    tokenId: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  });
  // За потреби розберіть і перевірте XML-відповідь UPC.
} catch (error) {
  console.error('Не вдалося отримати стан токена.', error);
}
```

Не виводьте об’єкт помилки або запит цілком у загальнодоступні журнали: перевірте, чи не містять вони конфіденційних даних.

## Діагностичні журнали

Якщо встановити `logging: true`, SDK записує через `console.info` URL, назву операції, частину HTTP-метаданих та XML запиту й відповіді. Значення елементів `CardNum`, `CVNum`, `TokenNumber`, `TAVV` і `tokenId` замінюються на `[REDACTED]`, а вміст `encodedData` вилучається. Довгі XML-повідомлення скорочуються.

Це редагування охоплює лише перелічені елементи й не гарантує приховування будь-яких інших конфіденційних полів. У виробничому середовищі залишайте журналювання вимкненим, якщо воно не потрібне, та не вважайте його заміною правил безпечного зберігання журналів.

