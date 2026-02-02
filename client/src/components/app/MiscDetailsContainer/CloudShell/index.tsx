import { useRef, useState, useEffect, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";

import { Terminal, TerminalRef } from "@/components/terminal";
import { useTerminalWebSocket } from "@/hooks/terminal";
import {
  ServerMessage,
  buildCloudShellWebSocketUrl,
  ConnectionStatus,
  ResizeDimensions,
} from "@/types/terminal";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PermissionErrorBanner } from "@/components/app/Common/PermissionErrorBanner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Terminal as TerminalIcon,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp
} from "lucide-react";

import { AppDispatch, RootState } from "@/redux/store";
import {
  createCloudShell,
  deleteCloudShell,
  listCloudShellSessions,
  setCurrentSession,
  clearError
} from "@/data/CloudShell/CloudShellSlice";
import { CloudShellSession } from "@/types/cloudshell";

type CloudShellProps = {
  configName: string;
  clusterName: string;
  namespace?: string;
};

export function CloudShell({ configName, clusterName, namespace = "default" }: CloudShellProps) {
  const dispatch = useDispatch<AppDispatch>();
  const { sessions, currentSession, loading, error, sessionLimit, currentSessionCount } = useSelector((state: RootState) => state.cloudShell);

  const terminalRef = useRef<TerminalRef>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();

  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionMessage, setSessionMessage] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isSessionsCollapsed, setIsSessionsCollapsed] = useState(false);

  // Error handling and backoff state
  const [retryCount, setRetryCount] = useState(0);
  const [lastErrorType, setLastErrorType] = useState<string | null>(null);
  const [isPollingDisabled, setIsPollingDisabled] = useState(false);

  // Check if error is a permission error
  const isPermissionError = useCallback((errorMessage: string): boolean => {
    if (!errorMessage) return false;
    return errorMessage.toLowerCase().includes('permission denied') ||
           errorMessage.toLowerCase().includes('insufficient permissions') ||
           errorMessage.toLowerCase().includes('forbidden') ||
           errorMessage.toLowerCase().includes('cannot create configmaps') ||
           errorMessage.toLowerCase().includes('cannot create pods') ||
           errorMessage.toLowerCase().includes('cannot get pod') ||
           errorMessage.toLowerCase().includes('cannot exec into pod');
  }, []);

  // Check if error is a configuration error (400 errors)
  const isConfigurationError = useCallback((errorMessage: string): boolean => {
    if (!errorMessage) return false;
    return errorMessage.toLowerCase().includes('config parameter is required') ||
           errorMessage.toLowerCase().includes('config not found') ||
           errorMessage.toLowerCase().includes('failed to get kubernetes client') ||
           errorMessage.toLowerCase().includes('invalid response format');
  }, []);

  // Check if error is a network/temporary error
  const isTemporaryError = useCallback((errorMessage: string): boolean => {
    if (!errorMessage) return false;
    return errorMessage.toLowerCase().includes('network') ||
           errorMessage.toLowerCase().includes('timeout') ||
           errorMessage.toLowerCase().includes('connection') ||
           errorMessage.toLowerCase().includes('temporary');
  }, []);

  // Calculate exponential backoff delay
  const getBackoffDelay = (retryCount: number): number => {
    const baseDelay = 5000; // 5 seconds
    const maxDelay = 60000; // 60 seconds
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    return delay;
  };

  // Handle messages from the terminal WebSocket
  const handleMessage = useCallback((message: ServerMessage) => {
    if (!terminalRef.current) return;

    switch (message.type) {
      case 'stdout':
        if (message.data) {
          terminalRef.current.write(message.data);
        }
        break;
      case 'stderr':
        if (message.data) {
          terminalRef.current.write(`\x1b[31m${message.data}\x1b[0m`);
        }
        break;
      case 'error':
        if (message.error) {
          terminalRef.current.writeln(`\r\n\x1b[31mError: ${message.error}\x1b[0m`);
          if (isPermissionError(message.error)) {
            setSessionMessage({
              type: 'error',
              message: `Permission denied: You don't have permission to connect to this cloud shell session.`
            });
          }
        }
        break;
      case 'status':
        if (message.status) {
          setStatusMessage(message.status.message);
        }
        break;
    }
  }, [isPermissionError]);

  // Handle connection status changes
  const handleStatusChange = useCallback((newStatus: ConnectionStatus) => {
    if (!terminalRef.current) return;

    switch (newStatus) {
      case 'connected':
        // Clear terminal for a fresh start
        terminalRef.current.clear();
        terminalRef.current.writeln(`\x1b[32mConnected to cloud shell in cluster: ${clusterName}\x1b[0m`);
        terminalRef.current.writeln(`\x1b[36mAvailable commands: kubectl, helm\x1b[0m`);
        terminalRef.current.writeln(`\x1b[37mType 'exit' to disconnect\x1b[0m\r\n`);
        setSessionMessage({ type: 'success', message: 'Connected to cloud shell successfully!' });
        // Fit terminal to container and focus to enable keyboard input
        terminalRef.current.fit();
        terminalRef.current.focus();
        break;
      case 'disconnected':
        terminalRef.current.writeln(`\r\n\x1b[31mDisconnected from cloud shell\x1b[0m`);
        dispatch(setCurrentSession(null));
        setSessionMessage({ type: 'error', message: 'Disconnected from cloud shell' });
        break;
      case 'error':
        terminalRef.current.writeln(`\r\n\x1b[31mConnection error occurred\x1b[0m`);
        setSessionMessage({ type: 'error', message: 'Failed to connect to cloud shell. Please try again.' });
        break;
    }
  }, [clusterName, dispatch]);

  // Handle WebSocket errors
  const handleError = useCallback((errorMsg: string) => {
    if (terminalRef.current) {
      terminalRef.current.writeln(`\r\n\x1b[31mError: ${errorMsg}\x1b[0m`);
    }
  }, []);

  // WebSocket connection hook
  const { status, isConnected, sendInput, sendResize, disconnect } = useTerminalWebSocket({
    url: wsUrl,
    reconnect: true,
    maxReconnectAttempts: 3,
    reconnectInterval: 1000,
    onMessage: handleMessage,
    onStatusChange: handleStatusChange,
    onError: handleError,
  });

  // Handle terminal input
  const handleTerminalInput = useCallback((data: string) => {
    if (!isConnected) return;
    sendInput(data);
  }, [isConnected, sendInput]);

  // Handle terminal resize
  const handleTerminalResize = useCallback((dimensions: ResizeDimensions) => {
    if (isConnected) {
      sendResize(dimensions.cols, dimensions.rows);
    }
  }, [isConnected, sendResize]);

  // Load sessions on mount
  useEffect(() => {
    dispatch(listCloudShellSessions({ config: configName, cluster: clusterName, namespace }));
  }, [dispatch, configName, clusterName, namespace]);

  // Poll for session updates with intelligent error handling and backoff
  useEffect(() => {
    let pollTimeout: NodeJS.Timeout;

    const pollSessions = async () => {
      if (isPollingDisabled) return;

      if (error) {
        if (isPermissionError(error) || isConfigurationError(error)) {
          console.warn('CloudShell polling stopped due to persistent error:', error);
          setIsPollingDisabled(true);
          return;
        }
      }

      try {
        await dispatch(listCloudShellSessions({ config: configName, cluster: clusterName, namespace })).unwrap();
        setRetryCount(0);
        setLastErrorType(null);
        pollTimeout = setTimeout(pollSessions, 5000);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error('CloudShell polling error:', errorMessage);

        let errorType = 'unknown';
        if (isPermissionError(errorMessage)) {
          errorType = 'permission';
        } else if (isConfigurationError(errorMessage)) {
          errorType = 'configuration';
        } else if (isTemporaryError(errorMessage)) {
          errorType = 'temporary';
        }

        setLastErrorType(errorType);

        if (errorType === 'permission' || errorType === 'configuration') {
          console.warn('CloudShell polling stopped due to persistent error type:', errorType);
          setIsPollingDisabled(true);
          return;
        }

        const newRetryCount = retryCount + 1;
        setRetryCount(newRetryCount);

        if (newRetryCount >= 5) {
          console.warn('CloudShell polling stopped after 5 consecutive failures');
          setIsPollingDisabled(true);
          setSessionMessage({
            type: 'error',
            message: 'Unable to connect to CloudShell service. Please refresh the page or check your connection.'
          });
          return;
        }

        const backoffDelay = getBackoffDelay(newRetryCount);
        console.log(`CloudShell polling retry ${newRetryCount} scheduled in ${backoffDelay}ms`);
        pollTimeout = setTimeout(pollSessions, backoffDelay);
      }
    };

    pollSessions();

    return () => {
      if (pollTimeout) clearTimeout(pollTimeout);
    };
  }, [dispatch, configName, clusterName, namespace, retryCount, isPollingDisabled, error, isPermissionError, isConfigurationError, isTemporaryError]);

  // Clear session messages after 5 seconds
  useEffect(() => {
    if (sessionMessage) {
      const timer = setTimeout(() => setSessionMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [sessionMessage]);

  // Handle manual refresh
  const handleRefresh = () => {
    setIsPollingDisabled(false);
    setRetryCount(0);
    setLastErrorType(null);
    setSessionMessage(null);
    dispatch(clearError());
    dispatch(listCloudShellSessions({ config: configName, cluster: clusterName, namespace }));
  };

  // Create new cloud shell
  const handleCreateShell = async () => {
    try {
      setCreatingSession(true);
      setSessionMessage(null);

      const result = await dispatch(createCloudShell({
        config: configName,
        cluster: clusterName,
        namespace
      })).unwrap();

      dispatch(listCloudShellSessions({ config: configName, cluster: clusterName, namespace }));
      setSessionMessage({ type: 'success', message: 'Cloud shell session created successfully!' });

      if (result.session.status === 'ready') {
        connectToShell(result.session);
      } else {
        setSessionMessage({ type: 'success', message: 'Session created! Waiting for it to be ready...' });
        const statusCheckInterval = setInterval(async () => {
          try {
            const sessionsResult = await dispatch(listCloudShellSessions({
              config: configName,
              cluster: clusterName,
              namespace
            })).unwrap();

            const updatedSession = sessionsResult.sessions.find(s => s.id === result.session.id);
            if (updatedSession && updatedSession.status === 'ready') {
              clearInterval(statusCheckInterval);
              setSessionMessage({ type: 'success', message: 'Session is ready! Connecting...' });
              connectToShell(updatedSession);
            }
          } catch (err) {
            console.error('Failed to check session status:', err);
          }
        }, 2000);

        setTimeout(() => {
          clearInterval(statusCheckInterval);
          setSessionMessage({ type: 'error', message: 'Session creation timed out. Please try again.' });
        }, 120000);
      }
    } catch (err) {
      console.error('Failed to create cloud shell:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setSessionMessage({ type: 'error', message: errorMessage });
    } finally {
      setCreatingSession(false);
    }
  };

  // Connect to existing shell
  const connectToShell = useCallback((session: CloudShellSession) => {
    if (!session || session.status !== 'ready') {
      console.error('Session not ready:', session);
      setSessionMessage({ type: 'error', message: 'Session is not ready yet. Please wait a moment and try again.' });
      return;
    }

    // Disconnect any existing connection
    if (isConnected) {
      disconnect();
    }

    setSessionMessage(null);

    // Build WebSocket URL using the new terminal endpoint
    const url = buildCloudShellWebSocketUrl({
      namespace: session.namespace,
      podName: session.podName,
      configId: configName,
      cluster: clusterName,
    });

    // Clear terminal before connecting
    if (terminalRef.current) {
      terminalRef.current.clear();
    }

    dispatch(setCurrentSession(session));
    setWsUrl(url);
  }, [isConnected, disconnect, configName, clusterName, dispatch]);

  // Disconnect from shell
  const disconnectFromShell = useCallback(() => {
    disconnect();
    setWsUrl(null);
  }, [disconnect]);

  // Delete shell session
  const handleDeleteShell = async (session: CloudShellSession) => {
    try {
      await dispatch(deleteCloudShell({
        name: session.id,
        config: configName,
        cluster: clusterName,
        namespace
      })).unwrap();
      dispatch(listCloudShellSessions({ config: configName, cluster: clusterName, namespace }));
    } catch (err) {
      console.error('Failed to delete cloud shell:', err);
    }
  };

  // Get status badge color
  const getStatusBadge = (sessionStatus: string) => {
    switch (sessionStatus) {
      case 'ready':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600 text-white">Ready</Badge>;
      case 'creating':
        return <Badge variant="secondary" className="bg-blue-500 hover:bg-blue-600 text-white">Creating</Badge>;
      case 'terminating':
        return <Badge variant="destructive" className="bg-red-500 hover:bg-red-600 text-white">Terminating</Badge>;
      case 'terminated':
        return <Badge variant="destructive" className="bg-red-500 hover:bg-red-600 text-white">Terminated</Badge>;
      default:
        return <Badge variant="outline">{sessionStatus}</Badge>;
    }
  };

  const canConnectToSession = (session: CloudShellSession) => session.status === 'ready';

  const toggleExpansion = () => {
    setIsExpanded(!isExpanded);
    setTimeout(() => terminalRef.current?.fit(), 100);
  };

  return (
    <div className="cloud-shell space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TerminalIcon className="h-5 w-5" />
            Cloud Shell
          </CardTitle>
          <CardDescription>
            Interactive terminal with kubectl and helm access for cluster
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && isPermissionError(error) && (
            <div className="mb-4">
              <PermissionErrorBanner
                error={{
                  type: 'permission_error',
                  message: error,
                  code: 403,
                  resource: 'cloudshell',
                  verb: 'create'
                }}
                className="mb-4"
              />
            </div>
          )}

          {sessionMessage && !isPermissionError(sessionMessage.message) && (
            <div className="mb-4">
              <Alert variant={sessionMessage.type === 'error' ? 'destructive' : 'default'} className="mb-4">
                <AlertDescription>{sessionMessage.message}</AlertDescription>
              </Alert>
            </div>
          )}

          {/* Session Management */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-semibold text-foreground">Sessions ({currentSessionCount}/{sessionLimit})</h3>
                {currentSessionCount >= sessionLimit && (
                  <Badge variant="destructive" className="text-xs">
                    Limit Reached
                  </Badge>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsSessionsCollapsed(!isSessionsCollapsed)}
                  className="h-6 w-6 p-0"
                >
                  {isSessionsCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={loading}
                  className="flex items-center gap-2"
                  title={
                    isPollingDisabled
                      ? `Polling stopped due to ${lastErrorType || 'persistent'} errors - click to retry`
                      : error && isPermissionError(error)
                        ? "Click to retry - polling stopped due to permission error"
                        : "Refresh sessions"
                  }
                >
                  <RefreshCw className="h-4 w-4" />
                  {isPollingDisabled ? 'Retry' : 'Refresh'}
                </Button>
                <Button
                  onClick={handleCreateShell}
                  disabled={loading || creatingSession || currentSessionCount >= sessionLimit || (error ? isPermissionError(error) : false)}
                  className="flex items-center gap-2"
                  title={
                    currentSessionCount >= sessionLimit
                      ? `Maximum ${sessionLimit} sessions reached`
                      : (error && isPermissionError(error))
                        ? "Insufficient permissions to create cloud shell"
                        : undefined
                  }
                >
                  {loading || creatingSession ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {creatingSession ? 'Creating...' : 'New Shell'}
                </Button>
              </div>
            </div>

            {!isSessionsCollapsed && (
              <>
                {currentSessionCount >= sessionLimit && (
                  <Alert className="mb-3 border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20">
                    <AlertDescription className="text-orange-800 dark:text-orange-200">
                      Maximum number of active sessions ({sessionLimit}) reached. Please terminate an existing session before creating a new one.
                    </AlertDescription>
                  </Alert>
                )}
                {sessions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No active sessions</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex items-center justify-between p-2 border border-border rounded-lg bg-card hover:bg-accent/50 transition-colors">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm truncate text-foreground">{session.podName}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(session.createdAt).toLocaleTimeString()}
                            </p>
                          </div>
                          {getStatusBadge(session.status)}
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          {canConnectToSession(session) && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => connectToShell(session)}
                              disabled={isConnected && currentSession?.id === session.id}
                              className="h-7 px-2"
                              title={
                                isConnected && currentSession?.id === session.id
                                  ? 'Already connected to this session'
                                  : 'Connect to this cloud shell session'
                              }
                            >
                              {isConnected && currentSession?.id === session.id ? 'Connected' : 'Connect'}
                            </Button>
                          )}
                          {session.status === 'creating' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={true}
                              className="h-7 px-2"
                            >
                              Creating...
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={loading}
                                className="h-7 w-7 p-0"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Session</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete the session "{session.podName}"?
                                  This action cannot be undone and will terminate the cloud shell.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDeleteShell(session)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Terminal */}
          <div className="border rounded-lg overflow-hidden">
            <div className="bg-gray-900 p-2 flex items-center justify-between">
              <span className="text-white text-sm">
                {isConnected ? 'Connected' : 'Disconnected'} - {clusterName}
              </span>
              <div className="flex items-center gap-2">
                {isConnected && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={disconnectFromShell}
                    className="h-7 px-2"
                  >
                    <Square className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleExpansion}
                  className="h-7 px-2"
                >
                  {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <div
              className="transition-all duration-300 w-full"
              style={{
                height: isExpanded ? '600px' : '400px',
                minHeight: isExpanded ? '600px' : '400px'
              }}
            >
              <Terminal
                ref={terminalRef}
                status={status}
                statusMessage={statusMessage}
                onData={handleTerminalInput}
                onResize={handleTerminalResize}
                allowFullscreen={true}
                allowSearch={true}
                showToolbar={true}
                showStatusBar={true}
                enableWebGL={true}
                initialRows={isExpanded ? 35 : 25}
                initialCols={120}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
