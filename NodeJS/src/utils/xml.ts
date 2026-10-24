import type { XmlObject } from '../core/interfaces.js';
import type { XmlValue } from '../core/types.js';

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
	if (value === null || value === undefined) return '';

	if (typeof value === 'object') {
		const children = Object.entries(value)
			.map(([childName, childValue]) => serializeXmlElement(childName, childValue))
			.join('');
		return `<${name}>${children}</${name}>`;
	}

	return `<${name}>${escapeXml(String(value))}</${name}>`;
};

/** Serialize an operation payload into the UPC XML request envelope. */
export function createXmlRequest(
	operation: string,
	messageId: number,
	payload: XmlObject
): string {
	const requestBody = Object.entries(payload)
		.map(([name, value]) => serializeXmlElement(name, value))
		.join('');

	return `${XML_HEADER}${XML_ROOT_OPEN}<Message id="${messageId}" version="1.0">` +
		`<${operation}>${requestBody}</${operation}></Message></ECommerceConnect>`;
}

/** Redact sensitive payment and token values before logging XML. */
export function redactXmlForLog(xml: string): string {
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
}
