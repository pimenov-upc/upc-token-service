<?php
declare(strict_types=1);

namespace UpcTokenService;

/** Standard UPC Token Service endpoints. */
final class UpcTokenServiceResource
{
    public const Test = 'https://ecg.test.upc.ua';
    public const Production = 'https://secure.upc.ua';
}

/** Named standard environments accepted by the client constructor. */
final class UpcTokenServiceEnvironment
{
    public const Test = 'test';
    public const Production = 'production';
}

/** Client configuration; timeout is in milliseconds and defaults to 60 seconds. */
final class UpcTokenServiceOptions
{
    public function __construct(
        public string $merchantId,
        public string $terminalId,
        public ?int $timeout = null,
        public bool $logging = false,
    ) {}
}

class TokenRequest
{
    public function __construct(public string $trackingId, public string $tokenId) {}
}

final class CardDetails
{
    public function __construct(
        public string $cardNum,
        public string $expMonth,
        public string $expYear,
        public ?string $cvNum = null,
    ) {}
}

final class CreateTokenRequest
{
    public function __construct(public string $trackingId, public CardDetails $card) {}
}

/** Permitted token state-change reasons. */
final class TokenReasonCode
{
    public const DEVICE_LOST = 'DEVICE_LOST';
    public const DEVICE_STOLEN = 'DEVICE_STOLEN';
    public const SUSPECTED_FRAUD = 'SUSPECTED_FRAUD';
    public const ACCOUNT_CLOSED = 'ACCOUNT_CLOSED';
    public const NOT_FRAUD = 'NOT_FRAUD';
    public const DEVICE_FOUND = 'DEVICE_FOUND';
    public const OTHER = 'OTHER';
}

final class UpdateTokenRequest extends TokenRequest
{
    public function __construct(
        string $trackingId,
        string $tokenId,
        public ?string $reasonCode = null,
        public ?string $reason = null,
    ) { parent::__construct($trackingId, $tokenId); }
}

final class CardContentRequest
{
    public function __construct(public string $trackingId, public string $contentId, public ?string $brand = null) {}
}

final class CardMetadataRequest extends TokenRequest {}

/** Error raised for non-2xx UPC responses. */
final class FetchError extends \RuntimeException
{
    public function __construct(
        public int $status,
        public string $url,
        public string $responseBody = '',
    ) { parent::__construct("Request failed with status {$status}"); }
}

/** Synchronous HTTP client for the UPC Token Service XML API. */
final class UpcTokenService
{
    private const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';
    private const XML_SCHEMA = 'https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd';
    private const XML_ROOT_OPEN = '<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" '
        . 'xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd" '
        . 'xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" '
        . 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        . 'xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">';
    private static int $messageId = 0;
    private string $baseUrl;
    private float $timeoutSeconds;

    /**
     * Create a client for test, production or a custom HTTPS base URL.
     * Example: $client = new UpcTokenService('test', new UpcTokenServiceOptions('m', 't'));
     */
    public function __construct(string $resource, private UpcTokenServiceOptions $options)
    {
        $this->baseUrl = $this->resolveBaseUrl($resource);
        self::validateNonEmpty($options->merchantId, 'merchantId');
        self::validateNonEmpty($options->terminalId, 'terminalId');
        self::validateMaxLength($options->merchantId, 35, 'merchantId');
        self::validateMaxLength($options->terminalId, 35, 'terminalId');
        if ($options->timeout !== null && $options->timeout <= 0) {
            throw new \InvalidArgumentException('timeout must be greater than 0 milliseconds.');
        }
        $this->timeoutSeconds = ($options->timeout ?? 60000) / 1000;
    }

    /** Creates a UPC token for a card. */
    public function createToken(CreateTokenRequest $request): string
    {
        self::validateTrackingId($request->trackingId);
        self::validateNonEmpty($request->card->cardNum, 'card.cardNum');
        self::validateNonEmpty($request->card->expMonth, 'card.expMonth');
        self::validateNonEmpty($request->card->expYear, 'card.expYear');
        $card = ['CardNum' => $request->card->cardNum, 'ExpYear' => $request->card->expYear,
            'ExpMonth' => $request->card->expMonth];
        if ($request->card->cvNum !== null) $card['CVNum'] = $request->card->cvNum;
        return $this->send('createToken', 'XMLCreateTokenRequest', $this->basePayload($request->trackingId) + ['Card' => $card]);
    }

