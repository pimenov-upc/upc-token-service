# UPC Token Service — Swift

Swift Package використовує Foundation `URLSession` і не має сторонніх залежностей.
Додайте каталог `Swift` як локальну залежність Swift Package:

```swift
let options = UpcTokenServiceOptions(merchantId: "7651243", terminalId: "E7651243")
let client = try UpcTokenService(resource: "test", options: options)
let response = try await client.createToken(
    CreateTokenRequest(
        trackingId: "tracking-1",
        card: CardDetails(cardNum: "4111111111111111", expMonth: "12", expYear: "2030")
    )
)
```

Доступні асинхронні методи: `createToken`, `refreshToken`, `deleteToken`, `getTokenStatus`,
`suspendToken`, `resumeToken`, `getCardContent`, `getCardMetadata`. Методи повертають сирий
XML; для HTTP-відповіді поза діапазоном 2xx повертається `FetchError`. `timeout` задається
в мілісекундах.
