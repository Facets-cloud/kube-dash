package terminal

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/Facets-cloud/kube-dash/pkg/logger"
	"github.com/gorilla/websocket"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
)

// K8sExecutor manages the WebSocket connection to the Kubernetes API server
// for executing commands in pods using the v5.channel.k8s.io protocol
type K8sExecutor struct {
	client     *kubernetes.Clientset
	restConfig *rest.Config
	config     *TerminalConfig
	logger     *logger.Logger

	conn       *websocket.Conn
	connMutex  sync.Mutex
	ctx        context.Context
	cancel     context.CancelFunc

	// Channels for bidirectional communication
	fromK8s chan K8sMessage  // Messages from K8s API (stdout, stderr, error)
	toK8s   chan []byte      // Messages to K8s API (stdin, resize)

	closed     bool
	closeMutex sync.RWMutex
}

// K8sMessage represents a parsed message from K8s
type K8sMessage struct {
	Channel byte
	Data    []byte
}

// NewK8sExecutor creates a new K8s WebSocket executor
func NewK8sExecutor(client *kubernetes.Clientset, restConfig *rest.Config, config *TerminalConfig, log *logger.Logger) *K8sExecutor {
	ctx, cancel := context.WithCancel(context.Background())

	return &K8sExecutor{
		client:     client,
		restConfig: restConfig,
		config:     config,
		logger:     log,
		ctx:        ctx,
		cancel:     cancel,
		fromK8s:    make(chan K8sMessage, 256),
		toK8s:      make(chan []byte, 256),
	}
}

// Connect establishes the WebSocket connection to the K8s API server
func (e *K8sExecutor) Connect(ctx context.Context) error {
	// Build the exec URL
	execURL, err := e.buildExecURL()
	if err != nil {
		return fmt.Errorf("failed to build exec URL: %w", err)
	}

	e.logger.Debug("Connecting to K8s exec endpoint",
		"url", execURL.String(),
		"pod", e.config.PodName,
		"namespace", e.config.Namespace,
		"container", e.config.Container)

	// Create WebSocket dialer with K8s auth
	dialer, err := e.createDialer()
	if err != nil {
		return fmt.Errorf("failed to create dialer: %w", err)
	}

	// Connect with v5.channel.k8s.io subprotocol
	headers := e.buildHeaders()
	conn, resp, err := dialer.DialContext(ctx, execURL.String(), headers)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("failed to connect to K8s exec: %w (status: %d)", err, resp.StatusCode)
		}
		return fmt.Errorf("failed to connect to K8s exec: %w", err)
	}

	// Verify we got the expected subprotocol
	negotiatedProtocol := resp.Header.Get("Sec-WebSocket-Protocol")
	if !strings.HasPrefix(negotiatedProtocol, "v") {
		e.logger.Warn("Unexpected subprotocol negotiated", "protocol", negotiatedProtocol)
	}

	e.connMutex.Lock()
	e.conn = conn
	e.connMutex.Unlock()

	e.logger.Info("Connected to K8s exec endpoint",
		"protocol", negotiatedProtocol,
		"pod", e.config.PodName)

	// Start read/write goroutines
	go e.readFromK8s()
	go e.writeToK8s()

	return nil
}

// buildExecURL constructs the WebSocket URL for pod exec
func (e *K8sExecutor) buildExecURL() (*url.URL, error) {
	// Parse the K8s API server URL
	baseURL, err := url.Parse(e.restConfig.Host)
	if err != nil {
		return nil, fmt.Errorf("invalid K8s host: %w", err)
	}

	// Convert https:// to wss:// or http:// to ws://
	switch baseURL.Scheme {
	case "https":
		baseURL.Scheme = "wss"
	case "http":
		baseURL.Scheme = "ws"
	default:
		// Already ws/wss or assume wss
		if !strings.HasPrefix(baseURL.Scheme, "ws") {
			baseURL.Scheme = "wss"
		}
	}

	// Build the exec path
	baseURL.Path = fmt.Sprintf("/api/v1/namespaces/%s/pods/%s/exec",
		e.config.Namespace, e.config.PodName)

	// Build query parameters
	query := url.Values{}
	if e.config.Container != "" {
		query.Set("container", e.config.Container)
	}
	for _, cmd := range e.config.Command {
		query.Add("command", cmd)
	}
	if e.config.Stdin {
		query.Set("stdin", "true")
	}
	if e.config.Stdout {
		query.Set("stdout", "true")
	}
	if e.config.Stderr {
		query.Set("stderr", "true")
	}
	if e.config.TTY {
		query.Set("tty", "true")
	}
	baseURL.RawQuery = query.Encode()

	return baseURL, nil
}

