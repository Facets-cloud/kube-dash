package terminal

import (
	"encoding/json"
	"fmt"
)

// K8s WebSocket channel constants (v5.channel.k8s.io protocol)
// Each channel is identified by a single byte prefix in binary WebSocket messages
const (
	// ChannelStdIn is the channel for stdin (client → K8s)
	ChannelStdIn = 0
	// ChannelStdOut is the channel for stdout (K8s → client)
	ChannelStdOut = 1
	// ChannelStdErr is the channel for stderr (K8s → client)
	ChannelStdErr = 2
	// ChannelError is the channel for error messages (K8s → client, JSON status)
	ChannelError = 3
	// ChannelResize is the channel for terminal resize (client → K8s)
	ChannelResize = 4
)

// K8s WebSocket subprotocols
const (
	// SubprotocolV5 is the modern K8s WebSocket subprotocol (K8s 1.29+)
	SubprotocolV5 = "v5.channel.k8s.io"
	// SubprotocolV4 is the older K8s WebSocket subprotocol
	SubprotocolV4 = "v4.channel.k8s.io"
)

// ConnectionStatus represents the current state of the terminal connection
type ConnectionStatus string

const (
	StatusConnecting   ConnectionStatus = "connecting"
	StatusConnected    ConnectionStatus = "connected"
	StatusDisconnected ConnectionStatus = "disconnected"
	StatusError        ConnectionStatus = "error"
)

// ClientMessage represents a message from the frontend client (JSON format)
type ClientMessage struct {
	Type   string         `json:"type"`            // "input", "resize", "ping"
	Data   string         `json:"data,omitempty"`  // Input data for stdin
	Input  string         `json:"input,omitempty"` // Alternative input field (backward compat)
	Resize *ResizeDimensions `json:"resize,omitempty"`
}

// ServerMessage represents a message sent to the frontend client (JSON format)
type ServerMessage struct {
	Type   string           `json:"type"`            // "stdout", "stderr", "error", "status", "resize"
	Data   string           `json:"data,omitempty"`  // Output data
	Error  string           `json:"error,omitempty"` // Error message
	Status *StatusPayload   `json:"status,omitempty"`
	Resize *ResizeDimensions `json:"resize,omitempty"`
}

// ResizeDimensions represents terminal dimensions for resize operations
type ResizeDimensions struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// K8sResizeMessage is the JSON format K8s expects for resize on channel 4
type K8sResizeMessage struct {
	Width  uint16 `json:"Width"`
	Height uint16 `json:"Height"`
}

// StatusPayload contains connection status information
type StatusPayload struct {
	Status    ConnectionStatus `json:"status"`
	Message   string          `json:"message,omitempty"`
	Pod       string          `json:"pod,omitempty"`
	Namespace string          `json:"namespace,omitempty"`
	Container string          `json:"container,omitempty"`
}

// K8sErrorStatus represents the error status from K8s error channel
type K8sErrorStatus struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Code    int    `json:"code,omitempty"`
}

// TerminalConfig holds configuration for a terminal session
type TerminalConfig struct {
	Namespace    string
	PodName      string
	Container    string
	Command      []string
	TTY          bool
	Stdin        bool
	Stdout       bool
	Stderr       bool
	InitialCols  uint16
	InitialRows  uint16
}

// DefaultTerminalConfig returns a config with sensible defaults
func DefaultTerminalConfig() *TerminalConfig {
	return &TerminalConfig{
		Command:     []string{"/bin/sh"},
		TTY:         true,
		Stdin:       true,
		Stdout:      true,
		Stderr:      true,
		InitialCols: 120,
		InitialRows: 30,
	}
}

// NewServerMessage creates a new server message
func NewServerMessage(msgType string) *ServerMessage {
	return &ServerMessage{Type: msgType}
}

// WithData adds data to the server message
func (m *ServerMessage) WithData(data string) *ServerMessage {
	m.Data = data
	return m
}

// WithError adds error information to the server message
func (m *ServerMessage) WithError(err string) *ServerMessage {
	m.Type = "error"
	m.Error = err
	return m
}

// WithStatus adds status information to the server message
func (m *ServerMessage) WithStatus(status ConnectionStatus, message string) *ServerMessage {
	m.Type = "status"
	m.Status = &StatusPayload{
		Status:  status,
		Message: message,
	}
	return m
}

// JSON marshals the server message to JSON bytes
func (m *ServerMessage) JSON() ([]byte, error) {
	return json.Marshal(m)
}

// ParseClientMessage parses a JSON message from the client
func ParseClientMessage(data []byte) (*ClientMessage, error) {
	var msg ClientMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, fmt.Errorf("failed to parse client message: %w", err)
	}

	// Handle backward compatibility - if input is in "input" field instead of "data"
	if msg.Data == "" && msg.Input != "" {
		msg.Data = msg.Input
	}

	return &msg, nil
}

// EncodeK8sResize creates a binary message for K8s resize channel
func EncodeK8sResize(cols, rows uint16) ([]byte, error) {
	resizeMsg := K8sResizeMessage{
		Width:  cols,
		Height: rows,
	}

	jsonData, err := json.Marshal(resizeMsg)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal resize message: %w", err)
	}

	// Prepend channel byte
	msg := make([]byte, len(jsonData)+1)
	msg[0] = ChannelResize
	copy(msg[1:], jsonData)

	return msg, nil
}

// EncodeK8sStdin creates a binary message for K8s stdin channel
func EncodeK8sStdin(data []byte) []byte {
	msg := make([]byte, len(data)+1)
	msg[0] = ChannelStdIn
	copy(msg[1:], data)
	return msg
}

// ParseK8sChannelMessage parses a binary K8s channel message
// Returns: channel number, data, error
func ParseK8sChannelMessage(data []byte) (byte, []byte, error) {
	if len(data) == 0 {
		return 0, nil, fmt.Errorf("empty message")
	}

	channel := data[0]
	if channel > ChannelResize {
		return 0, nil, fmt.Errorf("invalid channel: %d", channel)
	}

	// Data is everything after the channel byte
	var payload []byte
	if len(data) > 1 {
		payload = data[1:]
	}

	return channel, payload, nil
}

// ChannelName returns a human-readable name for a K8s channel
func ChannelName(channel byte) string {
	switch channel {
	case ChannelStdIn:
		return "stdin"
	case ChannelStdOut:
		return "stdout"
	case ChannelStdErr:
		return "stderr"
	case ChannelError:
		return "error"
	case ChannelResize:
		return "resize"
	default:
		return fmt.Sprintf("unknown(%d)", channel)
	}
}
