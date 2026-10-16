import { createSign } from 'node:crypto';
import Http from '../utils/http.js';

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
	privateKey: string | Buffer;
	timeout?: number;
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

export type UpcTokenServiceResponse = Record<string, unknown>;

interface SignedRequest {
	header: string;
	payload: string;
	signature: string;
}

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
 *   privateKey: process.env.UPC_PRIVATE_KEY!,
 * });
 */
export class UpcTokenService {
	private readonly http: Http;
	private readonly timeout: number | undefined;

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
		this.validateNonEmpty(options.privateKey, 'privateKey');
		this.validateMaxLength(options.merchantId, 35, 'merchantId');
		this.validateMaxLength(options.terminalId, 35, 'terminalId');

		this.timeout = options.timeout;
		this.http = new Http(baseUrl, options.timeout);
	}

	/** Creates a UPC token for a card. */
	async createToken(request: CreateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.card?.cardNum, 'card.cardNum');
		this.validateNonEmpty(request.card?.expMonth, 'card.expMonth');
		this.validateNonEmpty(request.card?.expYear, 'card.expYear');

		const card: Record<string, string> = {
			CardNum: request.card.cardNum,
			expMonth: request.card.expMonth,
			expYear: request.card.expYear,
		};
		if (request.card.cvNum !== undefined) {
			card.CVNum = request.card.cvNum;
		}

		return this.send(API_PATHS.createToken, {
			...this.merchantPayload(),
			TrackingId: request.trackingId,
			card,
		});
	}

	/** Refreshes an existing token and obtains fresh payment token data. */
	async refreshToken(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.refreshToken, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
		});
	}

	/** Permanently deletes a token. Deleted tokens cannot be resumed. */
	async deleteToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.deleteToken, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
			...this.reasonPayload(request),
		});
	}

	/** Retrieves the current state of a token. */
	async getTokenStatus(request: TokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.getTokenStatus, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
		});
	}

	/** Suspends a token, allowing it to be resumed later. */
	async suspendToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.suspendToken, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
			...this.reasonPayload(request),
		});
	}

	/** Resumes a previously suspended token. */
	async resumeToken(request: UpdateTokenRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.resumeToken, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
			...this.reasonPayload(request),
		});
	}

	/** Retrieves card content by its content ID. */
	async getCardContent(request: CardContentRequest): Promise<UpcTokenServiceResponse> {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.contentId, 'contentId');

		return this.send(API_PATHS.getCardContent, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			contentId: request.contentId,
			...(request.brand !== undefined ? { brand: request.brand } : {}),
		});
	}

	/** Retrieves card metadata for a token. */
	async getCardMetadata(request: CardMetadataRequest): Promise<UpcTokenServiceResponse> {
		this.validateTokenRequest(request);
		return this.send(API_PATHS.getCardMetadata, {
			...this.merchantPayload(),
			trackingId: request.trackingId,
			UPCToken: request.tokenId,
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
	): { ReasonCode?: TokenReasonCode; Reason?: string } {
		return {
			...(request.reasonCode !== undefined ? { ReasonCode: request.reasonCode } : {}),
			...(request.reason !== undefined ? { Reason: request.reason } : {}),
		};
	}

	private async send(
		endpoint: string,
		payload: Record<string, unknown>
	): Promise<UpcTokenServiceResponse> {
		const envelope = this.signPayload(payload);
		const response = await this.http.post(endpoint, envelope, {
			returnType: 'json',
			...(this.timeout !== undefined ? { timeout: this.timeout } : {}),
		});
		return this.decodeResponse(response);
	}

	private signPayload(payload: Record<string, unknown>): SignedRequest {
		const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
		const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
		const signingInput = `${header}.${encodedPayload}`;
		const signer = createSign('RSA-SHA256');
		signer.update(signingInput);
		signer.end();

		return {
			header,
			payload: encodedPayload,
			signature: signer.sign(this.options.privateKey).toString('base64url'),
		};
	}

	private decodeResponse(response: unknown): UpcTokenServiceResponse {
		if (!this.isRecord(response)) {
			throw new Error('UPC Token Service returned an invalid response envelope.');
		}

		if (typeof response.payload !== 'string') {
			return response;
		}

		try {
			const decodedPayload = JSON.parse(
				Buffer.from(response.payload, 'base64url').toString('utf8')
			) as unknown;
			if (!this.isRecord(decodedPayload)) {
				throw new Error('Decoded response payload is not a JSON object.');
			}
			return decodedPayload;
		} catch (error) {
			throw new Error('Could not decode UPC Token Service response payload.', {
				cause: error,
			});
		}
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
		return parsedUrl.origin;
	}

	private validateTokenRequest(request: TokenRequest): void {
		this.validateTrackingId(request.trackingId);
		this.validateNonEmpty(request.tokenId, 'tokenId');
	}

	private validateTrackingId(trackingId: string): void {
		this.validateNonEmpty(trackingId, 'trackingId');
		this.validateMaxLength(trackingId, 100, 'trackingId');
	}

	private validateNonEmpty(value: string | Buffer, name: string): void {
		if (typeof value === 'string' ? value.trim().length === 0 : value.length === 0) {
			throw new TypeError(`${name} must not be empty.`);
		}
	}

	private validateMaxLength(value: string, maxLength: number, name: string): void {
		if (value.length > maxLength) {
			throw new RangeError(`${name} must not exceed ${maxLength} characters.`);
		}
	}

	private isRecord(value: unknown): value is Record<string, unknown> {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}
}
