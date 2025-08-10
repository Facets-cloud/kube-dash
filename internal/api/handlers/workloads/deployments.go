package workloads

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Facets-cloud/kube-dash/internal/api/transformers"
	"github.com/Facets-cloud/kube-dash/internal/api/types"
	"github.com/Facets-cloud/kube-dash/internal/api/utils"
	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	appsV1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// DeploymentsHandler handles all deployment-related operations
type DeploymentsHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	sseHandler    *utils.SSEHandler
	yamlHandler   *utils.YAMLHandler
	eventsHandler *utils.EventsHandler
}

// NewDeploymentsHandler creates a new deployments handler
func NewDeploymentsHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *DeploymentsHandler {
	return &DeploymentsHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		sseHandler:    utils.NewSSEHandler(log),
		yamlHandler:   utils.NewYAMLHandler(log),
		eventsHandler: utils.NewEventsHandler(log),
	}
}

// ScaleDeployment updates the replicas of a Deployment via the scale subresource
func (h *DeploymentsHandler) ScaleDeployment(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for scaling deployment")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")
	if namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "namespace parameter is required", "code": http.StatusBadRequest})
		return
	}

	var body struct {
		Replicas int32 `json:"replicas"`
	}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"message": "invalid request body", "code": http.StatusBadRequest})
		return
	}

	scale, err := client.AppsV1().Deployments(namespace).GetScale(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment scale")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	scale.Spec.Replicas = body.Replicas
	if _, err := client.AppsV1().Deployments(namespace).UpdateScale(c.Request.Context(), name, scale, metav1.UpdateOptions{}); err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to update deployment scale")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deployment Scaled"})
}

