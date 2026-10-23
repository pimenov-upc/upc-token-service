# UPC Token Service SDK for Go

Go-клієнт для UPC Token Service. За функціональністю та назвами операцій відповідає NodeJS-реалізації. Через правила експорту Go публічні методи починаються з великої літери: наприклад, `createToken()` у NodeJS — `CreateToken()` у Go.

## Можливості

- Створення, оновлення, видалення, призупинення та відновлення токенів.
- Отримання стану токена, вмісту й метаданих картки.
- Тестове, виробниче або власне HTTPS-середовище.
- Перевірка обов’язкових значень і довжини `trackingId`.
- Повернення необробленої XML-відповіді; HTTP-помилки надаються як `*FetchError`.
- Необов’язкові діагностичні журнали з маскуванням номерів карток, CVV, токенів і закодованих даних.

## Встановлення

Клієнт використовує лише стандартну бібліотеку Go. У межах цього репозиторію перейдіть до каталогу `Go` і виконуйте команди звідти.

## Використання

```go
client, err := upctokenservice.NewUpcTokenService("test", upctokenservice.UpcTokenServiceOptions{
	MerchantID: "7651243",
	TerminalID: "E7651243",
})
if err != nil {
	return err
}

response, err := client.GetTokenStatus(upctokenservice.TokenRequest{
	TrackingID: "status-1",
	TokenID:    "token-1",
})
if err != nil {
	return err
}
fmt.Println(response)
```

Параметр середовища може бути `"test"`, `"production"` або базовим HTTPS URL, наприклад `"https://certsrv1.ad.upc.intranet:8443"`. Власна адреса не повинна містити шлях, query-параметри чи fragment — шлях API додається клієнтом автоматично.

## Публічний API

| Операція NodeJS | Метод Go | Запит |
| --- | --- | --- |
| `createToken()` | `CreateToken()` | `CreateTokenRequest` |
| `refreshToken()` | `RefreshToken()` | `TokenRequest` |
| `deleteToken()` | `DeleteToken()` | `UpdateTokenRequest` |
| `getTokenStatus()` | `GetTokenStatus()` | `TokenRequest` |
| `suspendToken()` | `SuspendToken()` | `UpdateTokenRequest` |
| `resumeToken()` | `ResumeToken()` | `UpdateTokenRequest` |
| `getCardContent()` | `GetCardContent()` | `CardContentRequest` |
| `getCardMetadata()` | `GetCardMetadata()` | `CardMetadataRequest` |

Поля з необов’язковими значеннями задаються вказівниками: `CVNum`, `Brand`, `ReasonCode`, `Reason`. Якщо вказівник `nil`, XML-елемент не додається.

`Timeout` задається як `time.Duration`; значення `0` означає стандартні 60 секунд. За потреби можна передати власний `HTTPClient` (наприклад, для налаштування transport).

## Перевірка

```sh
go test ./...
go vet ./...
```

## Демо

У каталозі `demo` є приклад запуску всіх восьми операцій. Налаштуйте змінні оточення, описані в `demo/readme.md`, і виконайте `go run ./demo <operation>`.
