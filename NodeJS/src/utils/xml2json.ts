import type { JsonObject, XmlObject } from '../core/interfaces.js';
import type { JsonValue, XmlValue } from '../core/types.js';
import { str2xml } from './str2xml.js';

function convertValue(value: XmlValue): JsonValue {
	if (Array.isArray(value)) return value.map(convertValue);
	if (typeof value === 'string') return value;

	const entries = Object.entries(value as XmlObject);
	if (entries.length === 0) return '';
	if (entries.length === 1 && entries[0]?.[0] === '#text') {
		return entries[0][1] as string;
	}

	return Object.fromEntries(entries.map(([key, child]) => [key, convertValue(child)]));
}

/** Convert XML text to its JSON-compatible plain-object representation. */
export function xml2json(xml: string): JsonObject {
	const parsed: XmlObject = str2xml(xml);
	return Object.fromEntries(
		Object.entries(parsed).map(([key, value]) => [key, convertValue(value)])
	);
}
