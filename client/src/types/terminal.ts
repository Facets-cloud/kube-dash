/**
 * Terminal Types
 * Defines the types for the terminal feature, including WebSocket messages,
 * connection status, and terminal options.
 */

// Connection status for terminal WebSocket
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// Message types from backend
export type ServerMessageType = 'stdout' | 'stderr' | 'error' | 'status' | 'resize' | 'pong';

// Message types to backend
export type ClientMessageType = 'input' | 'resize' | 'ping';

// Server message structure (from backend)
export interface ServerMessage {
  type: ServerMessageType;
  data?: string;
  error?: string;
  status?: StatusPayload;
  resize?: ResizeDimensions;
}

// Client message structure (to backend)
export interface ClientMessage {
  type: ClientMessageType;
  data?: string;
  input?: string;  // Legacy field for backward compatibility
  resize?: ResizeDimensions;
}

// Status payload from backend
export interface StatusPayload {
  status: ConnectionStatus;
  message?: string;
  pod?: string;
  namespace?: string;
  container?: string;
}

// Terminal resize dimensions
export interface ResizeDimensions {
  cols: number;
  rows: number;
}

// Terminal options for initialization
export interface TerminalOptions {
  // Initial dimensions
  initialCols?: number;
  initialRows?: number;

  // Font settings
  fontSize?: number;
  fontFamily?: string;

  // Feature toggles
  enableWebGL?: boolean;
  allowFullscreen?: boolean;
  allowSearch?: boolean;

  // Scrollback buffer
  scrollback?: number;

  // Callbacks
  onData?: (data: string) => void;
  onResize?: (dimensions: ResizeDimensions) => void;
  onTitleChange?: (title: string) => void;
}

// Default terminal options
export const DEFAULT_TERMINAL_OPTIONS: Required<Omit<TerminalOptions, 'onData' | 'onResize' | 'onTitleChange'>> = {
  initialCols: 120,
  initialRows: 30,
  fontSize: 13,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  enableWebGL: true,
  allowFullscreen: true,
  allowSearch: true,
  scrollback: 50000,
};

// WebSocket connection options
export interface WebSocketOptions {
  // Connection parameters
  namespace: string;
  podName: string;
  configId: string;
  cluster?: string;
  container?: string;
  command?: string;

  // Reconnection settings
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;

  // Callbacks
  onMessage?: (message: ServerMessage) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
}

// Default WebSocket options
export const DEFAULT_WEBSOCKET_OPTIONS: Pick<WebSocketOptions, 'reconnect' | 'maxReconnectAttempts' | 'reconnectInterval' | 'command'> = {
  reconnect: true,
  maxReconnectAttempts: 3,
  reconnectInterval: 1000,
  command: '/bin/sh',
};

// Terminal theme colors
export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground?: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// Terminal exec parameters
export interface ExecParams {
  namespace: string;
  podName: string;
  container?: string;
  command?: string;
  configId: string;
  cluster?: string;
}

// CloudShell exec parameters
export interface CloudShellParams {
  namespace: string;
  podName: string;
  configId: string;
  cluster?: string;
}

// Terminal session info
export interface TerminalSession {
  id: string;
  namespace: string;
  podName: string;
  container?: string;
  status: ConnectionStatus;
  createdAt: Date;
}

// Build WebSocket URL for terminal exec
export function buildExecWebSocketUrl(params: ExecParams): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = `${protocol}//${window.location.host}/api/v1/terminal/exec/${params.namespace}/${params.podName}/ws`;

  const queryParams = new URLSearchParams();
  queryParams.set('config', params.configId);

  if (params.cluster) {
    queryParams.set('cluster', params.cluster);
  }
  if (params.container) {
    queryParams.set('container', params.container);
  }
  if (params.command) {
    queryParams.set('command', params.command);
  }

  return `${baseUrl}?${queryParams.toString()}`;
}

// Build WebSocket URL for cloudshell exec
export function buildCloudShellWebSocketUrl(params: CloudShellParams): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = `${protocol}//${window.location.host}/api/v1/terminal/cloudshell/${params.namespace}/${params.podName}/ws`;

  const queryParams = new URLSearchParams();
  queryParams.set('config', params.configId);

  if (params.cluster) {
    queryParams.set('cluster', params.cluster);
  }

  return `${baseUrl}?${queryParams.toString()}`;
}

// Create an input message for the terminal
export function createInputMessage(data: string): ClientMessage {
  return {
    type: 'input',
    data,
  };
}

// Create a resize message for the terminal
export function createResizeMessage(cols: number, rows: number): ClientMessage {
  return {
    type: 'resize',
    resize: { cols, rows },
  };
}

// Parse a server message from JSON
export function parseServerMessage(data: string): ServerMessage | null {
  try {
    return JSON.parse(data) as ServerMessage;
  } catch {
    console.error('Failed to parse server message:', data);
    return null;
  }
}
