package upctokenservice

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf16"
)

// UpcTokenServiceResource contains the standard UPC Token Service URLs.
var UpcTokenServiceResource = struct {
	Test       string
	Production string
}{
	Test:       "https://ecg.test.upc.ua",
	Production: "https://secure.upc.ua",
}

// UpcTokenServiceOptions configures an UpcTokenService client.
// Timeout defaults to 60 seconds. HTTPClient is optional and is useful when
// custom transport settings are required.
type UpcTokenServiceOptions struct {
	MerchantID string
	TerminalID string
	Timeout    time.Duration
	Logging    bool
	HTTPClient *http.Client
}

// TokenRequest identifies a token operation.
type TokenRequest struct {
	TrackingID string
	TokenID    string
}

// CardDetails contains the card data used to create a token.
type CardDetails struct {
	CardNum  string
	ExpMonth string
	ExpYear  string
	CVNum    *string
}

// CreateTokenRequest contains the data required to create a token.
type CreateTokenRequest struct {
	TrackingID string
	Card       CardDetails
}

// TokenReasonCode is a reason for changing a token's state.
type TokenReasonCode string

const (
	TokenReasonDeviceLost     TokenReasonCode = "DEVICE_LOST"
	TokenReasonDeviceStolen   TokenReasonCode = "DEVICE_STOLEN"
	TokenReasonSuspectedFraud TokenReasonCode = "SUSPECTED_FRAUD"
	TokenReasonAccountClosed  TokenReasonCode = "ACCOUNT_CLOSED"
	TokenReasonNotFraud       TokenReasonCode = "NOT_FRAUD"
	TokenReasonDeviceFound    TokenReasonCode = "DEVICE_FOUND"
	TokenReasonOther          TokenReasonCode = "OTHER"
)

// UpdateTokenRequest contains token identifiers and optional change details.
type UpdateTokenRequest struct {
	TrackingID string
	TokenID    string
	ReasonCode *TokenReasonCode
	Reason     *string
}

// CardContentRequest identifies card content to retrieve.
type CardContentRequest struct {
	TrackingID string
	ContentID  string
	Brand      *string
}

// CardMetadataRequest identifies the token whose card metadata is requested.
type CardMetadataRequest struct {
	TrackingID string
	TokenID    string
}

// FetchError describes a non-2xx HTTP response from UPC Token Service.
type FetchError struct {
	StatusCode int
	Status     string
	URL        string
}

func (e *FetchError) Error() string {
	if e.Status != "" {
		return e.Status
	}
	return fmt.Sprintf("Request failed with status %d", e.StatusCode)
}

const (
	defaultTimeout = 60 * time.Second
	xmlHeader      = `<?xml version="1.0" encoding="UTF-8"?>`
	xmlRootOpen    = `<ECommerceConnect xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd" xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd">`
	maxLogLength   = 2000
)

var messageID atomic.Uint64

var apiPaths = map[string]string{
	"createToken":     "/go/token/create",
	"refreshToken":    "/go/token/refresh",
	"deleteToken":     "/go/token/delete",
	"getTokenStatus":  "/go/token/status",
	"suspendToken":    "/go/token/suspend",
	"resumeToken":     "/go/token/resume",
	"getCardContent":  "/go/card/content",
	"getCardMetadata": "/go/card/metadata",
}

var xmlEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
	"'", "&apos;",
)

var sensitiveXMLPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?is)(<(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\b[^>]*>).*?(</(?:CardNum|CVNum|TokenNumber|TAVV|tokenId)\s*>)`),
	regexp.MustCompile(`(?is)<encodedData\b[^>]*>.*?</encodedData\s*>`),
}

type xmlElement struct {
	name     string
	value    string
	children []xmlElement
}

// UpcTokenService is an HTTP client for the UPC Token Service XML API.
type UpcTokenService struct {
	baseURL string
	options UpcTokenServiceOptions
	client  *http.Client
}

// NewUpcTokenService creates a client for the test, production, or a custom
// base HTTPS URL. Example: client, err := NewUpcTokenService("test", options).
func NewUpcTokenService(resource string, options UpcTokenServiceOptions) (*UpcTokenService, error) {
	baseURL, err := resolveBaseURL(resource)
	if err != nil {
		return nil, err
	}
	if err := validateNonEmpty(options.MerchantID, "merchantId"); err != nil {
		return nil, err
	}
	if err := validateNonEmpty(options.TerminalID, "terminalId"); err != nil {
		return nil, err
	}
	if err := validateMaxLength(options.MerchantID, 35, "merchantId"); err != nil {
		return nil, err
	}
	if err := validateMaxLength(options.TerminalID, 35, "terminalId"); err != nil {
		return nil, err
	}
	if options.Timeout < 0 {
		return nil, fmt.Errorf("timeout must not be negative")
	}
	if options.Timeout == 0 {
		options.Timeout = defaultTimeout
	}

	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: options.Timeout}
	}
	return &UpcTokenService{baseURL: baseURL, options: options, client: client}, nil
}

// CreateToken creates a UPC token for a card.
func (s *UpcTokenService) CreateToken(request CreateTokenRequest) (string, error) {
	if err := validateTrackingID(request.TrackingID); err != nil {
		return "", err
	}
	if err := validateNonEmpty(request.Card.CardNum, "card.cardNum"); err != nil {
		return "", err
	}
	if err := validateNonEmpty(request.Card.ExpMonth, "card.expMonth"); err != nil {
		return "", err
	}
	if err := validateNonEmpty(request.Card.ExpYear, "card.expYear"); err != nil {
		return "", err
	}

	card := []xmlElement{
		textElement("CardNum", request.Card.CardNum),
		textElement("ExpYear", request.Card.ExpYear),
		textElement("ExpMonth", request.Card.ExpMonth),
	}
	if request.Card.CVNum != nil {
		card = append(card, textElement("CVNum", *request.Card.CVNum))
	}
	return s.send("createToken", "XMLCreateTokenRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("Card", card...),
	})
}

// RefreshToken refreshes an existing token and returns fresh payment token data.
func (s *UpcTokenService) RefreshToken(request TokenRequest) (string, error) {
	if err := validateTokenRequest(request); err != nil {
		return "", err
	}
	return s.send("refreshToken", "XMLRefreshTokenRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UPCToken", textElement("tokenId", request.TokenID)),
	})
}

// DeleteToken permanently deletes a token. Deleted tokens cannot be resumed.
func (s *UpcTokenService) DeleteToken(request UpdateTokenRequest) (string, error) {
	if err := validateUpdateTokenRequest(request); err != nil {
		return "", err
	}
	return s.send("deleteToken", "XMLDeleteTokenRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UpdateTokenRequest", append(
			[]xmlElement{childElement("UPCToken", textElement("tokenId", request.TokenID))},
			reasonElements(request)...,
		)...),
	})
}

// GetTokenStatus retrieves the current state of a token.
func (s *UpcTokenService) GetTokenStatus(request TokenRequest) (string, error) {
	if err := validateTokenRequest(request); err != nil {
		return "", err
	}
	return s.send("getTokenStatus", "XMLTokenStatusRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UPCToken", textElement("tokenId", request.TokenID)),
	})
}

// SuspendToken suspends a token, allowing it to be resumed later.
func (s *UpcTokenService) SuspendToken(request UpdateTokenRequest) (string, error) {
	if err := validateUpdateTokenRequest(request); err != nil {
		return "", err
	}
	return s.send("suspendToken", "XMLSuspendTokenRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UpdateTokenRequest", append(
			[]xmlElement{childElement("UPCToken", textElement("tokenId", request.TokenID))},
			reasonElements(request)...,
		)...),
	})
}

// ResumeToken resumes a previously suspended token.
func (s *UpcTokenService) ResumeToken(request UpdateTokenRequest) (string, error) {
	if err := validateUpdateTokenRequest(request); err != nil {
		return "", err
	}
	return s.send("resumeToken", "XMLResumeTokenRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UpdateTokenRequest", append(
			[]xmlElement{childElement("UPCToken", textElement("tokenId", request.TokenID))},
			reasonElements(request)...,
		)...),
	})
}

// GetCardContent retrieves card content by its content ID.
func (s *UpcTokenService) GetCardContent(request CardContentRequest) (string, error) {
	if err := validateTrackingID(request.TrackingID); err != nil {
		return "", err
	}
	if err := validateNonEmpty(request.ContentID, "contentId"); err != nil {
		return "", err
	}
	payload := []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		textElement("contentId", request.ContentID),
	}
	if request.Brand != nil {
		payload = append(payload, textElement("Brand", *request.Brand))
	}
	return s.send("getCardContent", "XMLGetCardContentRequest", payload)
}

// GetCardMetadata retrieves card metadata for a token.
func (s *UpcTokenService) GetCardMetadata(request CardMetadataRequest) (string, error) {
	if err := validateTokenRequest(TokenRequest{TrackingID: request.TrackingID, TokenID: request.TokenID}); err != nil {
		return "", err
	}
	return s.send("getCardMetadata", "XMLGetCardMetadataRequest", []xmlElement{
		s.merchantIDElement(), s.terminalIDElement(), textElement("trackingId", request.TrackingID),
		childElement("UPCToken", textElement("tokenId", request.TokenID)),
	})
}

func (s *UpcTokenService) merchantIDElement() xmlElement {
	return textElement("MerchantID", s.options.MerchantID)
}

func (s *UpcTokenService) terminalIDElement() xmlElement {
	return textElement("TerminalID", s.options.TerminalID)
}

func (s *UpcTokenService) send(pathKey, operation string, payload []xmlElement) (string, error) {
	endpoint := apiPaths[pathKey]
	requestURL := s.baseURL + endpoint
	xml := createXMLRequest(operation, payload)
	if s.options.Logging {
		log.Printf("[UPC Token Service] POST %s (%s)", requestURL, operation)
		log.Printf("[UPC Token Service] Request Content-Type: application/xml")
		log.Printf("[UPC Token Service] Request XML for %s: %s", operation, redactXMLForLog(xml))
	}

	ctx, cancel := context.WithTimeout(context.Background(), s.options.Timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, strings.NewReader(xml))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/xml")
	response, err := s.client.Do(req)
	if err != nil {
		if s.options.Logging {
			log.Printf("[UPC Token Service] %s failed (HTTP unavailable): %v", operation, err)
		}
		return "", err
	}
	defer response.Body.Close()

	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		_, _ = io.Copy(io.Discard, response.Body)
		fetchErr := &FetchError{StatusCode: response.StatusCode, Status: response.Status, URL: requestURL}
		if s.options.Logging {
			log.Printf("[UPC Token Service] %s failed (HTTP %d): %s", operation, response.StatusCode, fetchErr.Error())
		}
		return "", fetchErr
	}

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		if s.options.Logging {
			log.Printf("[UPC Token Service] %s failed while reading response: %v", operation, err)
		}
		return "", err
	}
	if s.options.Logging {
		requestID := response.Header.Get("X-Request-Id")
		if requestID == "" {
			requestID = response.Header.Get("X-Correlation-Id")
		}
		if requestID == "" {
			requestID = response.Header.Get("Correlation-Id")
		}
		if requestID == "" {
			requestID = "not provided"
		}
		contentType := response.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "not provided"
		}
		contentLength := response.Header.Get("Content-Length")
		if contentLength == "" {
			contentLength = "not provided"
		}
		body := string(responseBody)
		if body == "" {
			body = "[empty response body]"
		} else {
			body = redactXMLForLog(body)
		}
		log.Printf("[UPC Token Service] HTTP %d response for %s (Content-Type: %s; Content-Length: %s; Request-ID: %s; Empty: %t): %s",
			response.StatusCode, operation, contentType, contentLength, requestID, len(responseBody) == 0, body)
	}
	return string(responseBody), nil
}

func createXMLRequest(operation string, payload []xmlElement) string {
	body := make([]string, 0, len(payload))
	for _, element := range payload {
		body = append(body, serializeXMLElement(element))
	}
	id := messageID.Add(1)
	return xmlHeader + xmlRootOpen + `<Message id="` + strconv.FormatUint(id, 10) + `" version="1.0"><` + operation + `>` +
		strings.Join(body, "") + `</` + operation + `></Message></ECommerceConnect>`
}

func serializeXMLElement(element xmlElement) string {
	if element.children == nil {
		return "<" + element.name + ">" + xmlEscaper.Replace(element.value) + "</" + element.name + ">"
	}
	var children strings.Builder
	for _, child := range element.children {
		children.WriteString(serializeXMLElement(child))
	}
	return "<" + element.name + ">" + children.String() + "</" + element.name + ">"
}

func textElement(name, value string) xmlElement {
	return xmlElement{name: name, value: value}
}

func childElement(name string, children ...xmlElement) xmlElement {
	return xmlElement{name: name, children: children}
}

func reasonElements(request UpdateTokenRequest) []xmlElement {
	var result []xmlElement
	if request.ReasonCode != nil {
		result = append(result, textElement("reasonCode", string(*request.ReasonCode)))
	}
	if request.Reason != nil {
		result = append(result, textElement("reason", *request.Reason))
	}
	return result
}

func resolveBaseURL(resource string) (string, error) {
	switch resource {
	case "test":
		resource = UpcTokenServiceResource.Test
	case "production":
		resource = UpcTokenServiceResource.Production
	}
	parsedURL, err := url.Parse(resource)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return "", fmt.Errorf("resource must be a valid UPC HTTPS URL or environment name")
	}
	if parsedURL.Scheme != "https" {
		return "", fmt.Errorf("UPC Token Service resource must use HTTPS")
	}
	if parsedURL.User != nil {
		return "", fmt.Errorf("custom UPC resource URL must not contain user information")
	}
	if (parsedURL.Path != "" && parsedURL.Path != "/") || parsedURL.RawQuery != "" || parsedURL.Fragment != "" {
		return "", fmt.Errorf("custom UPC resource must be a base HTTPS URL without a path, query, or fragment; API paths are appended automatically")
	}
	return parsedURL.Scheme + "://" + parsedURL.Host, nil
}

func validateTokenRequest(request TokenRequest) error {
	if err := validateTrackingID(request.TrackingID); err != nil {
		return err
	}
	return validateNonEmpty(request.TokenID, "tokenId")
}

func validateUpdateTokenRequest(request UpdateTokenRequest) error {
	return validateTokenRequest(TokenRequest{TrackingID: request.TrackingID, TokenID: request.TokenID})
}

func validateTrackingID(trackingID string) error {
	if err := validateNonEmpty(trackingID, "trackingId"); err != nil {
		return err
	}
	return validateMaxLength(trackingID, 10, "trackingId")
}

func validateNonEmpty(value, name string) error {
	if strings.TrimSpace(value) == "" {
		return fmt.Errorf("%s must not be empty.", name)
	}
	return nil
}

func validateMaxLength(value string, maxLength int, name string) error {
	if utf16Length(value) > maxLength {
		return fmt.Errorf("%s must not exceed %d characters.", name, maxLength)
	}
	return nil
}

func utf16Length(value string) int {
	return len(utf16.Encode([]rune(value)))
}

func redactXMLForLog(xml string) string {
	redacted := xml
	for index, pattern := range sensitiveXMLPatterns {
		if index == 0 {
			redacted = pattern.ReplaceAllString(redacted, "$1[REDACTED]$2")
			continue
		}
		redacted = pattern.ReplaceAllString(redacted, "<encodedData>[OMITTED]</encodedData>")
	}
	if len(redacted) > maxLogLength {
		runes := []rune(redacted)
		if len(runes) > maxLogLength {
			return string(runes[:maxLogLength]) + "…[truncated]"
		}
	}
	return redacted
}
