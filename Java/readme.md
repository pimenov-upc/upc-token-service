# UPC Token Service — Java

JDK 11+ клієнт без сторонніх залежностей. Пакет: `upctokenservice`.

```java
import upctokenservice.UpcTokenService;

var options = new UpcTokenService.UpcTokenServiceOptions("7651243", "E7651243");
var client = new UpcTokenService("test", options);
var response = client.createToken(new UpcTokenService.CreateTokenRequest(
    "tracking-1",
    new UpcTokenService.CardDetails("4111111111111111", "12", "2030")
));
```

Доступні операції: `createToken`, `refreshToken`, `deleteToken`, `getTokenStatus`,
`suspendToken`, `resumeToken`, `getCardContent`, `getCardMetadata`. Методи повертають
сирий XML та можуть кидати `IOException`, `InterruptedException` або `FetchError`.
Для власного сервера передайте базову HTTPS URL без шляху, наприклад
`https://cert.example.com`. Опції `timeout` задаються в мілісекундах.
