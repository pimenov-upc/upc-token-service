import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UpcTokenService,
  UpcTokenServiceResource,
  type UpcTokenServiceOptions,
} from '../src/core/upcTokenService.js';

const merchantOptions: UpcTokenServiceOptions = {
  merchantId: '7651243',
  terminalId: 'E7651243',
};
const fetchMock = vi.fn<typeof fetch>();
const xmlResponse = '<?xml version="1.0" encoding="UTF-8"?><ECommerceConnect><Message><XMLResponse><TranCode>000</TranCode></XMLResponse></Message></ECommerceConnect>';

function createService(resource = 'test', options: Partial<UpcTokenServiceOptions> = {}): UpcTokenService {
  return new UpcTokenService(resource, { ...merchantOptions, ...options });
}

function getRequest(): { url: string; init: RequestInit; body: string } {
  const call = fetchMock.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected fetch to be called.');
  }

  const [input, init = {}] = call;
  return { url: String(input), init, body: String(init.body) };
}

async function expectXmlPost(
  operation: () => Promise<string>,
  endpoint: string,
  expectedOperationXml: string,
  resource: string = UpcTokenServiceResource.Test
): Promise<void> {
  await expect(operation()).resolves.toBe(xmlResponse);

  const { url, init, body } = getRequest();
  expect(url).toBe(`${resource}${endpoint}`);
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/xml');
  expect(body).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?><ECommerceConnect /);
  expect(body).toContain('xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"');
  expect(body).toContain('xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"');
  expect(body).not.toContain('xmlpay-2.26.xsd');
  expect(body).toContain(expectedOperationXml);
  expect(body).toContain('<Message id="');
  expect(body).not.toContain('"header"');
  expect(body).not.toContain('"payload"');
  expect(body).not.toContain('"signature"');
}

