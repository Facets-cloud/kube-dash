package configurations

import (
	"fmt"
	"net/http"

	"github.com/Facets-cloud/kube-dash/internal/api/transformers"
	"github.com/Facets-cloud/kube-dash/internal/api/types"
	"github.com/Facets-cloud/kube-dash/internal/api/utils"
	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// SecretsHandler handles Secret-related API requests
type SecretsHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	sseHandler    *utils.SSEHandler
	yamlHandler   *utils.YAMLHandler
	eventsHandler *utils.EventsHandler
}

// NewSecretsHandler creates a new SecretsHandler
func NewSecretsHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *SecretsHandler {
	return &SecretsHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		sseHandler:    utils.NewSSEHandler(log),
		yamlHandler:   utils.NewYAMLHandler(log),
		eventsHandler: utils.NewEventsHandler(log),
	}
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *SecretsHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, error) {
	configID := c.Query("config")
	cluster := c.Query("cluster")

	if configID == "" {
		return nil, fmt.Errorf("config parameter is required")
	}

	config, err := h.store.GetKubeConfig(configID)
	if err != nil {
		return nil, fmt.Errorf("config not found: %w", err)
	}

	client, err := h.clientFactory.GetClientForConfig(config, cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to get Kubernetes client: %w", err)
	}

	return client, nil
}

// GetSecrets returns all secrets in a namespace
func (h *SecretsHandler) GetSecrets(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secrets")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Query("namespace")
	secretList, err := client.CoreV1().Secrets(namespace).List(c.Request.Context(), metav1.ListOptions{})
	if err != nil {
		h.logger.WithError(err).Error("Failed to list secrets")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Transform secrets to the expected format
	var transformedSecrets []types.SecretListResponse
	for _, secret := range secretList.Items {
		transformedSecrets = append(transformedSecrets, transformers.TransformSecretToResponse(&secret))
	}

	c.JSON(http.StatusOK, transformedSecrets)
}

// GetSecretsSSE returns secrets as Server-Sent Events with real-time updates
func (h *SecretsHandler) GetSecretsSSE(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secrets SSE")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	namespace := c.Query("namespace")

	// Function to fetch and transform secrets data
	fetchSecrets := func() (interface{}, error) {
		secretList, err := client.CoreV1().Secrets(namespace).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			return nil, err
		}

		// Transform secrets to the expected format
		var transformedSecrets []types.SecretListResponse
		for _, secret := range secretList.Items {
			transformedSecrets = append(transformedSecrets, transformers.TransformSecretToResponse(&secret))
		}

		return transformedSecrets, nil
	}

	// Get initial data
	initialData, err := fetchSecrets()
	if err != nil {
		h.logger.WithError(err).Error("Failed to list secrets for SSE")

		// Check if this is a permission error
		if utils.IsPermissionError(err) {
			h.sseHandler.SendSSEPermissionError(c, err)
		} else {
			h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// Check if this is an SSE request (EventSource expects SSE format)
	acceptHeader := c.GetHeader("Accept")
	if acceptHeader == "text/event-stream" {
		// Send SSE response with periodic updates
		h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchSecrets)
		return
	}

	// For non-SSE requests, return JSON
	c.JSON(http.StatusOK, initialData)
}

// GetSecret returns a specific secret
func (h *SecretsHandler) GetSecret(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Param("namespace")
	name := c.Param("name")
	secret, err := client.CoreV1().Secrets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("secret", name).WithField("namespace", namespace).Error("Failed to get secret")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Check if this is an SSE request (EventSource expects SSE format)
	acceptHeader := c.GetHeader("Accept")
	if acceptHeader == "text/event-stream" {
		h.sseHandler.SendSSEResponse(c, secret)
		return
	}

	c.JSON(http.StatusOK, secret)
}

// GetSecretByName returns a specific secret by name using namespace from query parameters
func (h *SecretsHandler) GetSecretByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("secret", name).Error("Namespace is required for secret lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	secret, err := client.CoreV1().Secrets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("secret", name).WithField("namespace", namespace).Error("Failed to get secret")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Check if this is an SSE request (EventSource expects SSE format)
	acceptHeader := c.GetHeader("Accept")
	if acceptHeader == "text/event-stream" {
		h.sseHandler.SendSSEResponse(c, secret)
		return
	}

	c.JSON(http.StatusOK, secret)
}

// GetSecretYAMLByName returns the YAML representation of a specific secret by name using namespace from query parameters
func (h *SecretsHandler) GetSecretYAMLByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("secret", name).Error("Namespace is required for secret YAML lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	secret, err := client.CoreV1().Secrets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("secret", name).WithField("namespace", namespace).Error("Failed to get secret for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, secret, name)
}

// GetSecretYAML returns the YAML representation of a specific secret
func (h *SecretsHandler) GetSecretYAML(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Param("namespace")
	name := c.Param("name")
	secret, err := client.CoreV1().Secrets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("secret", name).WithField("namespace", namespace).Error("Failed to get secret for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, secret, name)
}

// GetSecretEventsByName returns events for a specific secret by name using namespace from query parameters
func (h *SecretsHandler) GetSecretEventsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("secret", name).Error("Namespace is required for secret events lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.eventsHandler.GetResourceEventsWithNamespace(c, client, "Secret", name, namespace, h.sseHandler.SendSSEResponse)
}

// GetSecretEvents returns events for a specific secret
func (h *SecretsHandler) GetSecretEvents(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Param("namespace")

	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for secret events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.eventsHandler.GetResourceEventsWithNamespace(c, client, "Secret", name, namespace, h.sseHandler.SendSSEResponse)
}
