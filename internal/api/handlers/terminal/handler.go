package terminal

import (
	"fmt"
	"net/http"

	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/internal/tracing"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// Handler handles WebSocket-based terminal operations using the K8s v5.channel.k8s.io protocol
type Handler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	upgrader      websocket.Upgrader
	tracingHelper *tracing.TracingHelper
}

// NewHandler creates a new terminal Handler
func NewHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *Handler {
	return &Handler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for now
			},
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
		},
		tracingHelper: tracing.GetTracingHelper(),
	}
}

// getClientAndConfig gets the Kubernetes client and REST config for the given config ID and cluster
func (h *Handler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, *rest.Config, error) {
	configID := c.Query("config")
	cluster := c.Query("cluster")

	if configID == "" {
		return nil, nil, fmt.Errorf("config parameter is required")
	}

	config, err := h.store.GetKubeConfig(configID)
	if err != nil {
		return nil, nil, fmt.Errorf("config not found: %w", err)
	}

	client, err := h.clientFactory.GetClientForConfig(config, cluster)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get Kubernetes client: %w", err)
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
		return nil, nil, fmt.Errorf("failed to create client config: %w", err)
	}

	return client, restConfig, nil
}

// HandleExec handles WebSocket-based pod exec using native K8s WebSocket protocol
// @Summary Execute Commands in Pod via WebSocket (v5 Protocol)
// @Description Execute interactive commands in a pod container via WebSocket using K8s v5.channel.k8s.io protocol
// @Tags Terminal
// @Accept json
// @Produce json
// @Param namespace path string true "Namespace name"
// @Param name path string true "Pod name"
// @Param config query string true "Kubernetes configuration ID"
// @Param cluster query string false "Cluster name"
// @Param container query string false "Container name (defaults to first container)"
// @Param command query string false "Command to execute (default: /bin/sh)"
// @Success 101 {string} string "WebSocket connection established"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "Pod not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/v1/terminal/exec/{namespace}/{name}/ws [get]
// @Security BearerAuth
// @Security KubeConfig
func (h *Handler) HandleExec(c *gin.Context) {
	// Start main span for terminal exec operation
	ctx, span := h.tracingHelper.StartAuthSpan(c.Request.Context(), "terminal.exec")
	defer span.End()

	podName := c.Param("name")
	namespace := c.Param("namespace")
	container := c.Query("container")
	command := c.Query("command")

	h.tracingHelper.AddResourceAttributes(span, podName, "pod", 1)

	// Default command
	if command == "" {
		command = "/bin/sh"
	}

	h.logger.Info("Terminal exec request",
		"pod", podName,
		"namespace", namespace,
		"container", container,
		"command", command)

	// Child span for WebSocket connection setup
	connCtx, connSpan := h.tracingHelper.StartKubernetesAPISpan(ctx, "connection_setup", "websocket", namespace)

	// Upgrade HTTP connection to WebSocket
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.WithError(err).Error("Failed to upgrade connection to WebSocket")
		h.tracingHelper.RecordError(connSpan, err, "Failed to upgrade WebSocket connection")
		connSpan.End()
		h.tracingHelper.RecordError(span, err, "Terminal exec operation failed")
		return
	}

	h.tracingHelper.RecordSuccess(connSpan, "WebSocket connection established")
	connSpan.End()

	// Child span for client acquisition
	clientCtx, clientSpan := h.tracingHelper.StartAuthSpan(connCtx, "client_acquisition")

	// Get Kubernetes client and config
	client, restConfig, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get Kubernetes client for terminal exec")
		h.sendError(conn, err.Error())
		conn.Close()
		h.tracingHelper.RecordError(clientSpan, err, "Failed to get Kubernetes client")
		clientSpan.End()
		h.tracingHelper.RecordError(span, err, "Terminal exec operation failed")
		return
	}

	h.tracingHelper.RecordSuccess(clientSpan, "Kubernetes client acquired")
	clientSpan.End()

	// Child span for pod validation
	validationCtx, validationSpan := h.tracingHelper.StartKubernetesAPISpan(clientCtx, "pod_validation", "pod", namespace)

	// Validate pod exists and is running
	pod, err := ValidatePod(c.Request.Context(), client, namespace, podName)
	if err != nil {
		h.logger.WithError(err).WithField("pod", podName).WithField("namespace", namespace).Error("Pod validation failed")
		h.sendError(conn, err.Error())
		conn.Close()
		h.tracingHelper.RecordError(validationSpan, err, "Pod validation failed")
		validationSpan.End()
		h.tracingHelper.RecordError(span, err, "Terminal exec operation failed")
		return
	}

	// If no container specified, use the first one
	if container == "" {
		container = GetDefaultContainer(pod)
	}

	h.tracingHelper.RecordSuccess(validationSpan, "Pod validation completed")
	validationSpan.End()

	// Child span for K8s connection setup
	_, k8sSpan := h.tracingHelper.StartKubernetesAPISpan(validationCtx, "k8s_executor_setup", "pod", namespace)

	// Create terminal config
	termConfig := &TerminalConfig{
		Namespace: namespace,
		PodName:   podName,
		Container: container,
		Command:   []string{command},
		TTY:       true,
		Stdin:     true,
		Stdout:    true,
		Stderr:    true,
	}

	// Create K8s executor
	executor := NewK8sExecutor(client, restConfig, termConfig, h.logger)

	// Connect to K8s
	if err := executor.Connect(c.Request.Context()); err != nil {
		h.logger.WithError(err).Error("Failed to connect to K8s exec endpoint")
		h.sendError(conn, fmt.Sprintf("Failed to connect to pod: %v", err))
		conn.Close()
		h.tracingHelper.RecordError(k8sSpan, err, "Failed to connect to K8s")
		k8sSpan.End()
		h.tracingHelper.RecordError(span, err, "Terminal exec operation failed")
		return
	}

	h.tracingHelper.RecordSuccess(k8sSpan, "K8s executor connected")
	k8sSpan.End()

	// Create protocol bridge
	bridge := NewProtocolBridge(conn, executor, h.logger)

	// Send connected status to client
	bridge.SendStatus(StatusConnected, fmt.Sprintf("Connected to %s/%s", namespace, podName))

	// Start the bridge (this blocks until connection closes)
	if err := bridge.Start(); err != nil {
		h.logger.WithError(err).Error("Terminal bridge error")
		h.tracingHelper.RecordError(span, err, "Terminal bridge error")
	} else {
		h.tracingHelper.RecordSuccess(span, "Terminal exec operation completed")
	}
}

