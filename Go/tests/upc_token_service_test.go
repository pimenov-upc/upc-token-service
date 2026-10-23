package upctokenservice_test

import (
	"errors"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	sdk "upctokenservice/lib"
)

const testXMLResponse = `<?xml version="1.0" encoding="UTF-8"?><ECommerceConnect><Message><XMLResponse><TranCode>000</TranCode></XMLResponse></Message></ECommerceConnect>`

func testClient(t *testing.T, handler http.HandlerFunc, logging ...bool) (*sdk.UpcTokenService, *httptest.Server) {
	t.Helper()
	server := httptest.NewTLSServer(handler)
	t.Cleanup(server.Close)
	options := sdk.UpcTokenServiceOptions{
		MerchantID: "7651243",
		TerminalID: "E7651243",
		HTTPClient: server.Client(),
	}
	if len(logging) > 0 {
		options.Logging = logging[0]
	}
	client, err := sdk.NewUpcTokenService(server.URL, options)
	if err != nil {
		t.Fatalf("NewUpcTokenService() error = %v", err)
	}
	return client, server
}

func TestClientOperationsMatchNodeJSAPI(t *testing.T) {
	tests := []struct {
		name      string
		path      string
		operation string
		call      func(*sdk.UpcTokenService) (string, error)
	}{
		{
			name: "CreateToken", path: "/go/token/create", operation: "XMLCreateTokenRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.CreateToken(sdk.CreateTokenRequest{TrackingID: "create-1", Card: sdk.CardDetails{
					CardNum: "4111111111111111", ExpMonth: "12", ExpYear: "2030",
				}})
			},
		},
		{
			name: "RefreshToken", path: "/go/token/refresh", operation: "XMLRefreshTokenRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.RefreshToken(sdk.TokenRequest{TrackingID: "refresh-1", TokenID: "token-1"})
			},
		},
		{
			name: "DeleteToken", path: "/go/token/delete", operation: "XMLDeleteTokenRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.DeleteToken(sdk.UpdateTokenRequest{TrackingID: "delete-1", TokenID: "token-1"})
			},
		},
		{
			name: "GetTokenStatus", path: "/go/token/status", operation: "XMLTokenStatusRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.GetTokenStatus(sdk.TokenRequest{TrackingID: "status-1", TokenID: "token-1"})
			},
		},
		{
			name: "SuspendToken", path: "/go/token/suspend", operation: "XMLSuspendTokenRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.SuspendToken(sdk.UpdateTokenRequest{TrackingID: "suspend-1", TokenID: "token-1"})
			},
		},
		{
			name: "ResumeToken", path: "/go/token/resume", operation: "XMLResumeTokenRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.ResumeToken(sdk.UpdateTokenRequest{TrackingID: "resume-1", TokenID: "token-1"})
			},
		},
		{
			name: "GetCardContent", path: "/go/card/content", operation: "XMLGetCardContentRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.GetCardContent(sdk.CardContentRequest{TrackingID: "content-1", ContentID: "content-id"})
			},
		},
		{
			name: "GetCardMetadata", path: "/go/card/metadata", operation: "XMLGetCardMetadataRequest",
			call: func(client *sdk.UpcTokenService) (string, error) {
				return client.GetCardMetadata(sdk.CardMetadataRequest{TrackingID: "metadata-1", TokenID: "token-1"})
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
				if request.URL.Path != test.path {
					t.Errorf("request path = %q, want %q", request.URL.Path, test.path)
				}
				if request.Method != http.MethodPost {
					t.Errorf("request method = %q, want POST", request.Method)
				}
				if got := request.Header.Get("Content-Type"); got != "application/xml" {
					t.Errorf("Content-Type = %q, want application/xml", got)
				}
				body, err := io.ReadAll(request.Body)
				if err != nil {
					t.Errorf("ReadAll() error = %v", err)
				}
				requestXML := string(body)
				if !strings.HasPrefix(requestXML, `<?xml version="1.0" encoding="UTF-8"?><ECommerceConnect `) {
					t.Errorf("request XML has unexpected header: %s", requestXML)
				}
				if !strings.Contains(requestXML, "<"+test.operation+">") {
					t.Errorf("request XML missing %s: %s", test.operation, requestXML)
				}
				if !strings.Contains(requestXML, `xmlns:noNamespaceSchemaLocation="https://secure.upc.ua/go/pub/schema/xmlpay-1.18.xsd"`) {
					t.Errorf("request XML missing schema location: %s", requestXML)
				}
				writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
				writer.WriteHeader(http.StatusOK)
				_, _ = io.WriteString(writer, testXMLResponse)
			})

			got, err := test.call(client)
			if err != nil {
				t.Fatalf("operation error = %v", err)
			}
			if got != testXMLResponse {
				t.Errorf("response = %q, want raw XML %q", got, testXMLResponse)
			}
		})
	}
}

func TestCreateTokenOptionalCVVAndEscaping(t *testing.T) {
	var requestXML string
	client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		requestXML = string(body)
		_, _ = io.WriteString(writer, testXMLResponse)
	})
	_, err := client.CreateToken(sdk.CreateTokenRequest{
		TrackingID: `t&<id>`,
		Card: sdk.CardDetails{CardNum: `4111"<&`, ExpMonth: "12", ExpYear: "2030"},
	})
	if err != nil {
		t.Fatalf("CreateToken() error = %v", err)
	}
	for _, expected := range []string{
		`<trackingId>t&amp;&lt;id&gt;</trackingId>`,
		`<CardNum>4111&quot;&lt;&amp;</CardNum>`,
	} {
		if !strings.Contains(requestXML, expected) {
			t.Errorf("request XML does not contain %q: %s", expected, requestXML)
		}
	}
	if strings.Contains(requestXML, "<CVNum>") {
		t.Errorf("request XML unexpectedly contains CVNum: %s", requestXML)
	}
}

