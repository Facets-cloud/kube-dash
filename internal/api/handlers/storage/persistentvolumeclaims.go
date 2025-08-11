package storage

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
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// PersistentVolumeClaimsHandler handles PersistentVolumeClaim-related operations
type PersistentVolumeClaimsHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	eventsHandler *utils.EventsHandler
	yamlHandler   *utils.YAMLHandler
	sseHandler    *utils.SSEHandler
}

// NewPersistentVolumeClaimsHandler creates a new PersistentVolumeClaims handler
func NewPersistentVolumeClaimsHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *PersistentVolumeClaimsHandler {
	return &PersistentVolumeClaimsHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		eventsHandler: utils.NewEventsHandler(log),
		yamlHandler:   utils.NewYAMLHandler(log),
		sseHandler:    utils.NewSSEHandler(log),
	}
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *PersistentVolumeClaimsHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, error) {
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

// GetPersistentVolumeClaimsSSE returns persistent volume claims as Server-Sent Events with real-time updates
func (h *PersistentVolumeClaimsHandler) GetPersistentVolumeClaimsSSE(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claims SSE")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	namespace := c.Query("namespace")

	// Function to fetch persistent volume claims data
	fetchPVCs := func() (interface{}, error) {
		pvcs, err := client.CoreV1().PersistentVolumeClaims(namespace).List(c.Request.Context(), metav1.ListOptions{})
		if err != nil {
			return nil, err
		}

		// Transform persistent volume claims to frontend-expected format
		responses := make([]types.PersistentVolumeClaimListResponse, len(pvcs.Items))
		for i, pvc := range pvcs.Items {
			responses[i] = transformers.TransformPVCToResponse(&pvc)
		}

		return responses, nil
	}

	// Get initial data
	initialData, err := fetchPVCs()
	if err != nil {
		h.logger.WithError(err).Error("Failed to list persistent volume claims for SSE")
		// Check if this is a permission error
		if utils.IsPermissionError(err) {
			h.sseHandler.SendSSEPermissionError(c, err)
		} else {
			h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		}
		return
	}

	// Send SSE response with periodic updates
	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPVCs)
}

// GetPVC returns a specific persistent volume claim
func (h *PersistentVolumeClaimsHandler) GetPVC(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim")
		// For EventSource, send error as SSE
		if c.GetHeader("Accept") == "text/event-stream" {
			h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		}
		return
	}

	namespace := c.Param("namespace")
	name := c.Param("name")

	pvc, err := client.CoreV1().PersistentVolumeClaims(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to get persistent volume claim")
		// For EventSource, send error as SSE
		if c.GetHeader("Accept") == "text/event-stream" {
			h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		} else {
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		}
		return
	}

	// Check if this is an SSE request (EventSource expects SSE format)
	acceptHeader := c.GetHeader("Accept")
	if acceptHeader == "text/event-stream" {
		h.sseHandler.SendSSEResponse(c, pvc)
		return
	}

	c.JSON(http.StatusOK, pvc)
}

// GetPVCByName returns a specific persistent volume claim by name
func (h *PersistentVolumeClaimsHandler) GetPVCByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim by name")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	pvc, err := client.CoreV1().PersistentVolumeClaims(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to get persistent volume claim by name")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, pvc)
}

// GetPVCYAMLByName returns the YAML representation of a specific persistent volume claim by name
func (h *PersistentVolumeClaimsHandler) GetPVCYAMLByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim YAML by name")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	pvc, err := client.CoreV1().PersistentVolumeClaims(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to get persistent volume claim for YAML by name")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, pvc, name)
}

// GetPVCYAML returns the YAML representation of a specific persistent volume claim
func (h *PersistentVolumeClaimsHandler) GetPVCYAML(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Param("namespace")
	name := c.Param("name")

	pvc, err := client.CoreV1().PersistentVolumeClaims(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to get persistent volume claim for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, pvc, name)
}

// GetPVCEventsByName returns events for a specific persistent volume claim by name
func (h *PersistentVolumeClaimsHandler) GetPVCEventsByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("pvc", name).Error("Namespace is required for persistent volume claim events lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	h.eventsHandler.GetResourceEventsWithNamespace(c, client, "PersistentVolumeClaim", name, namespace, h.sseHandler.SendSSEResponse)
}

// GetPVCEvents returns events for a specific persistent volume claim
func (h *PersistentVolumeClaimsHandler) GetPVCEvents(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for persistent volume claim events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	h.eventsHandler.GetResourceEvents(c, client, "PersistentVolumeClaim", name, h.sseHandler.SendSSEResponse)
}

// ScalePVC scales a persistent volume claim to a new size
func (h *PersistentVolumeClaimsHandler) ScalePVC(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for PVC scaling")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Param("namespace")
	name := c.Param("name")

	// Parse request body
	var request struct {
		Size string `json:"size" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		h.logger.WithError(err).Error("Failed to parse PVC scale request")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	// Get current PVC
	pvc, err := client.CoreV1().PersistentVolumeClaims(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to get PVC for scaling")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Get current size
	currentSize := pvc.Spec.Resources.Requests.Storage()
	if currentSize == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Current PVC size cannot be determined"})
		return
	}

	// Parse new size
	newSize, err := resource.ParseQuantity(request.Size)
	if err != nil {
		h.logger.WithError(err).Error("Failed to parse new size")
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid size format"})
		return
	}

	// Validate that new size is greater than current size
	if newSize.Cmp(*currentSize) <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New size must be greater than current size"})
		return
	}

	// Update PVC spec with new size
	pvc.Spec.Resources.Requests[corev1.ResourceStorage] = newSize

	// Apply the update
	updatedPVC, err := client.CoreV1().PersistentVolumeClaims(namespace).Update(c.Request.Context(), pvc, metav1.UpdateOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pvc", name).WithField("namespace", namespace).Error("Failed to update PVC size")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.logger.WithField("pvc", name).WithField("namespace", namespace).WithField("oldSize", currentSize.String()).WithField("newSize", newSize.String()).Info("PVC scaled successfully")

	c.JSON(http.StatusOK, gin.H{
		"message": "PVC scaled successfully",
		"pvc":     updatedPVC,
	})
}
