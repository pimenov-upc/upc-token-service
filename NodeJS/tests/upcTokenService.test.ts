import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UpcTokenService,
  UpcTokenServiceResource,
  type UpcTokenServiceOptions,
} from '../src/core/upcTokenService.js';

const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privateKey = keyPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
const publicKey = keyPair.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const merchantOptions: UpcTokenServiceOptions = {
  merchantId: '7651243',
  terminalId: 'E7651243',
  privateKey,
};

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return new Response(JSON.stringify({
    header: 'eyJhbGciOiJSUzUxMiJ9',
    payload: encodedPayload,
    signature: 'unused-in-these-unit-tests',
  }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createService(
  resource: string = 'test',
  options: Partial<UpcTokenServiceOptions> = {}
): UpcTokenService {
  return new UpcTokenService(resource, { ...merchantOptions, ...options });
}

function getRequest(): { url: string; init: RequestInit; envelope: SignedRequest } {
  const call = fetchMock.mock.calls[0];
  if (call === undefined) {
    throw new Error('Expected fetch to be called.');
  }

  const [input, init = {}] = call;
  return {
    url: String(input),
    init,
    envelope: JSON.parse(String(init.body)) as SignedRequest,
  };
}

interface SignedRequest {
  header: string;
  payload: string;
  signature: string;
}

function decodeSignedPayload(envelope: SignedRequest): Record<string, unknown> {
  return JSON.parse(Buffer.from(envelope.payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

function verifySignedRequest(envelope: SignedRequest): boolean {
  const header = JSON.parse(Buffer.from(envelope.header, 'base64url').toString('utf8')) as {
    alg: string;
  };
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${envelope.header}.${envelope.payload}`);
  verifier.end();
  return header.alg === 'RS256' && verifier.verify(publicKey, Buffer.from(envelope.signature, 'base64url'));
}

async function expectSignedPost(
  operation: () => Promise<unknown>,
  path: string,
  expectedPayload: Record<string, unknown>,
  resource: string = UpcTokenServiceResource.Test
): Promise<void> {
  await operation();

  const { url, init, envelope } = getRequest();
  expect(url).toBe(`${resource}${path}`);
  expect(init.method).toBe('POST');
  expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  expect(decodeSignedPayload(envelope)).toEqual(expectedPayload);
  expect(verifySignedRequest(envelope)).toBe(true);
}

describe('UpcTokenService', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(jsonResponse({ TranCode: '000', Comment: 'OK' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the test resource and signs a create-token request', async () => {
    const service = createService('test');

    await expectSignedPost(
      () => service.createToken({
        trackingId: 'create-1',
        card: {
          cardNum: '4111111111111111',
          expMonth: '12',
          expYear: '2030',
          cvNum: '123',
        },
      }),
      '/go/token/create',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        TrackingId: 'create-1',
        card: {
          CardNum: '4111111111111111',
          expMonth: '12',
          expYear: '2030',
          CVNum: '123',
        },
      }
    );
  });

  it('omits optional CVV when creating a token without one', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.createToken({
        trackingId: 'create-2',
        card: { cardNum: '4111111111111111', expMonth: '12', expYear: '2030' },
      }),
      '/go/token/create',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        TrackingId: 'create-2',
        card: { CardNum: '4111111111111111', expMonth: '12', expYear: '2030' },
      }
    );
  });

  it('refreshes a token with UPC request field casing', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.refreshToken({ trackingId: 'refresh-1', tokenId: 'token-1' }),
      '/go/token/refresh',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'refresh-1',
        UPCToken: 'token-1',
      }
    );
  });

  it('deletes a token and includes optional reason fields', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.deleteToken({
        trackingId: 'delete-1',
        tokenId: 'token-1',
        reasonCode: 'SUSPECTED_FRAUD',
        reason: 'Reported lost device',
      }),
      '/go/token/delete',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'delete-1',
        UPCToken: 'token-1',
        ReasonCode: 'SUSPECTED_FRAUD',
        Reason: 'Reported lost device',
      }
    );
  });

  it('gets token status', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' }),
      '/go/token/status',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'status-1',
        UPCToken: 'token-1',
      }
    );
  });

  it('suspends a token', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.suspendToken({
        trackingId: 'suspend-1',
        tokenId: 'token-1',
        reasonCode: 'DEVICE_LOST',
      }),
      '/go/token/suspend',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'suspend-1',
        UPCToken: 'token-1',
        ReasonCode: 'DEVICE_LOST',
      }
    );
  });

  it('resumes a token', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.resumeToken({
        trackingId: 'resume-1',
        tokenId: 'token-1',
        reasonCode: 'DEVICE_FOUND',
      }),
      '/go/token/resume',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'resume-1',
        UPCToken: 'token-1',
        ReasonCode: 'DEVICE_FOUND',
      }
    );
  });

  it('gets card content and includes an optional brand when supplied', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.getCardContent({
        trackingId: 'content-1',
        contentId: 'content-1-id',
        brand: 'VISA',
      }),
      '/go/card/content',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'content-1',
        contentId: 'content-1-id',
        brand: 'VISA',
      }
    );
  });

  it('gets card metadata for a token', async () => {
    const service = createService();

    await expectSignedPost(
      () => service.getCardMetadata({ trackingId: 'metadata-1', tokenId: 'token-1' }),
      '/go/card/metadata',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'metadata-1',
        UPCToken: 'token-1',
      }
    );
  });

  it('uses the production endpoint for the production environment', async () => {
    const service = createService('production');

    await expectSignedPost(
      () => service.getTokenStatus({ trackingId: 'status-prod', tokenId: 'token-1' }),
      '/go/token/status',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'status-prod',
        UPCToken: 'token-1',
      },
      UpcTokenServiceResource.Production
    );
  });

  it('accepts a custom HTTPS resource and uses only its origin', async () => {
    const service = createService('https://custom.upc.example/api/prefix');

    await expectSignedPost(
      () => service.getTokenStatus({ trackingId: 'status-custom', tokenId: 'token-1' }),
      '/go/token/status',
      {
        MerchantID: '7651243',
        TerminalID: 'E7651243',
        trackingId: 'status-custom',
        UPCToken: 'token-1',
      },
      'https://custom.upc.example'
    );
  });

  it.each(['', '   '])('rejects an empty tracking ID (%j)', async (trackingId) => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId, tokenId: 'token-1' })
    ).rejects.toThrow('trackingId must not be empty.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a tracking ID longer than 100 characters', async () => {
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'x'.repeat(101), tokenId: 'token-1' })
    ).rejects.toThrow('trackingId must not exceed 100 characters.');
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
    ['private key', { privateKey: '' }],
  ])('rejects an empty %s in client configuration', (_name, option) => {
    expect(() => createService('test', option)).toThrow();
  });

  it.each(['http://insecure.example', 'not-a-url'])('rejects invalid resource %s', (resource) => {
    expect(() => createService(resource)).toThrow();
  });

  it('returns the decoded response payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ TranCode: '000', TokenStatus: 'ACTIVE' }));
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' })
    ).resolves.toEqual({ TranCode: '000', TokenStatus: 'ACTIVE' });
  });

  it('surfaces non-success HTTP responses', async () => {
    fetchMock.mockResolvedValue(new Response('Gateway unavailable', { status: 502 }));
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' })
    ).rejects.toMatchObject({ status: 502 });
  });

  it('rejects a response with an invalid base64url JSON payload', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ payload: 'not-json' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    const service = createService();

    await expect(
      service.getTokenStatus({ trackingId: 'status-1', tokenId: 'token-1' })
    ).rejects.toThrow('Could not decode UPC Token Service response payload.');
  });
});
