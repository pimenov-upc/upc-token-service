# UPC Token Service SDK for Kotlin

Kotlin-клієнт для UPC Token Service. За назвами публічних типів та операцій він відповідає NodeJS-реалізації. Клієнт формує XML, надсилає HTTPS POST-запити та повертає необроблену XML-відповідь. Потрібен JDK 17 або новіший; HTTP-клієнт використовує лише стандартну бібліотеку JDK.

## Можливості

- Створення, оновлення, видалення, призупинення та відновлення токенів.
- Отримання стану токена, вмісту й метаданих картки.
- Тестове, виробниче або власне HTTPS-середовище.
- Перевірка обов’язкових значень і довжини `trackingId`.
- Необов’язкове журналювання з маскуванням чутливих XML-даних.

## Використання

```kotlin
import upctokenservice.TokenRequest
import upctokenservice.UpcTokenService
import upctokenservice.UpcTokenServiceOptions

val client = UpcTokenService(
    "test",
    UpcTokenServiceOptions(
        merchantId = "7651243",
        terminalId = "E7651243",
        logging = true,
    ),
)

val response = client.getTokenStatus(
    TokenRequest(trackingId = "status-1", tokenId = "token-1"),
)
println(response)
```

`resource` приймає `"test"`, `"production"` або базову власну HTTPS-адресу, наприклад `"https://certsrv1.ad.upc.intranet:8443"`. Власна адреса не повинна містити шлях API, query-параметри чи fragment. Шляхи API додаються автоматично.

Усі вісім методів мають ті самі назви й призначення, що й у NodeJS: `createToken()`, `refreshToken()`, `deleteToken()`, `getTokenStatus()`, `suspendToken()`, `resumeToken()`, `getCardContent()` та `getCardMetadata()`. Методи Kotlin синхронні та повертають XML-рядок; помилки HTTP представлені `FetchError`.

`timeout` задається в мілісекундах, за замовчуванням — 60 000 мс. `logging` за замовчуванням вимкнено. Необов’язкові значення (`cvNum`, `brand`, `reasonCode`, `reason`) вилучаються з XML, якщо дорівнюють `null`.

## Збірка

Перейдіть до каталогу `Kotlin` і виконайте `gradle build` за наявності Gradle.