    /** Refreshes an existing token and obtains fresh payment token data. */
    public function refreshToken(TokenRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('refreshToken', 'XMLRefreshTokenRequest', $this->tokenPayload($request));
    }

    /** Permanently deletes a token. Deleted tokens cannot be resumed. */
    public function deleteToken(UpdateTokenRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('deleteToken', 'XMLDeleteTokenRequest', $this->updatePayload($request));
    }

    /** Retrieves the current state of a token. */
    public function getTokenStatus(TokenRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('getTokenStatus', 'XMLTokenStatusRequest', $this->tokenPayload($request));
    }

    /** Suspends a token, allowing it to be resumed later. */
    public function suspendToken(UpdateTokenRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('suspendToken', 'XMLSuspendTokenRequest', $this->updatePayload($request));
    }

    /** Resumes a previously suspended token. */
    public function resumeToken(UpdateTokenRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('resumeToken', 'XMLResumeTokenRequest', $this->updatePayload($request));
    }

    /** Retrieves card content by content ID. */
    public function getCardContent(CardContentRequest $request): string
    {
        self::validateTrackingId($request->trackingId);
        self::validateNonEmpty($request->contentId, 'contentId');
        $payload = $this->basePayload($request->trackingId) + ['contentId' => $request->contentId];
        if ($request->brand !== null) $payload['Brand'] = $request->brand;
        return $this->send('getCardContent', 'XMLGetCardContentRequest', $payload);
    }

    /** Retrieves card metadata for a token. */
    public function getCardMetadata(CardMetadataRequest $request): string
    {
        self::validateTokenRequest($request);
        return $this->send('getCardMetadata', 'XMLGetCardMetadataRequest', $this->tokenPayload($request));
    }

    /** @return array<string, mixed> */
    private function basePayload(string $trackingId): array
    {
        return ['MerchantID' => $this->options->merchantId, 'TerminalID' => $this->options->terminalId,
            'trackingId' => $trackingId];
    }

    /** @return array<string, mixed> */
    private function tokenPayload(TokenRequest $request): array
    {
        return $this->basePayload($request->trackingId) + ['UPCToken' => ['tokenId' => $request->tokenId]];
    }

    /** @return array<string, mixed> */
    private function updatePayload(UpdateTokenRequest $request): array
    {
        $update = ['UPCToken' => ['tokenId' => $request->tokenId]];
        if ($request->reasonCode !== null) $update['reasonCode'] = $request->reasonCode;
        if ($request->reason !== null) $update['reason'] = $request->reason;
        return $this->basePayload($request->trackingId) + ['UpdateTokenRequest' => $update];
    }

    /** @param array<string, mixed> $payload */
    private function send(string $pathKey, string $operation, array $payload): string
    {
        $paths = ['createToken' => '/go/token/create', 'refreshToken' => '/go/token/refresh',
            'deleteToken' => '/go/token/delete', 'getTokenStatus' => '/go/token/status',
            'suspendToken' => '/go/token/suspend', 'resumeToken' => '/go/token/resume',
            'getCardContent' => '/go/card/content', 'getCardMetadata' => '/go/card/metadata'];
        $url = $this->baseUrl . $paths[$pathKey];
        $xml = $this->createXmlRequest($operation, $payload);
        if ($this->options->logging) {
            error_log("[UPC Token Service] POST {$url} ({$operation})");
            error_log('[UPC Token Service] Request Content-Type: application/xml');
            error_log('[UPC Token Service] Request XML for ' . $operation . ': ' . $this->redactXml($xml));
        }
        $context = stream_context_create(['http' => [
            'method' => 'POST', 'header' => "Content-Type: application/xml\r\n",
            'content' => $xml, 'timeout' => $this->timeoutSeconds, 'ignore_errors' => true,
        ]]);
        $responseBody = @file_get_contents($url, false, $context);
        /** @var array<int, string> $responseHeaders */
        $responseHeaders = $http_response_header ?? [];
        $status = 0;
        $headers = [];
        foreach ($responseHeaders as $header) {
            if (preg_match('/^HTTP\/\S+\s+(\d+)/i', $header, $match)) $status = (int) $match[1];
            elseif (str_contains($header, ':')) {
                [$name, $value] = explode(':', $header, 2);
                $headers[strtolower(trim($name))] = trim($value);
            }
        }
        if ($responseBody === false) {
            $error = error_get_last();
            if ($this->options->logging) error_log('[UPC Token Service] ' . $operation . ' failed (HTTP unavailable): ' . ($error['message'] ?? 'request failed'));
            throw new \RuntimeException($error['message'] ?? 'UPC Token Service HTTP request failed.');
        }
        if ($status < 200 || $status >= 300) {
            if ($this->options->logging) error_log("[UPC Token Service] {$operation} failed (HTTP {$status}).");
            throw new FetchError($status, $url, $responseBody);
        }
        if ($this->options->logging) {
            $requestId = $headers['x-request-id'] ?? $headers['x-correlation-id'] ?? $headers['correlation-id'] ?? 'not provided';
            $body = $responseBody === '' ? '[empty response body]' : $this->redactXml($responseBody);
            error_log("[UPC Token Service] HTTP {$status} response for {$operation} (Content-Type: "
                . ($headers['content-type'] ?? 'not provided') . '; Content-Length: '
                . ($headers['content-length'] ?? 'not provided') . "; Request-ID: {$requestId}; Empty: "
                . ($responseBody === '' ? 'true' : 'false') . "): {$body}");
        }
        return $responseBody;
    }

