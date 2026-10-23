import Http, { FetchError } from '../utils/http.js';

export const UpcTokenServiceResource = {
	Test: 'https://ecg.test.upc.ua',
	Production: 'https://secure.upc.ua',
} as const;

export type UpcTokenServiceEnvironment = 'test' | 'production';
export type UpcTokenServiceResource =
	| UpcTokenServiceEnvironment
	| (string & {});

export interface UpcTokenServiceOptions {
	merchantId: string;
	terminalId: string;
	timeout?: number;
	/** Enables redacted request/response diagnostics. Defaults to false. */
	logging?: boolean;
}

export interface TokenRequest {
	trackingId: string;
	tokenId: string;
}

export interface CardDetails {
	cardNum: string;
	expMonth: string;
	expYear: string;
	cvNum?: string;
}

export interface CreateTokenRequest {
	trackingId: string;
	card: CardDetails;
}

export type TokenReasonCode =
	| 'DEVICE_LOST'
	| 'DEVICE_STOLEN'
	| 'SUSPECTED_FRAUD'
	| 'ACCOUNT_CLOSED'
	| 'NOT_FRAUD'
	| 'DEVICE_FOUND'
	| 'OTHER';

export interface UpdateTokenRequest extends TokenRequest {
	reasonCode?: TokenReasonCode;
	reason?: string;
}

export interface CardContentRequest {
	trackingId: string;
	contentId: string;
	brand?: string;
}

export interface CardMetadataRequest {
	trackingId: string;
	tokenId: string;
}

export type UpcTokenServiceResponse = string;

type XmlValue = string | number | boolean | null | undefined | XmlObject;
interface XmlObject {
	[key: string]: XmlValue;
}

let messageId = 0;

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
const XML_ROOT_OPEN =
	'<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ' +
	'xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd" ' +
	'xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" ' +
	'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
	'xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">';

const escapeXml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');

const serializeXmlElement = (name: string, value: XmlValue): string => {
	if (value === null || value === undefined) {
		return '';
	}

	if (typeof value === 'object') {
		const children = Object.entries(value)
			.map(([childName, childValue]) => serializeXmlElement(childName, childValue))
			.join('');
		return `<${name}>${children}</${name}>`;
	}

	return `<${name}>${escapeXml(String(value))}</${name}>`;
};

const redactXmlForLog = (xml: string): string => {
	const sensitiveTags = ['CardNum', 'CVNum', 'TokenNumber', 'TAVV', 'tokenId'];
	const redactedXml = sensitiveTags.reduce((result, tag) => {
		return result.replace(
			new RegExp(`(<${tag}\\b[^>]*>)[\\s\\S]*?(</${tag}>)`, 'gi'),
			'$1[REDACTED]$2'
		);
	}, xml).replace(
		/<encodedData\b[^>]*>[\s\S]*?<\/encodedData>/gi,
		'<encodedData>[OMITTED]</encodedData>'
	);

	const maxLogLength = 2000;
	return redactedXml.length > maxLogLength
		? `${redactedXml.slice(0, maxLogLength)}…[truncated]`
		: redactedXml;
};

const API_PATHS = {
	createToken: '/go/token/create',
	refreshToken: '/go/token/refresh',
	deleteToken: '/go/token/delete',
	getTokenStatus: '/go/token/status',
	suspendToken: '/go/token/suspend',
	resumeToken: '/go/token/resume',
	getCardContent: '/go/card/content',
	getCardMetadata: '/go/card/metadata',
} as const;

/**
 * UPC Token Service SDK client.
 * @example
 * const client = new UpcTokenService('test', {
 *   merchantId: '7651243',
 *   terminalId: 'E7651243',
 *   logging: true,
 * });
 * // Provide the custom server base URL; API paths are appended by the SDK.
 * const customClient = new UpcTokenService(
 *   'https://certsrv1.ad.upc.intranet:8443',
 *   { merchantId: '7651243', terminalId: 'E7651243' }
 * );
 */
export class UpcTokenService {
	private readonly http: Http;
	private readonly timeout: number | undefined;
	private readonly loggingEnabled: boolean;

	/**
	 * Creates an SDK client for the UPC test, production, or custom HTTPS resource.
	 */
	constructor(
		resource: UpcTokenServiceResource,
		private readonly options: UpcTokenServiceOptions
	) {
		const baseUrl = this.resolveBaseUrl(resource);
		this.validateNonEmpty(options.merchantId, 'merchantId');
		this.validateNonEmpty(options.terminalId, 'terminalId');
		this.validateMaxLength(options.merchantId, 35, 'merchantId');
		this.validateMaxLength(options.terminalId, 35, 'terminalId');

		this.timeout = options.timeout;
		this.loggingEnabled = options.logging ?? false;
		this.http = new Http(baseUrl, options.timeout);
	}

	/** Creates a UPC token for a card. */
	async createToken(request: CreateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.card?.cardNum, 'card.cardNum');
		this.validateNonEmpty(request.card?.expMonth, 'card.expMonth');
		this.validateNonEmpty(request.card?.expYear, 'card.expYear');

		const card: XmlObject = {
			CardNum: request.card.cardNum,
			ExpYear: request.card.expYear,
			ExpMonth: request.card.expMonth,
		};
		if (request.card.cvNum !== undefined) {
			card.CVNum = request.card.cvNum;
		}