describe('UpcTokenService XML API', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(xmlResponse, {
      status: 200,
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends an XML create-token request with card data', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.createToken({
        trackingId: 'create-1',
        card: { cardNum: '4111111111111111', expMonth: '12', expYear: '2030', cvNum: '123' },
      }),
      '/go/token/create',
      '<XMLCreateTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>create-1</trackingId><Card><CardNum>4111111111111111</CardNum><ExpYear>2030</ExpYear><ExpMonth>12</ExpMonth><CVNum>123</CVNum></Card></XMLCreateTokenRequest>'
    );
  });

  it('omits optional CVV from create-token XML when it is undefined', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.createToken({
        trackingId: 'create-2',
        card: { cardNum: '4111111111111111', expMonth: '12', expYear: '2030' },
      }),
      '/go/token/create',
      '<XMLCreateTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>create-2</trackingId><Card><CardNum>4111111111111111</CardNum><ExpYear>2030</ExpYear><ExpMonth>12</ExpMonth></Card></XMLCreateTokenRequest>'
    );
  });

  it('sends refresh-token XML with nested UPC token ID', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.refreshToken({ trackingId: 'refresh-1', tokenId: 'token-1' }),
      '/go/token/refresh',
      '<XMLRefreshTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>refresh-1</trackingId><UPCToken><tokenId>token-1</tokenId></UPCToken></XMLRefreshTokenRequest>'
    );
  });

  it('sends delete-token XML with nested update request and reason', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.deleteToken({
        trackingId: 'delete-1',
        tokenId: 'token-1',
        reasonCode: 'SUSPECTED_FRAUD',
        reason: 'Reported lost device',
      }),
      '/go/token/delete',
      '<XMLDeleteTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>delete-1</trackingId><UpdateTokenRequest><UPCToken><tokenId>token-1</tokenId></UPCToken><reasonCode>SUSPECTED_FRAUD</reasonCode><reason>Reported lost device</reason></UpdateTokenRequest></XMLDeleteTokenRequest>'
    );
  });

  it('sends token-status XML with nested UPC token ID', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' }),
      '/go/token/status',
      '<XMLTokenStatusRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>status-1</trackingId><UPCToken><tokenId>token-1</tokenId></UPCToken></XMLTokenStatusRequest>'
    );
  });

  it('sends suspend-token XML with nested update request and reason code', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.suspendToken({
        trackingId: 'suspend-1',
        tokenId: 'token-1',
        reasonCode: 'DEVICE_LOST',
      }),
      '/go/token/suspend',
      '<XMLSuspendTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>suspend-1</trackingId><UpdateTokenRequest><UPCToken><tokenId>token-1</tokenId></UPCToken><reasonCode>DEVICE_LOST</reasonCode></UpdateTokenRequest></XMLSuspendTokenRequest>'
    );
  });

  it('sends resume-token XML with nested update request and reason', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.resumeToken({
        trackingId: 'resume-1',
        tokenId: 'token-1',
        reasonCode: 'DEVICE_FOUND',
        reason: 'Device recovered',
      }),
      '/go/token/resume',
      '<XMLResumeTokenRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>resume-1</trackingId><UpdateTokenRequest><UPCToken><tokenId>token-1</tokenId></UPCToken><reasonCode>DEVICE_FOUND</reasonCode><reason>Device recovered</reason></UpdateTokenRequest></XMLResumeTokenRequest>'
    );
  });

  it('sends card-content XML and optional Brand element', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.getCardContent({
        trackingId: 'content-1',
        contentId: 'content-1-id',
        brand: 'VISA',
      }),
      '/go/card/content',
      '<XMLGetCardContentRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>content-1</trackingId><contentId>content-1-id</contentId><Brand>VISA</Brand></XMLGetCardContentRequest>'
    );
  });

  it('sends card-metadata XML with nested UPC token ID', async () => {
    const service = createService();

    await expectXmlPost(
      () => service.getCardMetadata({ trackingId: 'metadata-1', tokenId: 'token-1' }),
      '/go/card/metadata',
      '<XMLGetCardMetadataRequest><MerchantID>7651243</MerchantID><TerminalID>E7651243</TerminalID><trackingId>metadata-1</trackingId><UPCToken><tokenId>token-1</tokenId></UPCToken></XMLGetCardMetadataRequest>'
    );
  });

  it('uses the production endpoint', async () => {
    const service = createService('production');

    await expectXmlPost(
      () => service.getTokenStatus({ trackingId: 'prod-1', tokenId: 'token-1' }),
      '/go/token/status',
      '<XMLTokenStatusRequest>',
      UpcTokenServiceResource.Production
    );
  });

  it('appends the API path to a custom HTTPS base URL', async () => {
    const service = createService('https://certsrv1.ad.upc.intranet:8443');

    await expectXmlPost(
      () => service.getTokenStatus({ trackingId: 'custom1', tokenId: 'token-1' }),
      '/go/token/status',
      '<XMLTokenStatusRequest>',
      'https://certsrv1.ad.upc.intranet:8443'
    );
  });

  it('rejects a custom resource URL that already contains an API path', () => {
    expect(() => createService('https://certsrv1.ad.upc.intranet:8443/go/token/create'))
      .toThrow('Custom UPC resource must be a base HTTPS URL without a path');
  });

  it.each(['', '   '])('rejects an empty tracking ID (%j)', async (trackingId) => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId, tokenId: 'token-1' })
    ).rejects.toThrow('trackingId must not be empty.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a tracking ID longer than 10 characters', async () => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'x'.repeat(11), tokenId: 'token-1' })
    ).rejects.toThrow('trackingId must not exceed 10 characters.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an empty token ID', async () => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: '' })
    ).rejects.toThrow('tokenId must not be empty.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([null, undefined])('rejects a %s token request', async (request) => {
    const service = createService();

    await expect(service.getTokenStatus(request as never)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects an invalid empty request object', async () => {
    const service = createService();

    await expect(service.getTokenStatus({} as never)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['merchant ID', { merchantId: '' }],
    ['terminal ID', { terminalId: '' }],
  ])('rejects an empty %s in client configuration', (_name, option) => {
    expect(() => createService('test', option)).toThrow();
  });

  it.each(['http://insecure.example', 'not-a-url'])('rejects invalid resource %s', (resource) => {
    expect(() => createService(resource)).toThrow();
  });

  it('XML-escapes special characters in text fields', async () => {
    const service = createService();

    await service.getCardContent({
      trackingId: 't&<id>',
      contentId: 'content"id',
      brand: "VISA'&",
    });

    const { body } = getRequest();
    expect(body).toContain('<trackingId>t&amp;&lt;id&gt;</trackingId>');
    expect(body).toContain('<contentId>content&quot;id</contentId>');
    expect(body).toContain('<Brand>VISA&apos;&amp;</Brand>');
  });

  it('returns the raw XML response without JSON decoding', async () => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' })
    ).resolves.toBe(xmlResponse);
  });

  it('logs request and response details while redacting sensitive XML values', async () => {
    const sensitiveResponse =
      '<ECommerceConnect><tokenId>token-secret</tokenId><TAVV>tavv-secret</TAVV>' +
      '<TokenNumber>number-secret</TokenNumber><encodedData>binary-secret</encodedData></ECommerceConnect>';
    fetchMock.mockResolvedValue(new Response(sensitiveResponse, { status: 200 }));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const service = createService('test', { logging: true });

    await service.createToken({
      trackingId: 'log-1',
      card: { cardNum: '4111111111111111', expMonth: '12', expYear: '2030', cvNum: '123' },
    });

    const logs = infoSpy.mock.calls.flat().join(' ');
    expect(logs).toContain('POST https://ecg.test.upc.ua/go/token/create');
    expect(logs).toContain('Request Content-Type: application/xml');
    expect(logs).toContain('Request XML for XMLCreateTokenRequest');
    expect(logs).toContain('<XMLCreateTokenRequest>');
    expect(logs).toContain('HTTP 200 response for XMLCreateTokenRequest');
    expect(logs).toContain('[REDACTED]');
    expect(logs).toContain('[OMITTED]');
    expect(logs).not.toContain('4111111111111111');
    expect(logs).not.toContain('123');
    expect(logs).not.toContain('token-secret');
    expect(logs).not.toContain('tavv-secret');
    expect(logs).not.toContain('number-secret');
    expect(logs).not.toContain('binary-secret');
    infoSpy.mockRestore();
  });

  it('marks an empty XML response in logs', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 200 }));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const service = createService('test', { logging: true });

    await service.createToken({
      trackingId: 'empty-1',
      card: { cardNum: '4111111111111111', expMonth: '12', expYear: '2030' },
    });

    const logs = infoSpy.mock.calls.flat().join(' ');
    expect(logs).toContain('Empty: true');
    expect(logs).toContain('[empty response body]');
    expect(logs).not.toContain('4111111111111111');
    infoSpy.mockRestore();
  });

  it('does not log request or response when logging is disabled', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const service = createService();

    await service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' });
    fetchMock.mockResolvedValue(new Response('Gateway unavailable', { status: 502 }));
    await expect(
      service.getTokenStatus({ trackingId: 'status-2', tokenId: 'token-2' })
    ).rejects.toMatchObject({ status: 502 });

    expect(infoSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('surfaces non-success HTTP responses', async () => {
    fetchMock.mockResolvedValue(new Response('Gateway unavailable', { status: 502 }));
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' })
    ).rejects.toMatchObject({ status: 502 });
  });
});
