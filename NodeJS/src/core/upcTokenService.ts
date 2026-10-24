import Http, { FetchError } from '../utils/http.js';
import { xml2json } from '../utils/xml2json.js';
import { createXmlRequest, redactXmlForLog } from '../utils/xml.js';
import { API_PATHS, UpcTokenServiceResource } from './constants.js';
import type {
	CardContentRequest,
	CardMetadataRequest,
	CreateTokenRequest,
	XmlObject,
	TokenRequest,
	UpdateTokenRequest,
	UpcTokenServiceOptions,
} from './interfaces.js';
import type {
	TokenReasonCode,
	UpcTokenServiceEnvironment,
	UpcTokenServiceResource as UpcTokenServiceResourceType,
	UpcTokenServiceResponse,
	UpcTokenServiceReturnType,
} from './types.js';

export { UpcTokenServiceResource };

let messageId = 0;

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
	private readonly returnType: UpcTokenServiceReturnType;

	/**
	 * Creates an SDK client for the UPC test, production, or custom HTTPS resource.
	 */
	constructor(
		resource: UpcTokenServiceResourceType,
		private readonly options: UpcTokenServiceOptions
	) {
		const baseUrl = this.resolveBaseUrl(resource);
		this.validateNonEmpty(options.merchantId, 'merchantId');
		this.validateNonEmpty(options.terminalId, 'terminalId');
		this.validateMaxLength(options.merchantId, 35, 'merchantId');
		this.validateMaxLength(options.terminalId, 35, 'terminalId');

		this.timeout = options.timeout;
		this.loggingEnabled = options.logging ?? false;
		this.returnType = options.returnType ?? 'raw';
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

		const result = await this.send(API_PATHS.createToken, 'XMLCreateTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			Card: card,
		});
		
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Refreshes an existing token and obtains fresh payment token data. */
	async refreshToken(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.refreshToken, 'XMLRefreshTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Permanently deletes a token. Deleted tokens cannot be resumed. */
	async deleteToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.deleteToken, 'XMLDeleteTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Retrieves the current state of a token. */
	async getTokenStatus(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.getTokenStatus, 'XMLTokenStatusRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Suspends a token, allowing it to be resumed later. */
	async suspendToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.suspendToken, 'XMLSuspendTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Resumes a previously suspended token. */
	async resumeToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.resumeToken, 'XMLResumeTokenRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UpdateTokenRequest: {
				UPCToken: { tokenId: request.tokenId },
				...this.reasonPayload(request),
			},
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Retrieves card content by its content ID. */
	async getCardContent(request: CardContentRequest): Promise<UpcTokenServiceResponse> {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.contentId, 'contentId');

		const result = await this.send(API_PATHS.getCardContent, 'XMLGetCardContentRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			contentId: request.contentId,
			...(request.brand !== undefined ? { Brand: request.brand } : {}),
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
	}

	/** Retrieves card metadata for a token. */
	async getCardMetadata(request: CardMetadataRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		const result = await this.send(API_PATHS.getCardMetadata, 'XMLGetCardMetadataRequest', {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: { tokenId: request.tokenId },
		});
		if (this.returnType === 'json') {
			return xml2json(result);
		}
		return result;
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
	): Promise<string> {
		messageId += 1;
		const xml = createXmlRequest(operation, messageId, payload);
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

	private resolveBaseUrl(resource: UpcTokenServiceResourceType): string {
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