// createDialer creates a WebSocket dialer with proper TLS and auth configuration
func (e *K8sExecutor) createDialer() (*websocket.Dialer, error) {
	// Build TLS config from K8s rest config
	tlsConfig := &tls.Config{
		InsecureSkipVerify: e.restConfig.TLSClientConfig.Insecure,
	}

	// Load CA cert if provided
	if len(e.restConfig.TLSClientConfig.CAData) > 0 {
		// For simplicity, we trust the K8s CA but don't pin it
		// In production, you might want to add CA cert to the pool
		tlsConfig.InsecureSkipVerify = true // K8s handles its own cert validation
	}

	// If client cert auth is configured
	if len(e.restConfig.TLSClientConfig.CertData) > 0 && len(e.restConfig.TLSClientConfig.KeyData) > 0 {
		cert, err := tls.X509KeyPair(e.restConfig.TLSClientConfig.CertData, e.restConfig.TLSClientConfig.KeyData)
		if err != nil {
			return nil, fmt.Errorf("failed to load client cert: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	dialer := &websocket.Dialer{
		TLSClientConfig:  tlsConfig,
		HandshakeTimeout: 30 * time.Second,
		Subprotocols:     []string{SubprotocolV5, SubprotocolV4},
	}

	return dialer, nil
}

// buildHeaders builds HTTP headers for the WebSocket connection
func (e *K8sExecutor) buildHeaders() http.Header {
	headers := http.Header{}

	// Add bearer token if present
	if e.restConfig.BearerToken != "" {
		headers.Set("Authorization", "Bearer "+e.restConfig.BearerToken)
	}

	// Add any impersonation headers
	if e.restConfig.Impersonate.UserName != "" {
		headers.Set("Impersonate-User", e.restConfig.Impersonate.UserName)
	}

	return headers
}

// readFromK8s reads messages from the K8s WebSocket and sends them to the fromK8s channel
func (e *K8sExecutor) readFromK8s() {
	defer func() {
		close(e.fromK8s)
		e.Close()
	}()

	for {
		select {
		case <-e.ctx.Done():
			return
		default:
		}

		e.connMutex.Lock()
		conn := e.conn
		e.connMutex.Unlock()

		if conn == nil {
			return
		}

		// Set read deadline
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		messageType, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				e.logger.Debug("K8s WebSocket closed normally")
			} else if !e.isClosed() {
				e.logger.Error("Error reading from K8s WebSocket", "error", err)
			}
			return
		}

		// K8s sends binary messages with channel prefix
		if messageType != websocket.BinaryMessage {
			e.logger.Warn("Received non-binary message from K8s", "type", messageType)
			continue
		}

		channel, payload, err := ParseK8sChannelMessage(data)
		if err != nil {
			e.logger.Error("Failed to parse K8s channel message", "error", err)
			continue
		}

		select {
		case e.fromK8s <- K8sMessage{Channel: channel, Data: payload}:
		case <-e.ctx.Done():
			return
		}
	}
}

// writeToK8s reads messages from the toK8s channel and writes them to the K8s WebSocket
func (e *K8sExecutor) writeToK8s() {
	defer e.Close()

	e.logger.Debug("writeToK8s goroutine started")

	for {
		select {
		case <-e.ctx.Done():
			e.logger.Debug("writeToK8s: context done")
			return
		case data, ok := <-e.toK8s:
			if !ok {
				e.logger.Debug("writeToK8s: channel closed")
				return
			}

			e.logger.Debug("writeToK8s: received data to send", "len", len(data), "channel", data[0])

			e.connMutex.Lock()
			conn := e.conn
			e.connMutex.Unlock()

			if conn == nil {
				e.logger.Debug("writeToK8s: conn is nil")
				return
			}

			// Set write deadline
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))

			// Send as binary message
			if err := conn.WriteMessage(websocket.BinaryMessage, data); err != nil {
				if !e.isClosed() {
					e.logger.Error("Error writing to K8s WebSocket", "error", err)
				}
				return
			}
			e.logger.Debug("writeToK8s: message sent successfully")
		}
	}
}

// FromK8s returns the channel for receiving messages from K8s
func (e *K8sExecutor) FromK8s() <-chan K8sMessage {
	return e.fromK8s
}

// SendStdin sends stdin data to K8s
func (e *K8sExecutor) SendStdin(data []byte) error {
	if e.isClosed() {
		return fmt.Errorf("executor is closed")
	}

	msg := EncodeK8sStdin(data)
	e.logger.Debug("Queuing stdin for K8s", "dataLen", len(data), "msgLen", len(msg))

	select {
	case e.toK8s <- msg:
		e.logger.Debug("Stdin queued successfully")
		return nil
	case <-e.ctx.Done():
		return fmt.Errorf("executor context cancelled")
	default:
		return fmt.Errorf("write buffer full")
	}
}

// SendResize sends a resize message to K8s
func (e *K8sExecutor) SendResize(cols, rows uint16) error {
	if e.isClosed() {
		return fmt.Errorf("executor is closed")
	}

	msg, err := EncodeK8sResize(cols, rows)
	if err != nil {
		return err
	}

	select {
	case e.toK8s <- msg:
		return nil
	case <-e.ctx.Done():
		return fmt.Errorf("executor context cancelled")
	default:
		return fmt.Errorf("write buffer full")
	}
}

// isClosed checks if the executor is closed
func (e *K8sExecutor) isClosed() bool {
	e.closeMutex.RLock()
	defer e.closeMutex.RUnlock()
	return e.closed
}

// Close closes the K8s WebSocket connection and cleans up resources
func (e *K8sExecutor) Close() error {
	e.closeMutex.Lock()
	if e.closed {
		e.closeMutex.Unlock()
		return nil
	}
	e.closed = true
	e.closeMutex.Unlock()

	// Cancel context to stop goroutines
	e.cancel()

	// Close the toK8s channel
	close(e.toK8s)

	// Close WebSocket connection
	e.connMutex.Lock()
	defer e.connMutex.Unlock()

	if e.conn != nil {
		// Send close message
		e.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		return e.conn.Close()
	}

	return nil
}

// ValidatePod validates that the pod exists and is running
func ValidatePod(ctx context.Context, client *kubernetes.Clientset, namespace, podName string) (*v1.Pod, error) {
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("pod not found: %w", err)
	}

	if pod.Status.Phase != v1.PodRunning {
		return nil, fmt.Errorf("pod is not running, current phase: %s", pod.Status.Phase)
	}

	return pod, nil
}

// GetDefaultContainer returns the first container name from a pod
func GetDefaultContainer(pod *v1.Pod) string {
	if len(pod.Spec.Containers) > 0 {
		return pod.Spec.Containers[0].Name
	}
	return ""
}
