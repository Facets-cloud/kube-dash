package terminal

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/Facets-cloud/kube-dash/pkg/logger"
	"github.com/gorilla/websocket"
)

// ProtocolBridge bridges between the client WebSocket (JSON) and K8s WebSocket (binary channels)
// It handles:
// - Translating client JSON messages to K8s binary channel format
// - Translating K8s binary channel messages to client JSON format
// - Connection lifecycle management
// - Write buffering for performance
type ProtocolBridge struct {
	clientConn *websocket.Conn
	executor   *K8sExecutor
	logger     *logger.Logger

	ctx        context.Context
	cancel     context.CancelFunc

	// Write buffer for batching stdout/stderr
	writeBuffer    chan *ServerMessage
	writeMutex     sync.Mutex
	flushInterval  time.Duration
	bufferSize     int

	// Activity tracking
	lastActivity   time.Time
	activityMutex  sync.RWMutex

	closed     bool
	closeMutex sync.RWMutex

	// Optional resize callback for handling resize from client
	onResize func(cols, rows uint16)
}

// NewProtocolBridge creates a new protocol bridge
func NewProtocolBridge(clientConn *websocket.Conn, executor *K8sExecutor, log *logger.Logger) *ProtocolBridge {
	ctx, cancel := context.WithCancel(context.Background())

	bridge := &ProtocolBridge{
		clientConn:    clientConn,
		executor:      executor,
		logger:        log,
		ctx:           ctx,
		cancel:        cancel,
		writeBuffer:   make(chan *ServerMessage, 1000),
		flushInterval: 10 * time.Millisecond,
		bufferSize:    4096,
		lastActivity:  time.Now(),
	}

	// Configure client WebSocket
	clientConn.SetReadLimit(32768)
	clientConn.EnableWriteCompression(true)

	// Set ping/pong handlers
	clientConn.SetPingHandler(func(appData string) error {
		bridge.updateActivity()
		return clientConn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(time.Second))
	})

	clientConn.SetPongHandler(func(appData string) error {
		bridge.updateActivity()
		return nil
	})

	return bridge
}

// SetResizeCallback sets a callback for resize events
func (b *ProtocolBridge) SetResizeCallback(fn func(cols, rows uint16)) {
	b.onResize = fn
}

// Start begins the bidirectional message bridging
func (b *ProtocolBridge) Start() error {
	// Start the write buffer processor
	go b.processWriteBuffer()

	// Start connection health monitor
	go b.monitorConnection()

	// Start K8s → Client message relay
	go b.relayFromK8s()

	// Start Client → K8s message relay (blocking)
	return b.relayFromClient()
}

// relayFromClient reads messages from the client and forwards them to K8s
func (b *ProtocolBridge) relayFromClient() error {
	defer b.Close()

	for {
		select {
		case <-b.ctx.Done():
			return nil
		default:
		}

		// Set read deadline
		b.clientConn.SetReadDeadline(time.Now().Add(60 * time.Second))

		_, message, err := b.clientConn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				b.logger.Debug("Client WebSocket closed normally")
				return nil
			}
			if !b.isClosed() {
				b.logger.Error("Error reading from client WebSocket", "error", err)
			}
			return err
		}

		b.updateActivity()

		// Parse client message
		clientMsg, err := ParseClientMessage(message)
		if err != nil {
			b.logger.Error("Failed to parse client message", "error", err)
			continue
		}

		// Handle message based on type
		if err := b.handleClientMessage(clientMsg); err != nil {
			b.logger.Error("Failed to handle client message", "error", err, "type", clientMsg.Type)
		}
	}
}

