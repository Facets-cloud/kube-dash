package custom_resources

import (
	"fmt"
	"net/http"

	"github.com/Facets-cloud/kube-dash/internal/api/transformers"
	"github.com/Facets-cloud/kube-dash/internal/api/utils"
	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/tools/clientcmd"
)

// CustomResourcesHandler handles CustomResources operations
type CustomResourcesHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	sseHandler    *utils.SSEHandler
	yamlHandler   *utils.YAMLHandler
	eventsHandler *utils.EventsHandler
}

// NewCustomResourcesHandler creates a new CustomResourcesHandler
func NewCustomResourcesHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *CustomResourcesHandler {
	return &CustomResourcesHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		sseHandler:    utils.NewSSEHandler(log),
		yamlHandler:   utils.NewYAMLHandler(log),
		eventsHandler: utils.NewEventsHandler(log),
	}
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *CustomResourcesHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, error) {
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

// getDynamicClient gets the dynamic client for custom resources
func (h *CustomResourcesHandler) getDynamicClient(c *gin.Context) (dynamic.Interface, error) {
	configID := c.Query("config")
	cluster := c.Query("cluster")

	if configID == "" {
		return nil, fmt.Errorf("config parameter is required")
	}

	config, err := h.store.GetKubeConfig(configID)
	if err != nil {
		return nil, fmt.Errorf("config not found: %w", err)
	}

	// Create a copy of the config and set the context to the specific cluster
	configCopy := config.DeepCopy()

	// Find the context that matches the cluster name
	for contextName, context := range configCopy.Contexts {
		if context.Cluster == cluster {
			configCopy.CurrentContext = contextName
			break
		}
	}

	// If no matching context found, use the first context
	if configCopy.CurrentContext == "" && len(configCopy.Contexts) > 0 {
		for contextName := range configCopy.Contexts {
			configCopy.CurrentContext = contextName
			break
		}
	}

	// Create client config
	clientConfig := clientcmd.NewDefaultClientConfig(*configCopy, &clientcmd.ConfigOverrides{})
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, fmt.Errorf("failed to create client config: %w", err)
	}

	// Create dynamic client
	dynamicClient, err := dynamic.NewForConfig(restConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create dynamic client: %w", err)
	}

	return dynamicClient, nil
}

// GetCustomResources returns custom resources for a specific CRD
func (h *CustomResourcesHandler) GetCustomResources(c *gin.Context) {
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resources")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Query("namespace")

	if group == "" || version == "" || resource == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group, version, and resource parameters are required"})
		return
	}

	gvr := schema.GroupVersionResource{
		Group:    group,
		Version:  version,
		Resource: resource,
	}

	var crList interface{}
	var err2 error

	if namespace != "" {
		crList, err2 = dynamicClient.Resource(gvr).Namespace(namespace).List(c.Request.Context(), metav1.ListOptions{})
	} else {
		crList, err2 = dynamicClient.Resource(gvr).List(c.Request.Context(), metav1.ListOptions{})
	}

	if err2 != nil {
		h.logger.WithError(err2).Error("Failed to list custom resources")
		c.JSON(http.StatusInternalServerError, gin.H{"error": err2.Error()})
		return
	}

	// Return only the items array for non-SSE list requests (UI containers expect array)
	if ul, ok := crList.(interface{ UnstructuredContent() map[string]interface{} }); ok {
		content := ul.UnstructuredContent()
		if items, exists := content["items"].([]interface{}); exists {
			c.JSON(http.StatusOK, items)
			return
		}
	}
	c.JSON(http.StatusOK, crList)
}

