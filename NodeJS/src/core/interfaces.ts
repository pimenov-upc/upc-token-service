import type {
	HttpMethod,
	HttpReturnType,
	TokenReasonCode,
	UpcTokenServiceReturnType,
	XmlValue,
	JsonValue,
} from './types.js';

export interface UpcTokenServiceOptions {
	merchantId: string;
	terminalId: string;
	timeout?: number;
	/** Enables redacted request/response diagnostics. Defaults to false. */
	logging?: boolean;
	returnType?: UpcTokenServiceReturnType;
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

export interface XmlObject {
	[key: string]: XmlValue;
}

export interface JsonObject {
	[key: string]: JsonValue;
}

export interface XmlNode {
	name: string;
	value: XmlObject;
	text: string;
}

export interface HttpRequest {
	body?: unknown;
	options?: RequestInit;
	timeout?: number;
	returnType?: HttpReturnType;
}