// RestartDeployment restarts all pods in a deployment by adding a restart annotation
func (h *DeploymentsHandler) RestartDeployment(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for restarting deployment")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")
	if namespace == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "namespace parameter is required", "code": http.StatusBadRequest})
		return
	}

	var body struct {
		RestartType string `json:"restartType"` // "rolling" or "recreate"
	}
	if err := c.BindJSON(&body); err != nil {
		// Default to rolling restart if no body provided
		body.RestartType = "rolling"
	}

	// Validate restart type
	if body.RestartType != "rolling" && body.RestartType != "recreate" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "restartType must be 'rolling' or 'recreate'", "code": http.StatusBadRequest})
		return
	}

	if body.RestartType == "rolling" {
		// Rolling restart: Add restart annotation to trigger gradual pod replacement
		err = h.performRollingRestart(client, name, namespace)
		if err != nil {
			h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to perform rolling restart")
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Rolling restart initiated - pods will be replaced gradually while maintaining availability"})
	} else {
		// Recreate restart: Set replicas to 0, then back to original count
		err = h.performRecreateRestart(client, name, namespace)
		if err != nil {
			h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to perform recreate restart")
			c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Recreate restart initiated - pods will be restarted in the background"})
	}
}

// performRollingRestart performs a rolling restart by adding a restart annotation
func (h *DeploymentsHandler) performRollingRestart(client *kubernetes.Clientset, name, namespace string) error {
	// Get the current deployment
	deployment, err := client.AppsV1().Deployments(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	// Add restart annotation to trigger gradual pod replacement
	if deployment.Spec.Template.Annotations == nil {
		deployment.Spec.Template.Annotations = make(map[string]string)
	}
	deployment.Spec.Template.Annotations["kubectl.kubernetes.io/restartedAt"] = metav1.Now().Format("2006-01-02T15:04:05Z07:00")

	// Update the deployment
	_, err = client.AppsV1().Deployments(namespace).Update(context.Background(), deployment, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("failed to update deployment: %w", err)
	}

	return nil
}

// performRecreateRestart performs a recreate restart by scaling to 0 then back to original count
func (h *DeploymentsHandler) performRecreateRestart(client *kubernetes.Clientset, name, namespace string) error {
	// Get the current deployment to get original replica count
	deployment, err := client.AppsV1().Deployments(namespace).Get(context.Background(), name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("failed to get deployment: %w", err)
	}

	originalReplicas := int32(1)
	if deployment.Spec.Replicas != nil {
		originalReplicas = *deployment.Spec.Replicas
	}

	// Scale down to 0 with retry mechanism
	err = h.scaleDeploymentWithRetry(client, name, namespace, 0)
	if err != nil {
		return fmt.Errorf("failed to scale down deployment: %w", err)
	}

	// Start the scale-up process in a goroutine to avoid blocking the response
	go func() {
		// Wait a moment for pods to terminate
		time.Sleep(3 * time.Second)

		// Scale back up to original replicas with retry mechanism
		err := h.scaleDeploymentWithRetry(client, name, namespace, originalReplicas)
		if err != nil {
			h.logger.WithError(err).WithFields(map[string]interface{}{
				"deployment": name,
				"namespace":  namespace,
				"replicas":   originalReplicas,
			}).Error("Failed to scale up deployment during recreate restart")
		} else {
			h.logger.WithFields(map[string]interface{}{
				"deployment": name,
				"namespace":  namespace,
				"replicas":   originalReplicas,
			}).Info("Successfully completed recreate restart scale-up")
		}
	}()

	return nil
}

// scaleDeploymentWithRetry scales a deployment with retry mechanism for handling "object has been modified" errors
func (h *DeploymentsHandler) scaleDeploymentWithRetry(client *kubernetes.Clientset, name, namespace string, replicas int32) error {
	maxRetries := 5
	backoffDuration := 100 * time.Millisecond

	for attempt := 0; attempt < maxRetries; attempt++ {
		// Get the latest scale object
		scale, err := client.AppsV1().Deployments(namespace).GetScale(context.Background(), name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("failed to get deployment scale: %w", err)
		}

		// Update the replicas
		scale.Spec.Replicas = replicas

		// Try to update the scale
		_, err = client.AppsV1().Deployments(namespace).UpdateScale(context.Background(), name, scale, metav1.UpdateOptions{})
		if err == nil {
			// Success, no need to retry
			return nil
		}

		// Check if it's a conflict error (object has been modified)
		if isConflictError(err) {
			if attempt < maxRetries-1 {
				// Wait before retrying with exponential backoff
				time.Sleep(backoffDuration)
				backoffDuration *= 2 // Exponential backoff
				continue
			}
		}

		// If it's not a conflict error or we've exhausted retries, return the error
		return fmt.Errorf("failed to scale deployment after %d attempts: %w", maxRetries, err)
	}

	return fmt.Errorf("failed to scale deployment after %d attempts", maxRetries)
}

// isConflictError checks if the error is a conflict error (object has been modified)
func isConflictError(err error) bool {
	if err == nil {
		return false
	}

	// Check if the error message contains conflict-related keywords
	errMsg := err.Error()
	return strings.Contains(errMsg, "the object has been modified") ||
		strings.Contains(errMsg, "conflict") ||
		strings.Contains(errMsg, "409")
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *DeploymentsHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, error) {
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

// GetDeployments returns all deployments
func (h *DeploymentsHandler) GetDeployments(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployments")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	namespace := c.Query("namespace")
	var deployments interface{}
	var err2 error

	if namespace != "" {
		deployments, err2 = client.AppsV1().Deployments(namespace).List(c.Request.Context(), metav1.ListOptions{})
	} else {
		deployments, err2 = client.AppsV1().Deployments("").List(c.Request.Context(), metav1.ListOptions{})
	}

	if err2 != nil {
		h.logger.WithError(err2).Error("Failed to list deployments")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err2.Error()})
		return
	}

	c.JSON(http.StatusOK, deployments)
}

// GetDeploymentsSSE returns deployments as Server-Sent Events with real-time updates
func (h *DeploymentsHandler) GetDeploymentsSSE(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployments SSE")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	namespace := c.Query("namespace")

	// Function to fetch and transform deployments data
	fetchDeployments := func() (interface{}, error) {
		var deploymentList *appsV1.DeploymentList
		var err2 error

		if namespace != "" {
			deploymentList, err2 = client.AppsV1().Deployments(namespace).List(c.Request.Context(), metav1.ListOptions{})
		} else {
			deploymentList, err2 = client.AppsV1().Deployments("").List(c.Request.Context(), metav1.ListOptions{})
		}

		if err2 != nil {
			return nil, err2
		}

		// Transform deployments to the expected format
		var transformedDeployments []types.DeploymentListResponse
		for _, deployment := range deploymentList.Items {
			transformedDeployments = append(transformedDeployments, transformers.TransformDeploymentToResponse(&deployment))
		}

		return transformedDeployments, nil
	}

	// Get initial data
	initialData, err := fetchDeployments()
	if err != nil {
		h.logger.WithError(err).Error("Failed to list deployments for SSE")

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
		h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchDeployments)
		return
	}

	// For non-SSE requests, return JSON
	c.JSON(http.StatusOK, initialData)
}