// GetCustomResourcesSSE returns custom resources as Server-Sent Events
func (h *CustomResourcesHandler) GetCustomResourcesSSE(c *gin.Context) {
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resources SSE")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Query("namespace")

	if group == "" || version == "" || resource == "" {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "group, version, and resource parameters are required")
		return
	}

	gvr := schema.GroupVersionResource{
		Group:    group,
		Version:  version,
		Resource: resource,
	}

	// Helper to fetch and shape list response
	fetchList := func() (interface{}, error) {
		var listObj interface{}
		var err2 error
		if namespace != "" {
			listObj, err2 = dynamicClient.Resource(gvr).Namespace(namespace).List(c.Request.Context(), metav1.ListOptions{})
		} else {
			listObj, err2 = dynamicClient.Resource(gvr).List(c.Request.Context(), metav1.ListOptions{})
		}
		if err2 != nil {
			return nil, err2
		}

		// Extract items array
		var items []interface{}
		if ul, ok := listObj.(interface{ UnstructuredContent() map[string]interface{} }); ok {
			if rawItems, exists := ul.UnstructuredContent()["items"].([]interface{}); exists {
				items = rawItems
			}
		}

		// Best-effort: derive additional printer columns from CRD
		apc, _ := h.getAdditionalPrinterColumns(c, dynamicClient, group, resource, version)

		return gin.H{
			"additionalPrinterColumns": apc,
			"list":                     items,
		}, nil
	}

	// Get initial data
	initialData, err := fetchList()
	if err != nil {
		h.logger.WithError(err).Error("Failed to list custom resources for SSE")
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
		h.sseHandler.SendSSEResponseWithUpdates(c, initialData, fetchList)
		return
	}

	// For non-SSE requests, return JSON
	c.JSON(http.StatusOK, initialData)
}

// GetCustomResource returns a specific custom resource
func (h *CustomResourcesHandler) GetCustomResource(c *gin.Context) {
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resource")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Param("namespace")
	name := c.Param("name")

	if group == "" || version == "" || resource == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group, version, and resource parameters are required"})
		return
	}

	gvr := schema.GroupVersionResource{
		Group:    group,
		Version:  version,
		Resource: resource,
	}

	var cr interface{}
	var err2 error

	if namespace != "" {
		cr, err2 = dynamicClient.Resource(gvr).Namespace(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	} else {
		cr, err2 = dynamicClient.Resource(gvr).Get(c.Request.Context(), name, metav1.GetOptions{})
	}

	if err2 != nil {
		h.logger.WithError(err2).WithField("custom_resource", name).Error("Failed to get custom resource")
		c.JSON(http.StatusNotFound, gin.H{"error": err2.Error()})
		return
	}

	// Check if this is an SSE request (EventSource expects SSE format)
	acceptHeader := c.GetHeader("Accept")
	if acceptHeader == "text/event-stream" {
		h.sseHandler.SendSSEResponse(c, cr)
		return
	}

	c.JSON(http.StatusOK, cr)
}

// GetCustomResourceYAML returns the YAML for a specific custom resource (namespaced path)
func (h *CustomResourcesHandler) GetCustomResourceYAML(c *gin.Context) {
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resource YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Param("namespace")
	name := c.Param("name")

	if group == "" || version == "" || resource == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group, version, and resource parameters are required"})
		return
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}

	obj, err2 := dynamicClient.Resource(gvr).Namespace(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err2 != nil {
		h.logger.WithError(err2).WithField("custom_resource", name).Error("Failed to get custom resource for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err2.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, obj, name)
}

// GetCustomResourceYAMLByName returns the YAML for a specific custom resource (cluster-scoped path with optional namespace via query)
func (h *CustomResourcesHandler) GetCustomResourceYAMLByName(c *gin.Context) {
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resource YAML")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Query("namespace")
	name := c.Param("name")

	if group == "" || version == "" || resource == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "group, version, and resource parameters are required"})
		return
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}

	var obj interface{}
	var err2 error
	if namespace != "" {
		obj, err2 = dynamicClient.Resource(gvr).Namespace(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	} else {
		obj, err2 = dynamicClient.Resource(gvr).Get(c.Request.Context(), name, metav1.GetOptions{})
	}
	if err2 != nil {
		h.logger.WithError(err2).WithField("custom_resource", name).Error("Failed to get custom resource for YAML")
		c.JSON(http.StatusNotFound, gin.H{"error": err2.Error()})
		return
	}

	h.yamlHandler.SendYAMLResponse(c, obj, name)
}

// GetCustomResourceEvents returns events for a specific custom resource (namespaced path)
func (h *CustomResourcesHandler) GetCustomResourceEvents(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for custom resource events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resource events")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Param("namespace")
	name := c.Param("name")

	if group == "" || version == "" || resource == "" {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "group, version, and resource parameters are required")
		return
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}

	// Fetch the CR to determine its Kind for event filtering
	obj, err2 := dynamicClient.Resource(gvr).Namespace(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	if err2 != nil {
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err2.Error())
		return
	}

	u := obj
	kind := u.GetKind()
	if kind == "" {
		if k, ok2 := u.Object["kind"].(string); ok2 {
			kind = k
		}
	}

	h.eventsHandler.GetResourceEventsWithNamespace(c, client, kind, name, namespace, h.sseHandler.SendSSEResponse)
}