// handleClientMessage processes a message from the client
func (b *ProtocolBridge) handleClientMessage(msg *ClientMessage) error {
	b.logger.Debug("Received client message", "type", msg.Type, "dataLen", len(msg.Data))

	switch msg.Type {
	case "input":
		// Forward stdin to K8s
		if msg.Data != "" {
			b.logger.Debug("Sending stdin to K8s", "data", msg.Data, "len", len(msg.Data))
			return b.executor.SendStdin([]byte(msg.Data))
		}
	case "resize":
		// Forward resize to K8s
		if msg.Resize != nil {
			if b.onResize != nil {
				b.onResize(msg.Resize.Cols, msg.Resize.Rows)
			}
			return b.executor.SendResize(msg.Resize.Cols, msg.Resize.Rows)
		}
	case "ping":
		// Respond with pong
		return b.sendToClient(NewServerMessage("pong"))
	default:
		// Try to handle as legacy format (direct input string)
		if msg.Data != "" || msg.Input != "" {
			data := msg.Data
			if data == "" {
				data = msg.Input
			}
			return b.executor.SendStdin([]byte(data))
		}
		b.logger.Debug("Unknown client message type", "type", msg.Type)
	}

	return nil
}

// relayFromK8s reads messages from K8s and forwards them to the client
func (b *ProtocolBridge) relayFromK8s() {
	defer b.Close()

	for {
		select {
		case <-b.ctx.Done():
			return
		case k8sMsg, ok := <-b.executor.FromK8s():
			if !ok {
				// K8s channel closed
				b.logger.Debug("K8s message channel closed")
				return
			}

			if err := b.handleK8sMessage(k8sMsg); err != nil {
				b.logger.Error("Failed to handle K8s message", "error", err, "channel", ChannelName(k8sMsg.Channel))
			}
		}
	}
}

// handleK8sMessage processes a message from K8s and sends it to the client
func (b *ProtocolBridge) handleK8sMessage(msg K8sMessage) error {
	switch msg.Channel {
	case ChannelStdOut:
		// Buffer stdout for performance
		return b.bufferOutput("stdout", msg.Data)

	case ChannelStdErr:
		// Buffer stderr for performance
		return b.bufferOutput("stderr", msg.Data)

	case ChannelError:
		// Parse and forward error status
		var status K8sErrorStatus
		if err := json.Unmarshal(msg.Data, &status); err != nil {
			// Send raw error if parsing fails
			return b.sendToClient(NewServerMessage("error").WithError(string(msg.Data)))
		}

		errorMsg := fmt.Sprintf("%s: %s", status.Reason, status.Message)
		return b.sendToClient(NewServerMessage("error").WithError(errorMsg))

	case ChannelResize:
		// K8s doesn't typically send resize messages, but handle just in case
		b.logger.Debug("Received resize from K8s", "data", string(msg.Data))
		return nil

	default:
		b.logger.Warn("Unknown K8s channel", "channel", msg.Channel)
		return nil
	}
}

// bufferOutput adds output data to the write buffer for batching
func (b *ProtocolBridge) bufferOutput(msgType string, data []byte) error {
	if len(data) == 0 {
		return nil
	}

	msg := NewServerMessage(msgType).WithData(string(data))

	select {
	case b.writeBuffer <- msg:
		return nil
	case <-b.ctx.Done():
		return fmt.Errorf("bridge context cancelled")
	default:
		// Buffer full, send directly
		b.logger.Warn("Write buffer full, sending directly")
		return b.sendToClient(msg)
	}
}

// processWriteBuffer batches and flushes buffered messages
func (b *ProtocolBridge) processWriteBuffer() {
	ticker := time.NewTicker(b.flushInterval)
	defer ticker.Stop()

	var batch []*ServerMessage
	var lastFlush time.Time

	for {
		select {
		case <-b.ctx.Done():
			// Flush remaining messages
			if len(batch) > 0 {
				b.flushBatch(batch)
			}
			return

		case msg := <-b.writeBuffer:
			if b.isClosed() {
				return
			}

			batch = append(batch, msg)

			// Flush if batch is large enough or enough time has passed
			if b.shouldFlush(batch, lastFlush) {
				b.flushBatch(batch)
				batch = batch[:0]
				lastFlush = time.Now()
			}

		case <-ticker.C:
			if len(batch) > 0 {
				b.flushBatch(batch)
				batch = batch[:0]
				lastFlush = time.Now()
			}
		}
	}
}

