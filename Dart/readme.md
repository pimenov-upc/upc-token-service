# UPC Token Service — Dart

Dart-клієнт для UPC Token Service: формує XML-запити та підтримує створення, оновлення й керування токенами, а також отримання вмісту й метаданих картки.

Потрібен Dart SDK 3.3 або новіший. 

У каталозі `Dart` виконайте:
```shell
dart pub get
```

Приклад використання:
```dart
import 'package:upc_token_service/upc_token_service.dart';

final client = UpcTokenService(
	'test',
	const UpcTokenServiceOptions(
		merchantId: 'MERCHANT_ID',
		terminalId: 'TERMINAL_ID',
	),
);

try {
	final xml = await client.getTokenStatus(
		const TokenRequest(trackingId: 'status-1', tokenId: 'TOKEN_ID'),
	);
	print(xml);
} finally {
	client.close();
}
```

Повний опис API наведено в [документації](docs/readme.md). Приклад запуску операцій — у [demo](demo/README.md); використовуйте тестове середовище та тестові платіжні дані.