// GetDeployment returns a specific deployment
func (h *DeploymentsHandler) GetDeployment(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Always send SSE format for detail endpoints since they're used by EventSource
	h.sseHandler.SendSSEResponse(c, deployment)
}

// GetDeploymentByName returns a specific deployment by name using namespace from query parameters
func (h *DeploymentsHandler) GetDeploymentByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("deployment", name).Error("Namespace is required for deployment lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Always send SSE format for detail endpoints since they're used by EventSource
	h.sseHandler.SendSSEResponse(c, deployment)
}

// GetDeploymentYAMLByName returns the YAML representation of a specific deployment by name
func (h *DeploymentsHandler) GetDeploymentYAMLByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("deployment", name).Error("Namespace is required for deployment YAML lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, deployment, name)
}

// GetDeploymentYAML returns the YAML representation of a specific deployment
func (h *DeploymentsHandler) GetDeploymentYAML(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, deployment, name)
}

// GetDeploymentEventsByName returns events for a specific deployment by name
func (h *DeploymentsHandler) GetDeploymentEventsByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("deployment", name).Error("Namespace is required for deployment events lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	h.eventsHandler.GetResourceEventsWithNamespace(c, client, "Deployment", name, namespace, h.sseHandler.SendSSEResponse)
}

// GetDeploymentEvents returns events for a specific deployment
func (h *DeploymentsHandler) GetDeploymentEvents(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	h.eventsHandler.GetResourceEvents(c, client, "Deployment", name, h.sseHandler.SendSSEResponse)
}

// GetDeploymentPods returns pods for a specific deployment
func (h *DeploymentsHandler) GetDeploymentPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment pods")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the deployment to get its selector
	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Get pods using the deployment's selector
	selector := metav1.FormatLabelSelector(deployment.Spec.Selector)
	pods, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
		LabelSelector: selector,
	})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment pods")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Always send SSE format for detail endpoints since they're used by EventSource
	h.sseHandler.SendSSEResponse(c, pods)
}

// GetDeploymentPodsByName returns pods for a specific deployment by name using namespace from query parameters
func (h *DeploymentsHandler) GetDeploymentPodsByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment pods")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("deployment", name).Error("Namespace is required for deployment pods lookup")
		c.JSON(http.StatusBadRequest, gin.H{"error": "namespace parameter is required"})
		return
	}

	// Get the deployment to get its selector
	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment")
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}

	// Get pods using the deployment's selector
	selector := metav1.FormatLabelSelector(deployment.Spec.Selector)
	pods, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
		LabelSelector: selector,
	})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment pods")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Always send SSE format for detail endpoints since they're used by EventSource
	h.sseHandler.SendSSEResponse(c, pods)
}
