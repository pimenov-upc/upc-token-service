const HTTP_TIMEOUT_MS = 60000;

export class FetchError extends Error {
  public status: number;
  public response: Response;

  constructor(
    response: Response,
    public data?: unknown
  ) {
    super(response.statusText || `Request failed with status ${response.status}`);
    this.name = 'FetchError';
    this.status = response.status;
    this.response = response;
    this.data = data;
  }
}

/**
 * Executes HTTP request with timeout and throws on non-2xx responses.
 */
export const fetchWithTimeout = async (
  url: string,
  options?: RequestInit,
  timeout: number = HTTP_TIMEOUT_MS
): Promise<Response> => {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: abortController.signal,
    });

    if (!response.ok) {
      throw new FetchError(response, {
        url,
        timeout,
      });
    }

    return response;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const get = async (
  url: string,
  options?: RequestInit,
  timeout?: number
): Promise<Response> => {
  return fetchWithTimeout(url, { ...options, method: 'GET' }, timeout);
};

const canHaveBody = (method: HttpMethod): boolean => method !== 'GET' && method !== 'HEAD';

const isJsonSerializableBody = (body: unknown): boolean => {
  return (
    body !== undefined &&
    typeof body !== 'string' &&
    !(body instanceof FormData) &&
    !(body instanceof URLSearchParams) &&
    !(body instanceof Blob) &&
    !(body instanceof ArrayBuffer) &&
    !ArrayBuffer.isView(body)
  );
};

const toRequestBody = (body: unknown): BodyInit | undefined => {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === 'string') {
    return body;
  }

  if (
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  ) {
    return body as BodyInit;
  }

  return JSON.stringify(body);
};

const createHttpMethod =
  (method: HttpMethod) =>
  async (
    url: string,
    body?: unknown,
    options?: RequestInit,
    timeout?: number
  ): Promise<Response> => {
    const supportsBody = canHaveBody(method);
    const requestBody = supportsBody ? toRequestBody(body) : undefined;
    return fetchWithTimeout(
      url,
      {
        ...options,
        method,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
      },
      timeout
    );
  };

export const post = createHttpMethod('POST');
export const put = createHttpMethod('PUT');
export const patch = createHttpMethod('PATCH');
export const del = createHttpMethod('DELETE');
export const options = createHttpMethod('OPTIONS');
export const head = createHttpMethod('HEAD');
export const connect = createHttpMethod('CONNECT');
export const trace = createHttpMethod('TRACE');

type HttpReturnType =
  'text' | 'json' | 'blob' | 'arrayBuffer' | 'formData' | 'bytes' | 'raw' | 'auto';

type HttpMethod =
  'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'CONNECT' | 'TRACE';

interface HttpRequest {
  body?: unknown;
  options?: RequestInit;
  timeout?: number;
  returnType?: HttpReturnType;
}

class Http {
  private lastResponse: Response | null = null;
  private lastRequest: unknown;

  constructor(
    private baseUrl: string,
    private timeout: number = HTTP_TIMEOUT_MS
  ) {}

  get base(): string {
    return this.baseUrl;
  }

  get response(): Response | null {
    return this.lastResponse;
  }

  async request(
    endpoint: string,
    method: HttpMethod,
    requestOptions: HttpRequest
  ): Promise<Response> {
    const { body, options, timeout = this.timeout } = requestOptions;
    const supportsBody = canHaveBody(method);
    const requestBody = supportsBody ? toRequestBody(body) : undefined;
    const headers = new Headers(options?.headers);

    if (supportsBody && isJsonSerializableBody(body) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    return fetchWithTimeout(
      `${this.baseUrl}${endpoint}`,
      {
        ...options,
        method: method.toUpperCase() as HttpMethod,
        headers,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
      },
      timeout
    );
  }

  async getResultType(response: Response, returnType: HttpReturnType): Promise<unknown> {
    let data;
    switch (returnType) {
      case 'text':
        data = await response.text();
        break;
      case 'json':
        data = await response.json();
        break;
      case 'blob':
        data = await response.blob();
        break;
      case 'arrayBuffer':
        data = await response.arrayBuffer();
        break;
      case 'formData':
        data = await response.formData();
        break;
      case 'bytes': {
        const responseWithBytes = response as Response & {
          bytes?: () => Promise<Uint8Array>;
        };

        data =
          typeof responseWithBytes.bytes === 'function' ?
            await responseWithBytes.bytes()
          : new Uint8Array(await response.arrayBuffer());
        break;
      }
      case 'raw':
        data = response;
        break;
      case 'auto': {
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('application/json')) {
          data = await response.json();
        } else if (contentType.includes('text/')) {
          data = await response.text();
        } else {
          data = await response.blob();
        }
        break;
      }
      default:
        data = await response.text();
    }
    return data;
  }

  private async makeRequest(
    method: HttpMethod,
    endpoint: string,
    body?: unknown,
    options?: HttpRequest
  ): Promise<unknown> {
    const response = await this.request(endpoint, method, { body, ...options });

    this.lastResponse = response;
    this.lastRequest = { method, endpoint, body, options };

    return await this.getResultType(response, options?.returnType || 'auto');
  }

  async get(endpoint: string, options?: HttpRequest): Promise<unknown> {
    const result = await this.makeRequest('GET', endpoint, undefined, options);
    return result;
  }

  async post(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('POST', endpoint, body, options);
  }

  async put(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('PUT', endpoint, body, options);
  }

  async patch(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('PATCH', endpoint, body, options);
  }

  async delete(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('DELETE', endpoint, body, options);
  }

  async options(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('OPTIONS', endpoint, body, options);
  }

  async head(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('HEAD', endpoint, body, options);
  }

  async connect(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('CONNECT', endpoint, body, options);
  }

  async trace(endpoint: string, body?: unknown, options?: HttpRequest): Promise<unknown> {
    return await this.makeRequest('TRACE', endpoint, body, options);
  }
}

export default Http;