// HandleCloudShellExec handles WebSocket-based cloudshell exec
// This is similar to HandleExec but specifically for cloudshell pods
// @Summary Execute Commands in CloudShell Pod via WebSocket (v5 Protocol)
// @Description Execute interactive commands in a cloudshell pod via WebSocket using K8s v5.channel.k8s.io protocol
// @Tags Terminal
// @Accept json
// @Produce json
// @Param namespace path string true "Namespace name"
// @Param name path string true "CloudShell pod name"
// @Param config query string true "Kubernetes configuration ID"
// @Param cluster query string false "Cluster name"
// @Success 101 {string} string "WebSocket connection established"
// @Failure 400 {object} map[string]string "Bad request"
// @Failure 404 {object} map[string]string "CloudShell pod not found"
// @Failure 500 {object} map[string]string "Internal server error"
// @Router /api/v1/terminal/cloudshell/{namespace}/{name}/ws [get]
// @Security BearerAuth
// @Security KubeConfig
func (h *Handler) HandleCloudShellExec(c *gin.Context) {
	// CloudShell uses the same exec logic with different defaults
	// Set command to bash for cloudshell
	if c.Query("command") == "" {
		c.Request.URL.RawQuery = c.Request.URL.RawQuery + "&command=/bin/bash"
	}

	h.HandleExec(c)
}

// sendError sends an error message to the client via WebSocket
func (h *Handler) sendError(conn *websocket.Conn, message string) {
	msg := NewServerMessage("error").WithError(message)
	jsonData, err := msg.JSON()
	if err != nil {
		h.logger.WithError(err).Error("Failed to marshal error message")
		return
	}
	conn.WriteMessage(websocket.TextMessage, jsonData)
}
