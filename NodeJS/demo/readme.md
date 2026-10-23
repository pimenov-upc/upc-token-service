Універсальне демо для всіх операцій Upc Token Service SDK:

- `create-token`, `refresh`, `delete`, `status`, `suspend`, `resume`, `card-content`, `card-metadata`
- Команда запуску: `npm run demo -- status` — замініть `status` потрібною операцією.
- Параметри, як-от `UPC_TRACKING_ID`, `UPC_TOKEN_ID` і `UPC_CONTENT_ID`, додані до шаблону `.env.example`.
- Для `delete` потрібне явне підтвердження `--confirm-delete`, оскільки видалення незворотне. 
- XML-відповідь виводиться із замаскованими чутливими значеннями.