// GetCustomResourceEventsByName returns events for a specific custom resource (cluster-scoped path, optional namespace via query)
func (h *CustomResourcesHandler) GetCustomResourceEventsByName(c *gin.Context) {
	client, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get client for custom resource events")
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for custom resource events")
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}

	group := c.Query("group")
	version := c.Query("version")
	resource := c.Query("resource")
	namespace := c.Query("namespace")
	name := c.Param("name")

	if group == "" || version == "" || resource == "" {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, "group, version, and resource parameters are required")
		return
	}

	gvr := schema.GroupVersionResource{Group: group, Version: version, Resource: resource}

	// Fetch the CR to determine its Kind for event filtering
	var obj interface{}
	var err2 error
	if namespace != "" {
		obj, err2 = dynamicClient.Resource(gvr).Namespace(namespace).Get(c.Request.Context(), name, metav1.GetOptions{})
	} else {
		obj, err2 = dynamicClient.Resource(gvr).Get(c.Request.Context(), name, metav1.GetOptions{})
	}
	if err2 != nil {
		h.sseHandler.SendSSEError(c, http.StatusNotFound, err2.Error())
		return
	}

	var kind string
	if u, ok := obj.(*unstructured.Unstructured); ok {
		kind = u.GetKind()
		if kind == "" {
			if k, ok2 := u.Object["kind"].(string); ok2 {
				kind = k
			}
		}
	}
	if namespace != "" {
		h.eventsHandler.GetResourceEventsWithNamespace(c, client, kind, name, namespace, h.sseHandler.SendSSEResponse)
	} else {
		h.eventsHandler.GetResourceEvents(c, client, kind, name, h.sseHandler.SendSSEResponse)
	}
}

// getAdditionalPrinterColumns fetches additional printer columns for a CRD
func (h *CustomResourcesHandler) getAdditionalPrinterColumns(c *gin.Context, dc dynamic.Interface, group, resource, version string) ([]transformers.AdditionalPrinterColumn, error) {
	crdGVR := schema.GroupVersionResource{Group: "apiextensions.k8s.io", Version: "v1", Resource: "customresourcedefinitions"}
	crdName := fmt.Sprintf("%s.%s", resource, group)
	crd, err := dc.Resource(crdGVR).Get(c.Request.Context(), crdName, metav1.GetOptions{})
	if err != nil {
		return []transformers.AdditionalPrinterColumn{}, err
	}
	content := crd.UnstructuredContent()
	spec, _ := content["spec"].(map[string]interface{})
	cols := []transformers.AdditionalPrinterColumn{}

	// Try spec.additionalPrinterColumns first
	if apc, exists := spec["additionalPrinterColumns"].([]interface{}); exists {
		for _, col := range apc {
			if m, ok := col.(map[string]interface{}); ok {
				name, _ := m["name"].(string)
				jp, _ := m["jsonPath"].(string)
				cols = append(cols, transformers.AdditionalPrinterColumn{Name: name, JSONPath: jp})
			}
		}
		return cols, nil
	}

	// Fallback: spec.versions[x].additionalPrinterColumns
	if versions, ok := spec["versions"].([]interface{}); ok {
		// Prefer matching version
		for _, v := range versions {
			if vm, ok := v.(map[string]interface{}); ok {
				vname, _ := vm["name"].(string)
				if vname == version {
					if apc, ok2 := vm["additionalPrinterColumns"].([]interface{}); ok2 {
						for _, col := range apc {
							if m, ok := col.(map[string]interface{}); ok {
								name, _ := m["name"].(string)
								jp, _ := m["jsonPath"].(string)
								cols = append(cols, transformers.AdditionalPrinterColumn{Name: name, JSONPath: jp})
							}
						}
						return cols, nil
					}
				}
			}
		}
		// Otherwise take first version columns
		if len(versions) > 0 {
			if vm, ok := versions[0].(map[string]interface{}); ok {
				if apc, ok2 := vm["additionalPrinterColumns"].([]interface{}); ok2 {
					for _, col := range apc {
						if m, ok := col.(map[string]interface{}); ok {
							name, _ := m["name"].(string)
							jp, _ := m["jsonPath"].(string)
							cols = append(cols, transformers.AdditionalPrinterColumn{Name: name, JSONPath: jp})
						}
					}
				}
			}
		}
	}
	return cols, nil
}
