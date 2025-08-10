package workloads

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

// ResourceReferencesHandler handles resource reference operations
type ResourceReferencesHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	sseHandler    *utils.SSEHandler
}

// NewResourceReferencesHandler creates a new ResourceReferencesHandler
func NewResourceReferencesHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *ResourceReferencesHandler {
	return &ResourceReferencesHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		sseHandler:    utils.NewSSEHandler(log),
	}
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *ResourceReferencesHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, error) {
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

// GetDeploymentPods returns pods for a specific deployment
func (h *ResourceReferencesHandler) GetDeploymentPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for deployment pods")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the deployment to get its selector
	deployment, err := client.AppsV1().Deployments(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment")
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		return
	}

	// Prepare initial data and periodic updater
	selector := metav1.FormatLabelSelector(deployment.Spec.Selector)
	fetchPods := func() (interface{}, error) {
		podList, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, err
		}
		configID := c.Query("config")
		clusterName := c.Query("cluster")
		var response []types.PodListResponse
		for _, pod := range podList.Items {
			response = append(response, transformers.TransformPodToResponse(&pod, configID, clusterName))
		}
		return response, nil
	}

	initialData, err := fetchPods()
	if err != nil {
		h.logger.WithError(err).WithField("deployment", name).WithField("namespace", namespace).Error("Failed to get deployment pods")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	// Send SSE response with periodic updates so UI reflects scale changes
	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPods)
}

// GetDaemonSetPods returns pods for a specific daemonset
func (h *ResourceReferencesHandler) GetDaemonSetPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for daemonset pods")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the daemonset to get its selector
	daemonSet, err := client.AppsV1().DaemonSets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("daemonset", name).WithField("namespace", namespace).Error("Failed to get daemonset")
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		return
	}

	selector := metav1.FormatLabelSelector(daemonSet.Spec.Selector)
	fetchPods := func() (interface{}, error) {
		podList, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, err
		}
		configID := c.Query("config")
		clusterName := c.Query("cluster")
		var response []types.PodListResponse
		for _, pod := range podList.Items {
			response = append(response, transformers.TransformPodToResponse(&pod, configID, clusterName))
		}
		return response, nil
	}

	initialData, err := fetchPods()
	if err != nil {
		h.logger.WithError(err).WithField("daemonset", name).WithField("namespace", namespace).Error("Failed to get daemonset pods")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPods)
}

// GetStatefulSetPods returns pods for a specific statefulset
func (h *ResourceReferencesHandler) GetStatefulSetPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for statefulset pods")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the statefulset to get its selector
	statefulSet, err := client.AppsV1().StatefulSets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("statefulset", name).WithField("namespace", namespace).Error("Failed to get statefulset")
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		return
	}

	selector := metav1.FormatLabelSelector(statefulSet.Spec.Selector)
	fetchPods := func() (interface{}, error) {
		podList, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, err
		}
		configID := c.Query("config")
		clusterName := c.Query("cluster")
		var response []types.PodListResponse
		for _, pod := range podList.Items {
			response = append(response, transformers.TransformPodToResponse(&pod, configID, clusterName))
		}
		return response, nil
	}

	initialData, err := fetchPods()
	if err != nil {
		h.logger.WithError(err).WithField("statefulset", name).WithField("namespace", namespace).Error("Failed to get statefulset pods")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPods)
}

// GetReplicaSetPods returns pods for a specific replicaset
func (h *ResourceReferencesHandler) GetReplicaSetPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for replicaset pods")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the replicaset to get its selector
	replicaSet, err := client.AppsV1().ReplicaSets(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("replicaset", name).WithField("namespace", namespace).Error("Failed to get replicaset")
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		return
	}

	selector := metav1.FormatLabelSelector(replicaSet.Spec.Selector)
	fetchPods := func() (interface{}, error) {
		podList, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, err
		}
		configID := c.Query("config")
		clusterName := c.Query("cluster")
		var response []types.PodListResponse
		for _, pod := range podList.Items {
			response = append(response, transformers.TransformPodToResponse(&pod, configID, clusterName))
		}
		return response, nil
	}

	initialData, err := fetchPods()
	if err != nil {
		h.logger.WithError(err).WithField("replicaset", name).WithField("namespace", namespace).Error("Failed to get replicaset pods")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPods)
}