// shouldFlush determines if the batch should be flushed
func (b *ProtocolBridge) shouldFlush(batch []*ServerMessage, lastFlush time.Time) bool {
	if len(batch) == 0 {
		return false
	}

	// Calculate total data size
	totalSize := 0
	for _, msg := range batch {
		totalSize += len(msg.Data)
	}

	// Flush if buffer is large or enough time has passed
	return totalSize >= b.bufferSize || time.Since(lastFlush) >= b.flushInterval
}

// flushBatch sends a batch of messages to the client
func (b *ProtocolBridge) flushBatch(batch []*ServerMessage) {
	if len(batch) == 0 {
		return
	}

	// Combine messages of the same type
	var stdoutData, stderrData string
	for _, msg := range batch {
		switch msg.Type {
		case "stdout":
			stdoutData += msg.Data
		case "stderr":
			stderrData += msg.Data
		default:
			// Send other message types immediately
			if err := b.sendToClient(msg); err != nil {
				b.logger.Error("Failed to send message to client", "error", err)
			}
		}
	}

	// Send combined stdout
	if stdoutData != "" {
		if err := b.sendToClient(NewServerMessage("stdout").WithData(stdoutData)); err != nil {
			b.logger.Error("Failed to send stdout to client", "error", err)
		}
	}

	// Send combined stderr
	if stderrData != "" {
		if err := b.sendToClient(NewServerMessage("stderr").WithData(stderrData)); err != nil {
			b.logger.Error("Failed to send stderr to client", "error", err)
		}
	}
}

// sendToClient sends a message to the client
func (b *ProtocolBridge) sendToClient(msg *ServerMessage) error {
	if b.isClosed() {
		return fmt.Errorf("bridge is closed")
	}

	jsonData, err := msg.JSON()
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	b.writeMutex.Lock()
	defer b.writeMutex.Unlock()

	if b.isClosed() {
		return fmt.Errorf("bridge is closed")
	}

	b.clientConn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if err := b.clientConn.WriteMessage(websocket.TextMessage, jsonData); err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	b.updateActivity()
	return nil
}

// SendStatus sends a status message to the client
func (b *ProtocolBridge) SendStatus(status ConnectionStatus, message string) error {
	return b.sendToClient(NewServerMessage("status").WithStatus(status, message))
}

// SendError sends an error message to the client
func (b *ProtocolBridge) SendError(message string) error {
	return b.sendToClient(NewServerMessage("error").WithError(message))
}

// updateActivity updates the last activity timestamp
func (b *ProtocolBridge) updateActivity() {
	b.activityMutex.Lock()
	b.lastActivity = time.Now()
	b.activityMutex.Unlock()
}

// monitorConnection monitors the connection health
func (b *ProtocolBridge) monitorConnection() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-b.ctx.Done():
			return
		case <-ticker.C:
			b.activityMutex.RLock()
			lastActivity := b.lastActivity
			b.activityMutex.RUnlock()

			// Send ping if no activity for 30 seconds
			if time.Since(lastActivity) > 30*time.Second {
				b.writeMutex.Lock()
				if !b.isClosed() {
					err := b.clientConn.WriteControl(websocket.PingMessage, []byte("ping"), time.Now().Add(time.Second))
					if err != nil {
						b.logger.Error("Failed to send ping", "error", err)
						b.writeMutex.Unlock()
						return
					}
				}
				b.writeMutex.Unlock()
			}
		}
	}
}

// isClosed checks if the bridge is closed
func (b *ProtocolBridge) isClosed() bool {
	b.closeMutex.RLock()
	defer b.closeMutex.RUnlock()
	return b.closed
}

// Close closes the bridge and cleans up resources
func (b *ProtocolBridge) Close() error {
	b.closeMutex.Lock()
	if b.closed {
		b.closeMutex.Unlock()
		return nil
	}
	b.closed = true
	b.closeMutex.Unlock()

	// Cancel context to stop goroutines
	b.cancel()

	// Close write buffer
	close(b.writeBuffer)

	// Close K8s executor
	if b.executor != nil {
		b.executor.Close()
	}

	// Close client connection
	b.writeMutex.Lock()
	defer b.writeMutex.Unlock()

	if b.clientConn != nil {
		b.clientConn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		return b.clientConn.Close()
	}

	return nil
}