		return this.send(API_PATHS.createToken, 'XMLCreateTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			Card: card,
		});
	}

	/** Refreshes an existing token and obtains fresh payment token data. */
	async refreshToken(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.refreshToken, 'XMLRefreshTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
	}

	/** Permanently deletes a token. Deleted tokens cannot be resumed. */
	async deleteToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.deleteToken, 'XMLDeleteTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
	}

	/** Retrieves the current state of a token. */
	async getTokenStatus(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.getTokenStatus, 'XMLTokenStatusRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
	}

	/** Suspends a token, allowing it to be resumed later. */
	async suspendToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.suspendToken, 'XMLSuspendTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
	}

	/** Resumes a previously suspended token. */
	async resumeToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.resumeToken, 'XMLResumeTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
	}

	/** Retrieves card content by its content ID. */
	async getCardContent(request: CardContentRequest): Promise<UpcTokenServiceResponse> {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.contentId, 'contentId');

		return this.send(API_PATHS.getCardContent, 'XMLGetCardContentRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			contentId: request.contentId,
			...(request.brand !== undefined ? { Brand: request.brand } : {}),
		});
	}

	/** Retrieves card metadata for a token. */
	async getCardMetadata(request: CardMetadataRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.getCardMetadata, 'XMLGetCardMetadataRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
	}

	private merchantPayload(): { MerchantID: string; TerminalID: string } {
		return {
			MerchantID: this.options.merchantId,
			TerminalID: this.options.terminalId,
		};
	}

	private reasonPayload(
		request: UpdateTokenRequest
	): { reasonCode?: TokenReasonCode; reason?: string } {
		return {
			...(request.reasonCode !== undefined ? { reasonCode: request.reasonCode } : {}),
			...(request.reason !== undefined ? { reason: request.reason } : {}),
		};
	}

	private async send(
		endpoint: string,
		operation: string,
		payload: XmlObject
	): Promise<UpcTokenServiceResponse> {
		const xml = this.createXmlRequest(operation, payload);
		const url = `${this.http.base}${endpoint}`;
		if (this.loggingEnabled) {
			console.info(`[UPC Token Service] POST ${url} (${operation})`);
			console.info('[UPC Token Service] Request Content-Type: application/xml');
			console.info(`[UPC Token Service] Request XML for ${operation}:`, redactXmlForLog(xml));
		}

		try {
			const response = await this.http.post(endpoint, xml, {
				options: {
					headers: { 'Content-Type': 'application/xml' },
				},
				returnType: 'text',
				...(this.timeout !== undefined ? { timeout: this.timeout } : {}),
			});
			const responseXml = response as string;
			const httpResponse = this.http.response;
			const status = httpResponse?.status ?? 'unknown';
			const contentType = httpResponse?.headers.get('content-type') ?? 'not provided';
			const contentLength = httpResponse?.headers.get('content-length') ?? 'not provided';
			const requestId =
				httpResponse?.headers.get('x-request-id') ??
				httpResponse?.headers.get('x-correlation-id') ??
				httpResponse?.headers.get('correlation-id') ??
				'not provided';
			if (this.loggingEnabled) {
				console.info(
					`[UPC Token Service] HTTP ${status} response for ${operation} ` +
						`(Content-Type: ${contentType}; Content-Length: ${contentLength}; ` +
						`Request-ID: ${requestId}; Empty: ${responseXml.length === 0}):`,
					responseXml.length > 0 ? redactXmlForLog(responseXml) : '[empty response body]'
				);
			}
			return responseXml;
		} catch (error) {
			const status =
				error instanceof FetchError ? error.status : this.http.response?.status ?? 'unavailable';
			const message = error instanceof Error ? error.message : 'Unknown error';
			if (this.loggingEnabled) {
				console.error(
					`[UPC Token Service] ${operation} failed (HTTP ${status}): ${message}`
				);
			}
			throw error;
		}
	}

	private createXmlRequest(operation: string, payload: XmlObject): string {
		messageId += 1;
		const requestBody = Object.entries(payload)
			.map(([name, value]) => serializeXmlElement(name, value))
			.join('');

		return `${XML_HEADER}${XML_ROOT_OPEN}<Message id="${messageId}" version="1.0">` +
			`<${operation}>${requestBody}</${operation}></Message></ECommerceConnect>`;
	}

	private resolveBaseUrl(resource: UpcTokenServiceResource): string {
		const resourceUrl =
			resource === 'test' ? UpcTokenServiceResource.Test
			: resource === 'production' ? UpcTokenServiceResource.Production
			: resource;

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(resourceUrl);
		} catch (error) {
			throw new TypeError('resource must be a valid UPC HTTPS URL or environment name.', {
				cause: error,
			});
		}

		if (parsedUrl.protocol !== 'https:') {
			throw new TypeError('UPC Token Service resource must use HTTPS.');
		}
		if (parsedUrl.pathname !== '/' || parsedUrl.search || parsedUrl.hash) {
			throw new TypeError(
				'Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.'
			);
		}

		return parsedUrl.origin;
	}

	private validateTokenRequest(request: TokenRequest): void {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.tokenId, 'tokenId');
	}

	private validateTrackingId(trackingId: string): void {
		this.validateNonEmpty(trackingId, 'trackingId');
		this.validateMaxLength(trackingId, 10, 'trackingId');
	}

	private validateNonEmpty(value: string | undefined, name: string): void {
		if (value === undefined || value.trim().length === 0) {
			throw new TypeError(`${name} must not be empty.`);
		}
	}

	private validateMaxLength(value: string, maxLength: number, name: string): void {
		if (value.length > maxLength) {
			throw new RangeError(`${name} must not exceed ${maxLength} characters.`);
		}
	}

}
