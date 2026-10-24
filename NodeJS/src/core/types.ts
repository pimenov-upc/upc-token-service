import type { JsonObject, XmlObject } from './interfaces.js';

export type UpcTokenServiceEnvironment = 'test' | 'production';
export type UpcTokenServiceResource = UpcTokenServiceEnvironment | (string & {});
export type TokenReasonCode =
	| 'DEVICE_LOST'
	| 'DEVICE_STOLEN'
	| 'SUSPECTED_FRAUD'
	| 'ACCOUNT_CLOSED'
	| 'NOT_FRAUD'
	| 'DEVICE_FOUND'
	| 'OTHER';
export type UpcTokenServiceReturnType = 'json' | 'raw' | 'string';
export type UpcTokenServiceResponse = string | JsonObject;

export type XmlValue = string | XmlObject | XmlValue[];
export type JsonValue = string | JsonObject | JsonValue[];

export type HttpReturnType =
	| 'text'
	| 'json'
	| 'blob'
	| 'arrayBuffer'
	| 'formData'
	| 'bytes'
	| 'raw'
	| 'auto';
export type HttpMethod =
	| 'GET'
	| 'POST'
	| 'PUT'
	| 'PATCH'
	| 'DELETE'
	| 'OPTIONS'
	| 'HEAD'
	| 'CONNECT'
	| 'TRACE';
