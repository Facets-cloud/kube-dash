package handlers

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/Facets-cloud/kube-dash/pkg/logger"
	"github.com/gin-gonic/gin"
)

// FeatureFlagsHandler handles feature flag requests
type FeatureFlagsHandler struct {
	logger *logger.Logger
}

// FeatureFlagsResponse represents the response structure for feature flags
type FeatureFlagsResponse struct {
	EnableTracing bool `json:"enableTracing"`
}

// NewFeatureFlagsHandler creates a new feature flags handler
func NewFeatureFlagsHandler(log *logger.Logger) *FeatureFlagsHandler {
	return &FeatureFlagsHandler{
		logger: log,
	}
}

// GetFeatureFlags returns the current feature flag configuration
func (h *FeatureFlagsHandler) GetFeatureFlags(c *gin.Context) {
	// Read runtime environment variables
	enableTracing := h.getBoolEnvVar("ENABLE_TRACING", false)

	h.logger.WithField("enableTracing", enableTracing).Debug("Serving feature flags")

	response := FeatureFlagsResponse{
		EnableTracing: enableTracing,
	}

	c.JSON(http.StatusOK, response)
}

// getBoolEnvVar reads a boolean environment variable with a default value
func (h *FeatureFlagsHandler) getBoolEnvVar(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}

	// Handle common boolean representations
	value = strings.ToLower(strings.TrimSpace(value))
	switch value {
	case "true", "1", "yes", "on", "enabled":
		return true
	case "false", "0", "no", "off", "disabled":
		return false
	default:
		// Try to parse as boolean
		if parsed, err := strconv.ParseBool(value); err == nil {
			return parsed
		}
		h.logger.WithField("key", key).WithField("value", value).Warn("Invalid boolean value for environment variable, using default")
		return defaultValue
	}
}