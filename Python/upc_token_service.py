"""UPC Token Service client implemented with the Python standard library."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import itertools
import logging
import re
from typing import Optional, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


class UpcTokenServiceResource:
    """Standard UPC Token Service base URLs."""

    Test = "https://ecg.test.upc.ua"
    Production = "https://secure.upc.ua"


UpcTokenServiceEnvironment = str
UpcTokenServiceResponse = str


@dataclass(frozen=True)
class UpcTokenServiceOptions:
    merchantId: str
    terminalId: str
    timeout: Optional[int] = None  # milliseconds; None uses 60 seconds
    logging: bool = False


@dataclass(frozen=True)
class TokenRequest:
    trackingId: str
    tokenId: str


@dataclass(frozen=True)
class CardDetails:
    cardNum: str
    expMonth: str
    expYear: str
    cvNum: Optional[str] = None


@dataclass(frozen=True)
class CreateTokenRequest:
    trackingId: str
    card: CardDetails


class TokenReasonCode(str, Enum):
    DEVICE_LOST = "DEVICE_LOST"
    DEVICE_STOLEN = "DEVICE_STOLEN"
    SUSPECTED_FRAUD = "SUSPECTED_FRAUD"
    ACCOUNT_CLOSED = "ACCOUNT_CLOSED"
    NOT_FRAUD = "NOT_FRAUD"
    DEVICE_FOUND = "DEVICE_FOUND"
    OTHER = "OTHER"


@dataclass(frozen=True)
class UpdateTokenRequest(TokenRequest):
    reasonCode: Optional[TokenReasonCode] = None
    reason: Optional[str] = None


@dataclass(frozen=True)
class CardContentRequest:
    trackingId: str
    contentId: str
    brand: Optional[str] = None


@dataclass(frozen=True)
class CardMetadataRequest(TokenRequest):
    pass


class FetchError(Exception):
    """Raised when UPC returns a non-2xx HTTP response."""

    def __init__(self, status: int, url: str, responseBody: str = "") -> None:
        super().__init__(f"Request failed with status {status}")
        self.status = status
        self.url = url
        self.responseBody = responseBody


_XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>'
_XML_SCHEMA = "https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"
_XML_ROOT_OPEN = (
    '<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" '
    f'xmlns:noNamespaceSchemaLocation="{_XML_SCHEMA}" '
    'xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    f'xsi:noNamespaceSchemaLocation="{_XML_SCHEMA}">'
)
_MESSAGE_IDS = itertools.count(1)
_API_PATHS = {
    "createToken": "/go/token/create",
    "refreshToken": "/go/token/refresh",
    "deleteToken": "/go/token/delete",
    "getTokenStatus": "/go/token/status",
    "suspendToken": "/go/token/suspend",
    "resumeToken": "/go/token/resume",
    "getCardContent": "/go/card/content",
    "getCardMetadata": "/go/card/metadata",
}
_SENSITIVE_TAGS = re.compile(
    r"(<(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\b[^>]*>)[\s\S]*?(</(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\s*>)",
    re.IGNORECASE,
)
_ENCODED_DATA = re.compile(r"<encodedData\b[^>]*>[\s\S]*?</encodedData\s*>", re.IGNORECASE)
_LOGGER = logging.getLogger("upc_token_service")


class UpcTokenService:
    """Synchronous UPC Token Service client.

    ``resource`` accepts ``test``, ``production`` or a custom base HTTPS URL.
    Example: ``client = UpcTokenService("test", UpcTokenServiceOptions("m", "t"))``.
    """

    def __init__(self, resource: UpcTokenServiceResource | UpcTokenServiceEnvironment,
                 options: UpcTokenServiceOptions) -> None:
        if options is None:
            raise TypeError("options must not be null.")
        self.baseUrl = self._resolve_base_url(resource)
        self.options = options
        self._validate_non_empty(options.merchantId, "merchantId")
        self._validate_non_empty(options.terminalId, "terminalId")
        self._validate_max_length(options.merchantId, 35, "merchantId")
        self._validate_max_length(options.terminalId, 35, "terminalId")
        if options.timeout is not None and options.timeout <= 0:
            raise ValueError("timeout must be greater than 0 milliseconds.")
        self.timeout = (options.timeout or 60_000) / 1000

    def createToken(self, request: CreateTokenRequest) -> UpcTokenServiceResponse:
        self._validate_tracking_id(request.trackingId)
        if request.card is None:
            raise TypeError("card must not be null.")
        self._validate_non_empty(request.card.cardNum, "card.cardNum")
        self._validate_non_empty(request.card.expMonth, "card.expMonth")
        self._validate_non_empty(request.card.expYear, "card.expYear")
        card = [("CardNum", request.card.cardNum), ("ExpYear", request.card.expYear),
                ("ExpMonth", request.card.expMonth)]
        if request.card.cvNum is not None:
            card.append(("CVNum", request.card.cvNum))
        return self._send("createToken", "XMLCreateTokenRequest", [
            ("MerchantID", self.options.merchantId), ("TerminalID", self.options.terminalId),
            ("trackingId", request.trackingId), ("Card", card),
        ])

    def refreshToken(self, request: TokenRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("refreshToken", "XMLRefreshTokenRequest", self._token_payload(request))

    def deleteToken(self, request: UpdateTokenRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("deleteToken", "XMLDeleteTokenRequest", self._update_payload(request))

    def getTokenStatus(self, request: TokenRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("getTokenStatus", "XMLTokenStatusRequest", self._token_payload(request))

    def suspendToken(self, request: UpdateTokenRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("suspendToken", "XMLSuspendTokenRequest", self._update_payload(request))

    def resumeToken(self, request: UpdateTokenRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("resumeToken", "XMLResumeTokenRequest", self._update_payload(request))

    def getCardContent(self, request: CardContentRequest) -> UpcTokenServiceResponse:
        self._validate_tracking_id(request.trackingId)
        self._validate_non_empty(request.contentId, "contentId")
        payload = [("MerchantID", self.options.merchantId), ("TerminalID", self.options.terminalId),
                   ("trackingId", request.trackingId), ("contentId", request.contentId)]
        if request.brand is not None:
            payload.append(("Brand", request.brand))
        return self._send("getCardContent", "XMLGetCardContentRequest", payload)

    def getCardMetadata(self, request: CardMetadataRequest) -> UpcTokenServiceResponse:
        self._validate_token_request(request)
        return self._send("getCardMetadata", "XMLGetCardMetadataRequest", self._token_payload(request))

    def _token_payload(self, request: TokenRequest) -> list[tuple[str, object]]:
        return [("MerchantID", self.options.merchantId), ("TerminalID", self.options.terminalId),
                ("trackingId", request.trackingId), ("UPCToken", [("tokenId", request.tokenId)])]

    def _update_payload(self, request: UpdateTokenRequest) -> list[tuple[str, object]]:
        update: list[tuple[str, object]] = [("UPCToken", [("tokenId", request.tokenId)])]
        if request.reasonCode is not None:
            code = request.reasonCode.value if isinstance(request.reasonCode, TokenReasonCode) else str(request.reasonCode)
            update.append(("reasonCode", code))
        if request.reason is not None:
            update.append(("reason", request.reason))
        return [("MerchantID", self.options.merchantId), ("TerminalID", self.options.terminalId),
                ("trackingId", request.trackingId), ("UpdateTokenRequest", update)]

    def _send(self, path_key: str, operation: str, payload: Sequence[tuple[str, object]]) -> str:
        url = self.baseUrl + _API_PATHS[path_key]
        xml = self._create_xml_request(operation, payload)
        if self.options.logging:
            _LOGGER.info("[UPC Token Service] POST %s (%s)", url, operation)
            _LOGGER.info("[UPC Token Service] Request Content-Type: application/xml")
            _LOGGER.info("[UPC Token Service] Request XML for %s: %s", operation, self._redact_xml(xml))
        request = Request(url, data=xml.encode("utf-8"), method="POST",
                          headers={"Content-Type": "application/xml"})
        try:
            with urlopen(request, timeout=self.timeout) as response:
                response_xml = response.read().decode("utf-8")
                if self.options.logging:
                    headers = response.headers
                    request_id = (headers.get("x-request-id") or headers.get("x-correlation-id")
                                  or headers.get("correlation-id") or "not provided")
                    body = self._redact_xml(response_xml) if response_xml else "[empty response body]"
                    _LOGGER.info(
                        "[UPC Token Service] HTTP %s response for %s (Content-Type: %s; Content-Length: %s; Request-ID: %s; Empty: %s): %s",
                        response.status, operation, headers.get("content-type", "not provided"),
                        headers.get("content-length", "not provided"), request_id, not response_xml, body,
                    )
                return response_xml
        except HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            if self.options.logging:
                _LOGGER.error("[UPC Token Service] %s failed (HTTP %s): %s", operation, error.code, error.reason)
            raise FetchError(error.code, url, body) from error
        except (URLError, TimeoutError, OSError) as error:
            if self.options.logging:
                _LOGGER.error("[UPC Token Service] %s failed (HTTP unavailable): %s", operation, error)
            raise

    @staticmethod
    def _create_xml_request(operation: str, payload: Sequence[tuple[str, object]]) -> str:
        body = "".join(UpcTokenService._serialize_element(name, value) for name, value in payload)
        message_id = next(_MESSAGE_IDS)
        return f'{_XML_HEADER}{_XML_ROOT_OPEN}<Message id="{message_id}" version="1.0">' \
               f"<{operation}>{body}</{operation}></Message></ECommerceConnect>"

    @staticmethod
    def _serialize_element(name: str, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, (list, tuple)):
            children = "".join(UpcTokenService._serialize_element(child_name, child_value)
                               for child_name, child_value in value)
            return f"<{name}>{children}</{name}>"
        return f"<{name}>{UpcTokenService._escape_xml(str(value))}</{name}>"

    @staticmethod
    def _escape_xml(value: str) -> str:
        return value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")

    @staticmethod
    def _redact_xml(xml: str) -> str:
        result = _SENSITIVE_TAGS.sub(r"\1[REDACTED]\2", xml)
        result = _ENCODED_DATA.sub("<encodedData>[OMITTED]</encodedData>", result)
        return result[:2000] + "…[truncated]" if len(result) > 2000 else result

    @staticmethod
    def _resolve_base_url(resource: str) -> str:
        if resource == "test":
            candidate = UpcTokenServiceResource.Test
        elif resource == "production":
            candidate = UpcTokenServiceResource.Production
        else:
            candidate = resource
        try:
            parsed = urlsplit(candidate)
            # Accessing .port also validates malformed port values.
            port = parsed.port
        except (TypeError, ValueError) as error:
            raise ValueError("resource must be a valid UPC HTTPS URL or environment name.") from error
        if parsed.scheme.lower() != "https" or not parsed.hostname:
            raise ValueError("UPC Token Service resource must use HTTPS.")
        if parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            raise ValueError("Custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically.")
        host = f"[{parsed.hostname}]" if ":" in parsed.hostname else parsed.hostname
        return f"https://{host}" + (f":{port}" if port is not None else "")

    @staticmethod
    def _validate_token_request(request: TokenRequest) -> None:
        if request is None:
            raise TypeError("request must not be null.")
        UpcTokenService._validate_tracking_id(request.trackingId)
        UpcTokenService._validate_non_empty(request.tokenId, "tokenId")

    @staticmethod
    def _validate_tracking_id(value: str) -> None:
        UpcTokenService._validate_non_empty(value, "trackingId")
        UpcTokenService._validate_max_length(value, 10, "trackingId")

    @staticmethod
    def _validate_non_empty(value: Optional[str], name: str) -> None:
        if value is None or not value.strip():
            raise TypeError(f"{name} must not be empty.")

    @staticmethod
    def _validate_max_length(value: str, max_length: int, name: str) -> None:
        if len(value.encode("utf-16-le")) // 2 > max_length:
            raise ValueError(f"{name} must not exceed {max_length} characters.")
