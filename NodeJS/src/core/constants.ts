export const UpcTokenServiceResource = {
	Test: 'https://ecg.test.upc.ua',
	Production: 'https://secure.upc.ua',
} as const;

export const API_PATHS = {
	createToken: '/go/token/create',
	refreshToken: '/go/token/refresh',
	deleteToken: '/go/token/delete',
	getTokenStatus: '/go/token/status',
	suspendToken: '/go/token/suspend',
	resumeToken: '/go/token/resume',
	getCardContent: '/go/card/content',
	getCardMetadata: '/go/card/metadata',
} as const;