    /** @param array<string, mixed> $payload */
    private function createXmlRequest(string $operation, array $payload): string
    {
        $body = '';
        foreach ($payload as $name => $value) $body .= $this->serializeElement((string) $name, $value);
        return self::XML_HEADER . self::XML_ROOT_OPEN . '<Message id="' . (++self::$messageId)
            . '" version="1.0"><' . $operation . '>' . $body . '</' . $operation . '></Message></ECommerceConnect>';
    }

    private function serializeElement(string $name, mixed $value): string
    {
        if ($value === null) return '';
        if (is_array($value)) {
            $children = '';
            foreach ($value as $childName => $childValue) $children .= $this->serializeElement((string) $childName, $childValue);
            return "<{$name}>{$children}</{$name}>";
        }
        return '<' . $name . '>' . self::escapeXml((string) $value) . '</' . $name . '>';
    }

    private static function escapeXml(string $value): string
    {
        return str_replace(["&", "<", ">", '"', "'"], ["&amp;", "&lt;", "&gt;", "&quot;", "&apos;"], $value);
    }

    private function redactXml(string $xml): string
    {
        $xml = preg_replace('/(<(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\b[^>]*>)[\s\S]*?(<\/(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\s*>)/i', '$1[REDACTED]$2', $xml) ?? $xml;
        $xml = preg_replace('/<encodedData\b[^>]*>[\s\S]*?<\/encodedData\s*>/i', '<encodedData>[OMITTED]</encodedData>', $xml) ?? $xml;
        return strlen($xml) > 2000 ? substr($xml, 0, 2000) . '…[truncated]' : $xml;
    }

    private function resolveBaseUrl(string $resource): string
    {
        $candidate = match ($resource) {
            'test' => UpcTokenServiceResource::Test,
            'production' => UpcTokenServiceResource::Production,
            default => $resource,
        };
        $parts = parse_url($candidate);
        if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
            throw new \InvalidArgumentException('resource must be a valid UPC HTTPS URL or environment name.');
        }
        if (strtolower($parts['scheme']) !== 'https') throw new \InvalidArgumentException('UPC Token Service resource must use HTTPS.');
        if (!in_array($parts['path'] ?? '', ['', '/'], true) || isset($parts['query']) || isset($parts['fragment'])) {
            throw new \InvalidArgumentException('Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.');
        }
        return 'https://' . $parts['host'] . (isset($parts['port']) ? ':' . $parts['port'] : '');
    }

    private static function validateTokenRequest(TokenRequest $request): void
    {
        self::validateTrackingId($request->trackingId);
        self::validateNonEmpty($request->tokenId, 'tokenId');
    }
    private static function validateTrackingId(string $trackingId): void
    {
        self::validateNonEmpty($trackingId, 'trackingId');
        self::validateMaxLength($trackingId, 10, 'trackingId');
    }
    private static function validateNonEmpty(string $value, string $name): void
    {
        if (trim($value) === '') throw new \InvalidArgumentException("{$name} must not be empty.");
    }
    private static function validateMaxLength(string $value, int $maxLength, string $name): void
    {
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        if ($length > $maxLength) throw new \LengthException("{$name} must not exceed {$maxLength} characters.");
    }
}
