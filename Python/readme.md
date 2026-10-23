# UPC Token Service — Python

Python 3.10+ клієнт без сторонніх залежностей:

```python
from upc_token_service import (
    CardDetails,
    CreateTokenRequest,
    UpcTokenService,
    UpcTokenServiceOptions,
)

client = UpcTokenService("test", UpcTokenServiceOptions("7651243", "E7651243"))
xml_response = client.createToken(
    CreateTokenRequest("tracking-1", CardDetails("4111111111111111", "12", "2030"))
)
```

Доступні методи: `createToken`, `refreshToken`, `deleteToken`, `getTokenStatus`,
`suspendToken`, `resumeToken`, `getCardContent`, `getCardMetadata`. Клієнт синхронний;
повертає сирий XML, а для HTTP-відповіді поза 2xx кидає `FetchError`. `timeout` задається
в мілісекундах.