// GetJobPods returns pods for a specific job
func (h *ResourceReferencesHandler) GetJobPods(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for job pods")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get the job to get its selector
	job, err := client.BatchV1().Jobs(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("job", name).WithField("namespace", namespace).Error("Failed to get job")
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err.Error())
		return
	}

	selector := metav1.FormatLabelSelector(job.Spec.Selector)
	fetchPods := func() (interface{}, error) {
		podList, err := client.CoreV1().Pods(namespace).List(c.Request.Context(), metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			return nil, err
		}
		configID := c.Query("config")
		clusterName := c.Query("cluster")
		var response []types.PodListResponse
		for _, pod := range podList.Items {
			response = append(response, transformers.TransformPodToResponse(&pod, configID, clusterName))
		}
		return response, nil
	}

	initialData, err := fetchPods()
	if err != nil {
		h.logger.WithError(err).WithField("job", name).WithField("namespace", namespace).Error("Failed to get job pods")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchPods)
}

// GetCronJobJobs returns jobs for a specific cronjob
func (h *ResourceReferencesHandler) GetCronJobJobs(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for cronjob jobs")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	name := c.Param("name")
	namespace := c.Param("namespace")

	// Get jobs using the cronjob's name as a label selector
	jobs, err := client.BatchV1().Jobs(namespace).List(c.Request.Context(), metav1.ListOptions{
		LabelSelector: fmt.Sprintf("job-name=%s", name),
	})
	if err != nil {
		h.logger.WithError(err).WithField("cronjob", name).WithField("namespace", namespace).Error("Failed to get cronjob jobs")
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}

	// Transform jobs to frontend-expected format
	var response []types.JobListResponse
	for _, job := range jobs.Items {
		response = append(response, transformers.TransformJobToResponse(&job))
	}

	// Always send SSE format for detail endpoints since they're used by EventSource
	h.sseHandler.SendSSEResponse(c, response)
}

// GetDeploymentPodsByName returns pods for a specific deployment by name using namespace from query parameters
func (h *ResourceReferencesHandler) GetDeploymentPodsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("deployment", name).Error("Namespace is required for deployment pods lookup")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "namespace parameter is required")
		return
	}

	// Set the namespace in the context for the main handler
	c.Params = append(c.Params, gin.Param{Key: "namespace", Value: namespace})
	h.GetDeploymentPods(c)
}

// GetDaemonSetPodsByName returns pods for a specific daemonset by name using namespace from query parameters
func (h *ResourceReferencesHandler) GetDaemonSetPodsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("daemonset", name).Error("Namespace is required for daemonset pods lookup")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "namespace parameter is required")
		return
	}

	// Set the namespace in the context for the main handler
	c.Params = append(c.Params, gin.Param{Key: "namespace", Value: namespace})
	h.GetDaemonSetPods(c)
}

// GetStatefulSetPodsByName returns pods for a specific statefulset by name using namespace from query parameters
func (h *ResourceReferencesHandler) GetStatefulSetPodsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("statefulset", name).Error("Namespace is required for statefulset pods lookup")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "namespace parameter is required")
		return
	}

	// Set the namespace in the context for the main handler
	c.Params = append(c.Params, gin.Param{Key: "namespace", Value: namespace})
	h.GetStatefulSetPods(c)
}

// GetReplicaSetPodsByName returns pods for a specific replicaset by name using namespace from query parameters
func (h *ResourceReferencesHandler) GetReplicaSetPodsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("replicaset", name).Error("Namespace is required for replicaset pods lookup")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "namespace parameter is required")
		return
	}

	// Set the namespace in the context for the main handler
	c.Params = append(c.Params, gin.Param{Key: "namespace", Value: namespace})
	h.GetReplicaSetPods(c)
}

// GetJobPodsByName returns pods for a specific job by name using namespace from query parameters
func (h *ResourceReferencesHandler) GetJobPodsByName(c *gin.Context) {
	name := c.Param("name")
	namespace := c.Query("namespace")

	if namespace == "" {
		h.logger.WithField("job", name).Error("Namespace is required for job pods lookup")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "namespace parameter is required")
		return
	}

	// Set the namespace in the context for the main handler
	c.Params = append(c.Params, gin.Param{Key: "namespace", Value: namespace})
	h.GetJobPods(c)
}
