package main

import (
	"crypto/rand"
	"fmt"
	"log"
	"math/big"
	"os"
	"strings"

	upctokenservice "upctokenservice"
)

var operations = map[string]bool{
	"create-token": true,
	"refresh":      true,
	"delete":       true,
	"status":       true,
	"suspend":      true,
	"resume":       true,
	"card-content": true,
	"card-metadata": true,
}

var reasonCodes = map[string]bool{
	"DEVICE_LOST": true, "DEVICE_STOLEN": true, "SUSPECTED_FRAUD": true,
	"ACCOUNT_CLOSED": true, "NOT_FRAUD": true, "DEVICE_FOUND": true, "OTHER": true,
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		log.Printf("Token operation demo failed: %v", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printUsage()
		return nil
	}
	operation := strings.ToLower(args[0])
	if !operations[operation] {
		printUsage()
		return fmt.Errorf("unsupported operation: %s", operation)
	}
	if operation == "delete" && !contains(args[1:], "--confirm-delete") {
		return fmt.Errorf("delete is permanent; re-run with --confirm-delete to confirm")
	}

	resource := strings.TrimSpace(os.Getenv("UPC_BASE_URL"))
	if resource == "" {
		resource = strings.ToLower(valueOrDefault("UPC_ENVIRONMENT", "test"))
		if resource != "test" && resource != "production" {
			return fmt.Errorf("UPC_ENVIRONMENT must be either test or production")
		}
	}
	logging, err := parseBoolEnv("UPC_LOGGING", false)
	if err != nil {
		return err
	}
	client, err := upctokenservice.NewUpcTokenService(resource, upctokenservice.UpcTokenServiceOptions{
		MerchantID: requiredEnv("UPC_MERCHANT_ID"),
		TerminalID: requiredEnv("UPC_TERMINAL_ID"),
		Logging:    logging,
	})
	if err != nil {
		return err
	}

	trackingID := strings.TrimSpace(os.Getenv("UPC_TRACKING_ID"))
	if operation == "create-token" && trackingID == "" {
		trackingID, err = randomTrackingID()
		if err != nil {
			return err
		}
	} else if trackingID == "" {
		return fmt.Errorf("missing required environment variable: UPC_TRACKING_ID")
	}
	var response string
	switch operation {
	case "create-token":
		cardNum, err := requiredValue("UPC_CARD_NUMBER")
		if err != nil {
			return err
		}
		expMonth, err := requiredValue("UPC_CARD_EXP_MONTH")
		if err != nil {
			return err
		}
		expYear, err := requiredValue("UPC_CARD_EXP_YEAR")
		if err != nil {
			return err
		}
		card := upctokenservice.CardDetails{CardNum: cardNum, ExpMonth: expMonth, ExpYear: expYear}
		if cvv := optionalValue("UPC_CARD_CVV"); cvv != "" {
			card.CVNum = stringPointer(cvv)
		}
		response, err = client.CreateToken(upctokenservice.CreateTokenRequest{TrackingID: trackingID, Card: card})
	case "refresh", "status", "card-metadata":
		tokenID, err := requiredValue("UPC_TOKEN_ID")
		if err != nil {
			return err
		}
		request := upctokenservice.TokenRequest{TrackingID: trackingID, TokenID: tokenID}
		switch operation {
		case "refresh":
			response, err = client.RefreshToken(request)
		case "status":
			response, err = client.GetTokenStatus(request)
		default:
			response, err = client.GetCardMetadata(upctokenservice.CardMetadataRequest{TrackingID: trackingID, TokenID: tokenID})
		}
	case "delete", "suspend", "resume":
		tokenID, err := requiredValue("UPC_TOKEN_ID")
		if err != nil {
			return err
		}
		request := upctokenservice.UpdateTokenRequest{TrackingID: trackingID, TokenID: tokenID}
		if code := optionalValue("UPC_REASON_CODE"); code != "" {
			if !reasonCodes[code] {
				return fmt.Errorf("UPC_REASON_CODE must be one of the supported token reason codes")
			}
			reasonCode := upctokenservice.TokenReasonCode(code)
			request.ReasonCode = &reasonCode
		}
		if reason := optionalValue("UPC_REASON"); reason != "" {
			request.Reason = stringPointer(reason)
		}
		switch operation {
		case "delete":
			response, err = client.DeleteToken(request)
		case "suspend":
			response, err = client.SuspendToken(request)
		default:
			response, err = client.ResumeToken(request)
		}
	case "card-content":
		contentID, err := requiredValue("UPC_CONTENT_ID")
		if err != nil {
			return err
		}
		request := upctokenservice.CardContentRequest{TrackingID: trackingID, ContentID: contentID}
		if brand := optionalValue("UPC_CARD_BRAND"); brand != "" {
			request.Brand = stringPointer(brand)
		}
		response, err = client.GetCardContent(request)
	}
	if err != nil {
		return err
	}
	if response == "" {
		fmt.Printf("%s XML response: [empty response body]\n", operation)
	} else {
		fmt.Printf("%s XML response: %s\n", operation, redactSensitiveXML(response))
	}
	return nil
}

func requiredEnv(name string) string {
	value, err := requiredValue(name)
	if err != nil {
		log.Print(err)
		os.Exit(1)
	}
	return value
}

func requiredValue(name string) (string, error) {
	value := optionalValue(name)
	if value == "" {
		return "", fmt.Errorf("missing required environment variable: %s", name)
	}
	return value, nil
}

func optionalValue(name string) string { return strings.TrimSpace(os.Getenv(name)) }

func valueOrDefault(name, fallback string) string {
	if value := optionalValue(name); value != "" {
		return value
	}
	return fallback
}

func parseBoolEnv(name string, fallback bool) (bool, error) {
	value := strings.ToLower(optionalValue(name))
	if value == "" {
		return fallback, nil
	}
	if value != "true" && value != "false" {
		return false, fmt.Errorf("%s must be either true or false", name)
	}
	return value == "true", nil
}

func randomTrackingID() (string, error) {
	value, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", fmt.Errorf("generate tracking ID: %w", err)
	}
	return fmt.Sprintf("%06d", value.Int64()+100000), nil
}

func contains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func stringPointer(value string) *string { return &value }

func printUsage() {
	fmt.Println("Usage: go run ./demo <operation> [--confirm-delete]")
	fmt.Println("Operations: create-token, refresh, delete, status, suspend, resume, card-content, card-metadata")
	fmt.Println("create-token requires UPC_CARD_NUMBER, UPC_CARD_EXP_MONTH, and UPC_CARD_EXP_YEAR.")
	fmt.Println("Other operations require UPC_TRACKING_ID and UPC_TOKEN_ID or UPC_CONTENT_ID.")
}

func redactSensitiveXML(xml string) string {
	return redactXMLForLog(xml)
}
