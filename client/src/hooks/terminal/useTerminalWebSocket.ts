import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionStatus,
  ServerMessage,
  createInputMessage,
  createResizeMessage,
  parseServerMessage,
  DEFAULT_WEBSOCKET_OPTIONS,
} from '@/types/terminal';

interface UseTerminalWebSocketOptions {
  // WebSocket URL to connect to
  url: string | null;

  // Reconnection settings
  reconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;

  // Callbacks
  onMessage?: (message: ServerMessage) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
  onError?: (error: string) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

interface UseTerminalWebSocketReturn {
  // Connection state
  status: ConnectionStatus;
  isConnected: boolean;
  error: string | null;

  // Methods
  connect: () => void;
  disconnect: () => void;
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;

  // WebSocket reference for advanced use
  wsRef: React.RefObject<WebSocket | null>;
}

/**
 * Hook for managing terminal WebSocket connections
 * Handles connection lifecycle, reconnection, and message handling
 */
export function useTerminalWebSocket(
  options: UseTerminalWebSocketOptions
): UseTerminalWebSocketReturn {
  const {
    url,
    reconnect = DEFAULT_WEBSOCKET_OPTIONS.reconnect,
    maxReconnectAttempts = DEFAULT_WEBSOCKET_OPTIONS.maxReconnectAttempts,
    reconnectInterval = DEFAULT_WEBSOCKET_OPTIONS.reconnectInterval,
    onMessage,
    onStatusChange,
    onError,
    onOpen,
    onClose,
  } = options;

  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const intentionalClose = useRef(false);

  // Update status and notify
  const updateStatus = useCallback(
    (newStatus: ConnectionStatus) => {
      setStatus(newStatus);
      onStatusChange?.(newStatus);
    },
    [onStatusChange]
  );

  // Clean up reconnect timeout
  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!url) {
      setError('No WebSocket URL provided');
      updateStatus('error');
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      intentionalClose.current = true;
      wsRef.current.close();
    }

    intentionalClose.current = false;
    setError(null);
    updateStatus('connecting');

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        updateStatus('connected');
        onOpen?.();
      };

      ws.onmessage = (event) => {
        const message = parseServerMessage(event.data);
        if (message) {
          // Handle status messages
          if (message.type === 'status' && message.status) {
            updateStatus(message.status.status);
          }

          // Handle error messages
          if (message.type === 'error' && message.error) {
            setError(message.error);
            onError?.(message.error);
          }

          onMessage?.(message);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        const errorMessage = 'WebSocket connection error';
        setError(errorMessage);
        onError?.(errorMessage);
      };

      ws.onclose = (event) => {
        wsRef.current = null;

        if (intentionalClose.current) {
          updateStatus('disconnected');
          onClose?.();
          return;
        }

        // Attempt reconnection if enabled
        const maxAttempts = maxReconnectAttempts ?? DEFAULT_WEBSOCKET_OPTIONS.maxReconnectAttempts!;
        const interval = reconnectInterval ?? DEFAULT_WEBSOCKET_OPTIONS.reconnectInterval!;

        if (reconnect && reconnectAttempts.current < maxAttempts) {
          reconnectAttempts.current += 1;
          const delay = interval * Math.pow(2, reconnectAttempts.current - 1);

          console.log(
            `WebSocket closed (code: ${event.code}). Reconnecting in ${delay}ms (attempt ${reconnectAttempts.current}/${maxAttempts})`
          );

          updateStatus('connecting');
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else {
          updateStatus('disconnected');
          onClose?.();

          if (reconnectAttempts.current >= maxAttempts) {
            const errorMessage = 'Maximum reconnection attempts reached';
            setError(errorMessage);
            onError?.(errorMessage);
          }
        }
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create WebSocket';
      setError(errorMessage);
      updateStatus('error');
      onError?.(errorMessage);
    }
  }, [
    url,
    reconnect,
    maxReconnectAttempts,
    reconnectInterval,
    updateStatus,
    onMessage,
    onError,
    onOpen,
    onClose,
  ]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    clearReconnectTimeout();
    intentionalClose.current = true;
    reconnectAttempts.current = 0;

    if (wsRef.current) {
      wsRef.current.close(1000, 'User disconnected');
      wsRef.current = null;
    }

    updateStatus('disconnected');
  }, [clearReconnectTimeout, updateStatus]);

  // Send terminal input
  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = createInputMessage(data);
      // console.log('[Terminal] Sending input:', { data, message });
      wsRef.current.send(JSON.stringify(message));
    } else {
      console.warn('[Terminal] Cannot send input - WebSocket not open', wsRef.current?.readyState);
    }
  }, []);

  // Send terminal resize
  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message = createResizeMessage(cols, rows);
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Auto-connect when URL changes
  useEffect(() => {
    if (url) {
      connect();
    }

    return () => {
      clearReconnectTimeout();
      intentionalClose.current = true;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [url]); // Only reconnect when URL changes, not on connect change

  return {
    status,
    isConnected: status === 'connected',
    error,
    connect,
    disconnect,
    sendInput,
    sendResize,
    wsRef,
  };
}

export default useTerminalWebSocket;