func TestUpdateTokenIncludesOptionalReasonFields(t *testing.T) {
	var requestXML string
	client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		body, _ := io.ReadAll(request.Body)
		requestXML = string(body)
		_, _ = io.WriteString(writer, testXMLResponse)
	})
	reasonCode := sdk.TokenReasonSuspectedFraud
	reason := "Reported lost device"
	_, err := client.SuspendToken(sdk.UpdateTokenRequest{
		TrackingID: "suspend-1", TokenID: "token-1", ReasonCode: &reasonCode, Reason: &reason,
	})
	if err != nil {
		t.Fatalf("SuspendToken() error = %v", err)
	}
	for _, expected := range []string{
		`<reasonCode>SUSPECTED_FRAUD</reasonCode>`,
		`<reason>Reported lost device</reason>`,
	} {
		if !strings.Contains(requestXML, expected) {
			t.Errorf("request XML does not contain %q: %s", expected, requestXML)
		}
	}
}

func TestValidationPreventsHTTPRequest(t *testing.T) {
	requests := 0
	client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		requests++
		_, _ = io.WriteString(writer, testXMLResponse)
	})
	tests := []struct {
		name string
		call func() error
	}{
		{name: "empty tracking ID", call: func() error {
			_, err := client.GetTokenStatus(sdk.TokenRequest{TokenID: "token-1"})
			return err
		}},
		{name: "tracking ID over limit", call: func() error {
			_, err := client.GetTokenStatus(sdk.TokenRequest{TrackingID: "12345678901", TokenID: "token-1"})
			return err
		}},
		{name: "empty token ID", call: func() error {
			_, err := client.GetTokenStatus(sdk.TokenRequest{TrackingID: "status-1"})
			return err
		}},
		{name: "missing card number", call: func() error {
			_, err := client.CreateToken(sdk.CreateTokenRequest{TrackingID: "create-1", Card: sdk.CardDetails{ExpMonth: "12", ExpYear: "2030"}})
			return err
		}},
		{name: "missing content ID", call: func() error {
			_, err := client.GetCardContent(sdk.CardContentRequest{TrackingID: "content-1"})
			return err
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := test.call(); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	if requests != 0 {
		t.Errorf("HTTP requests = %d, want 0", requests)
	}
}

func TestConstructorValidatesResourceAndOptions(t *testing.T) {
	validOptions := sdk.UpcTokenServiceOptions{MerchantID: "merchant", TerminalID: "terminal"}
	tests := []struct {
		resource string
		options  sdk.UpcTokenServiceOptions
	}{
		{resource: "http://example.com", options: validOptions},
		{resource: "not-a-url", options: validOptions},
		{resource: "https://example.com/go/token/status", options: validOptions},
		{resource: "test", options: sdk.UpcTokenServiceOptions{TerminalID: "terminal"}},
		{resource: "test", options: sdk.UpcTokenServiceOptions{MerchantID: "merchant"}},
		{resource: "test", options: sdk.UpcTokenServiceOptions{MerchantID: "merchant", TerminalID: "terminal", Timeout: -time.Second}},
	}
	for _, test := range tests {
		if _, err := sdk.NewUpcTokenService(test.resource, test.options); err == nil {
			t.Errorf("NewUpcTokenService(%q, ...) succeeded, want error", test.resource)
		}
	}
}

func TestNonSuccessResponseReturnsFetchError(t *testing.T) {
	client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		http.Error(writer, "Gateway unavailable", http.StatusBadGateway)
	})
	_, err := client.GetTokenStatus(sdk.TokenRequest{TrackingID: "status-1", TokenID: "token-1"})
	var fetchErr *sdk.FetchError
	if !errors.As(err, &fetchErr) {
		t.Fatalf("error = %T (%v), want *FetchError", err, err)
	}
	if fetchErr.StatusCode != http.StatusBadGateway {
		t.Errorf("status code = %d, want %d", fetchErr.StatusCode, http.StatusBadGateway)
	}
}

func TestLoggingRedactsSensitiveXML(t *testing.T) {
	var logs strings.Builder
	originalOutput := log.Writer()
	originalFlags := log.Flags()
	log.SetOutput(&logs)
	log.SetFlags(0)
	t.Cleanup(func() {
		log.SetOutput(originalOutput)
		log.SetFlags(originalFlags)
	})

	client, _ := testClient(t, func(writer http.ResponseWriter, request *http.Request) {
		_, _ = io.WriteString(writer, `<ECommerceConnect><tokenId>response-secret</tokenId><encodedData>binary-secret</encodedData></ECommerceConnect>`)
	}, true)
	_, err := client.CreateToken(sdk.CreateTokenRequest{
		TrackingID: "log-1",
		Card: sdk.CardDetails{CardNum: "card-secret", ExpMonth: "12", ExpYear: "2030", CVNum: stringPointer("cvv-secret")},
	})
	if err != nil {
		t.Fatalf("CreateToken() error = %v", err)
	}
	output := logs.String()
	for _, secret := range []string{"card-secret", "cvv-secret", "response-secret", "binary-secret"} {
		if strings.Contains(output, secret) {
			t.Errorf("logs contain sensitive value %q: %s", secret, output)
		}
	}
	for _, redacted := range []string{"[REDACTED]", "[OMITTED]", "HTTP 200 response"} {
		if !strings.Contains(output, redacted) {
			t.Errorf("logs do not contain %q: %s", redacted, output)
		}
	}
}

func stringPointer(value string) *string { return &value }
