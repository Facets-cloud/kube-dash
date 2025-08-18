package websockets

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/internal/tracing"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// PodLogsHandler handles WebSocket-based pod logs streaming
type PodLogsHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	upgrader      websocket.Upgrader
	tracingHelper *tracing.TracingHelper
}

// LogMessage represents a single log entry
type LogMessage struct {
	Type          string    `json:"type"`
	Timestamp     time.Time `json:"timestamp"`
	Message       string    `json:"message"`
	Container     string    `json:"container"`
	Level         string    `json:"level,omitempty"`
	LineNumber    int       `json:"lineNumber"`
	RawTimestamp  string    `json:"rawTimestamp,omitempty"`
}

// ControlMessage represents control messages for the WebSocket connection
type ControlMessage struct {
	Type      string                 `json:"type"`
	Action    string                 `json:"action,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Timestamp time.Time              `json:"timestamp"`
}

// NewPodLogsHandler creates a new PodLogsHandler
func NewPodLogsHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *PodLogsHandler {
	return &PodLogsHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for now
			},
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
		},
		tracingHelper: tracing.GetTracingHelper(),
	}
}

// getClientAndConfig gets the Kubernetes client and config for the given config ID and cluster
func (h *PodLogsHandler) getClientAndConfig(c *gin.Context) (*kubernetes.Clientset, *rest.Config, error) {
	configID := c.Query("config")
	cluster := c.Query("cluster")

	if configID == "" {
		return nil, nil, fmt.Errorf("config parameter is required")
	}

	if cluster == "" {
		return nil, nil, fmt.Errorf("cluster parameter is required")
	}

	// Get the kubeconfig from the store
	kubeConfig, err := h.store.GetKubeConfig(configID)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to get kubeconfig: %v", err)
	}

	// Create the Kubernetes client
	client, err := h.clientFactory.GetClientForConfig(kubeConfig, cluster)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create Kubernetes client: %v", err)
	}

	// Create rest config for this cluster
	configCopy := kubeConfig.DeepCopy()
	for contextName, context := range configCopy.Contexts {
		if context.Cluster == cluster {
			configCopy.CurrentContext = contextName
			break
		}
	}

	clientConfig := clientcmd.NewDefaultClientConfig(*configCopy, &clientcmd.ConfigOverrides{})
	restConfig, err := clientConfig.ClientConfig()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to create rest config: %v", err)
	}

	return client, restConfig, nil
}

// sendWebSocketMessage sends a message to the WebSocket connection
func (h *PodLogsHandler) sendWebSocketMessage(conn *websocket.Conn, message interface{}) error {
	return conn.WriteJSON(message)
}

// sendWebSocketError sends an error message to the WebSocket connection
func (h *PodLogsHandler) sendWebSocketError(conn *websocket.Conn, errorMsg string) {
	errorMessage := ControlMessage{
		Type:      "error",
		Data:      map[string]interface{}{"message": errorMsg},
		Timestamp: time.Now(),
	}
	h.sendWebSocketMessage(conn, errorMessage)
}

// extractTimestamp extracts timestamp from log line using common patterns
func (h *PodLogsHandler) extractTimestamp(logLine string) (time.Time, string) {
	// Common timestamp patterns in Kubernetes logs
	patterns := []struct {
		regex  *regexp.Regexp
		format string
	}{
		// ISO 8601 with nanoseconds
		{regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)`), time.RFC3339Nano},
		// ISO 8601 with timezone
		{regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2})`), time.RFC3339},
		// ISO 8601 basic
		{regexp.MustCompile(`^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)`), time.RFC3339},
		// Standard log format
		{regexp.MustCompile(`^(\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2})`), "2006/01/02 15:04:05"},
		// Alternative format
		{regexp.MustCompile(`^(\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2})`), "01/02/2006 15:04:05"},
		// Time only
		{regexp.MustCompile(`^(\d{2}:\d{2}:\d{2})`), "15:04:05"},
	}

	for _, pattern := range patterns {
		if match := pattern.regex.FindStringSubmatch(logLine); len(match) > 1 {
			timestampStr := match[1]
			if parsedTime, err := time.Parse(pattern.format, timestampStr); err == nil {
				return parsedTime, timestampStr
			}
		}
	}

	// Return current time if no timestamp found
	return time.Now(), ""
}

// detectLogLevel detects log level from log message
func (h *PodLogsHandler) detectLogLevel(logLine string) string {
	logLower := strings.ToLower(logLine)
	
	// Check for common log level indicators
	if strings.Contains(logLower, "error") || strings.Contains(logLower, "err") || strings.Contains(logLower, "fatal") {
		return "error"
	}
	if strings.Contains(logLower, "warn") || strings.Contains(logLower, "warning") {
		return "warn"
	}
	if strings.Contains(logLower, "info") {
		return "info"
	}
	if strings.Contains(logLower, "debug") || strings.Contains(logLower, "trace") {
		return "debug"
	}
	
	return "info" // default
}

// HandlePodLogs handles WebSocket-based pod logs streaming
func (h *PodLogsHandler) HandlePodLogs(c *gin.Context) {
	// Start main span for pod logs operation
	ctx, span := h.tracingHelper.StartAuthSpan(c.Request.Context(), "websocket.pod_logs")
	defer span.End()

	// Add resource attributes
	podName := c.Param("name")
	namespace := c.Param("namespace")
	h.tracingHelper.AddResourceAttributes(span, podName, "pod", 1)

	// Child span for WebSocket connection setup
	connCtx, connSpan := h.tracingHelper.StartKubernetesAPISpan(ctx, "connection_setup", "websocket", namespace)
	// Upgrade HTTP connection to WebSocket
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		h.logger.WithError(err).Error("Failed to upgrade connection to WebSocket")
		h.tracingHelper.RecordError(connSpan, err, "Failed to upgrade WebSocket connection")
		connSpan.End()
		h.tracingHelper.RecordError(span, err, "Pod logs operation failed")
		return
	}
	defer conn.Close()
	h.tracingHelper.RecordSuccess(connSpan, "WebSocket connection established")
	connSpan.End()

	// Get parameters
	container := c.Query("container")
	allContainers := c.Query("all-containers") == "true"

	// Parse tail lines parameter
	tailLinesStr := c.Query("tail-lines")
	tailLines := int64(100) // Default to 100 lines
	if tailLinesStr != "" {
		if parsed, err := strconv.ParseInt(tailLinesStr, 10, 64); err == nil && parsed > 0 {
			tailLines = parsed
		}
	}

	// Parse since time parameter
	sinceTimeStr := c.Query("since-time")
	var sinceTime *time.Time
	if sinceTimeStr != "" {
		if parsed, err := time.Parse(time.RFC3339, sinceTimeStr); err == nil {
			sinceTime = &parsed
		}
	}

	// Child span for client acquisition
	clientCtx, clientSpan := h.tracingHelper.StartAuthSpan(connCtx, "client_acquisition")
	// Get Kubernetes client and config
	client, _, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get Kubernetes client for pod logs")
		h.sendWebSocketError(conn, err.Error())
		h.tracingHelper.RecordError(clientSpan, err, "Failed to get Kubernetes client")
		clientSpan.End()
		h.tracingHelper.RecordError(span, err, "Pod logs operation failed")
		return
	}
	h.tracingHelper.RecordSuccess(clientSpan, "Kubernetes client acquired")
	clientSpan.End()

	// Child span for pod validation
	validationCtx, validationSpan := h.tracingHelper.StartKubernetesAPISpan(clientCtx, "pod_validation", "pod", namespace)
	// Verify pod exists
	pod, err := client.CoreV1().Pods(namespace).Get(c.Request.Context(), podName, metav1.GetOptions{})
	if err != nil {
		h.logger.WithError(err).WithField("pod", podName).WithField("namespace", namespace).Error("Failed to get pod for logs")
		h.sendWebSocketError(conn, fmt.Sprintf("Pod not found: %v", err))
		h.tracingHelper.RecordError(validationSpan, err, "Failed to get pod")
		validationSpan.End()
		h.tracingHelper.RecordError(span, err, "Pod logs operation failed")
		return
	}
	h.tracingHelper.RecordSuccess(validationSpan, "Pod validation completed")
	validationSpan.End()

	// Send connection established message
	connectionMsg := ControlMessage{
		Type: "connected",
		Data: map[string]interface{}{
			"pod":       podName,
			"namespace": namespace,
			"message":   "Connected to pod logs stream",
		},
		Timestamp: time.Now(),
	}
	h.sendWebSocketMessage(conn, connectionMsg)

	// Child span for log streaming operations
	streamCtx, streamSpan := h.tracingHelper.StartKubernetesAPISpan(validationCtx, "log_streaming", "pod", namespace)
	defer func() {
		h.tracingHelper.RecordSuccess(streamSpan, "Log streaming completed")
		streamSpan.End()
		h.tracingHelper.RecordSuccess(span, "Pod logs operation completed")
	}()

	// Create context for cancellation
	streamingCtx, cancel := context.WithCancel(streamCtx)
	defer cancel()

	// Handle WebSocket messages from client (for pause/resume, etc.)
	go func() {
		for {
			select {
			case <-streamingCtx.Done():
				return
			default:
				_, message, err := conn.ReadMessage()
				if err != nil {
					if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
						h.logger.WithError(err).Debug("WebSocket read error")
					}
					cancel()
					return
				}

				// Handle control messages from client
				var controlMsg map[string]interface{}
				if err := json.Unmarshal(message, &controlMsg); err == nil {
					if msgType, ok := controlMsg["type"].(string); ok {
						switch msgType {
						case "ping":
							// Respond to ping with pong
							pongMsg := ControlMessage{
								Type:      "pong",
								Timestamp: time.Now(),
							}
							h.sendWebSocketMessage(conn, pongMsg)
						case "close":
							// Client requested close
							cancel()
							return
						}
					}
				}
			}
		}
	}()

	// Function to stream logs for a specific container
	streamContainerLogs := func(containerName string) error {
		// Build pod log options
		podLogOptions := &v1.PodLogOptions{
			Container: containerName,
			Follow:    true,
			TailLines: &tailLines,
		}

		// Add timestamp filtering if specified
		if sinceTime != nil {
			podLogOptions.SinceTime = &metav1.Time{Time: *sinceTime}
		}

		req := client.CoreV1().Pods(namespace).GetLogs(podName, podLogOptions)
		stream, err := req.Stream(streamingCtx)
		if err != nil {
			h.logger.WithError(err).WithField("container", containerName).Error("Failed to get log stream")
			return err
		}
		defer stream.Close()

		// Send container start message
		containerMsg := ControlMessage{
			Type: "container_start",
			Data: map[string]interface{}{
				"container": containerName,
			},
			Timestamp: time.Now(),
		}
		h.sendWebSocketMessage(conn, containerMsg)

		scanner := bufio.NewScanner(stream)
		lineNumber := 1

		for scanner.Scan() {
			select {
			case <-streamingCtx.Done():
				return streamingCtx.Err()
			default:
				logLine := scanner.Text()
				if logLine == "" {
					continue
				}

				// Extract timestamp and detect log level
				timestamp, rawTimestamp := h.extractTimestamp(logLine)
				level := h.detectLogLevel(logLine)

				// Create log message
				logMsg := LogMessage{
					Type:         "log",
					Timestamp:    timestamp,
					Message:      logLine,
					Container:    containerName,
					Level:        level,
					LineNumber:   lineNumber,
					RawTimestamp: rawTimestamp,
				}

				// Send log message immediately
				if err := h.sendWebSocketMessage(conn, logMsg); err != nil {
					h.logger.WithError(err).Debug("Failed to send log message")
					return err
				}

				lineNumber++
			}
		}

		if err := scanner.Err(); err != nil {
			h.logger.WithError(err).WithField("container", containerName).Error("Error reading log stream")
			return err
		}

		return nil
	}

	// Stream logs for all containers or specific container
	if allContainers {
		// Stream logs from all containers concurrently
		for _, containerSpec := range pod.Spec.Containers {
			go func(containerName string) {
				if err := streamContainerLogs(containerName); err != nil {
					if streamingCtx.Err() == nil { // Only log if not cancelled
					h.logger.WithError(err).WithField("container", containerName).Error("Error streaming container logs")
				}
				}
			}(containerSpec.Name)
		}
	} else if container != "" {
		// Stream logs from specific container
		if err := streamContainerLogs(container); err != nil {
			if streamingCtx.Err() == nil { // Only log if not cancelled
				h.logger.WithError(err).WithField("container", container).Error("Error streaming container logs")
			}
		}
	} else {
		// Default to first container
		if len(pod.Spec.Containers) > 0 {
			if err := streamContainerLogs(pod.Spec.Containers[0].Name); err != nil {
				if streamingCtx.Err() == nil { // Only log if not cancelled
					h.logger.WithError(err).WithField("container", pod.Spec.Containers[0].Name).Error("Error streaming container logs")
				}
			}
		}
	}

	// Wait for context cancellation
	<-streamingCtx.Done()

	// Send disconnection message
	disconnectMsg := ControlMessage{
		Type: "disconnected",
		Data: map[string]interface{}{
			"message": "Log stream disconnected",
		},
		Timestamp: time.Now(),
	}
	h.sendWebSocketMessage(conn, disconnectMsg)
}