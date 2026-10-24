Універсальне демо для всіх операцій Upc Token Service SDK:

- `create-token`, `refresh`, `delete`, `status`, `suspend`, `resume`, `card-content`, `card-metadata`
- Команда запуску: `npm run demo -- status` — замініть `status` потрібною операцією.
- Параметри, як-от `UPC_TRACKING_ID`, `UPC_TOKEN_ID` і `UPC_CONTENT_ID`, додані до шаблону `.env.example`.
- Для `delete` потрібне явне підтвердження `--confirm-delete`, оскільки видалення незворотне. 
- Тип відповіді задає `UPC_RESULT_TYPE`: `raw` (типове значення) або `string` виводять XML-рядок, `json` — JSON-об’єкт.
- Вивід відповіді маскує відомі чутливі значення як у XML, так і в JSON.
