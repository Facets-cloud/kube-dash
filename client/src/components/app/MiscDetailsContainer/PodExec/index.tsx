import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { PodDetailsSpec } from "@/types";

import { Terminal, TerminalRef } from "@/components/terminal";
import { useTerminalWebSocket } from "@/hooks/terminal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ServerMessage,
  buildExecWebSocketUrl,
  ConnectionStatus,
  ResizeDimensions,
} from "@/types/terminal";

type PodExecProps = {
  pod: string;
  namespace: string;
  configName: string;
  clusterName: string;
  podDetailsSpec: PodDetailsSpec;
}

export function PodExec({ pod, namespace, configName, clusterName, podDetailsSpec }: PodExecProps) {
  const terminalRef = useRef<TerminalRef>(null);
  const [selectedContainer, setSelectedContainer] = useState('');
  const [command, setCommand] = useState('/bin/sh');
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();

  const containerNames = useMemo(() =>
    podDetailsSpec.containers?.map(container => container.name) || [],
    [podDetailsSpec.containers]
  );

  // Set default container to the first one
  useEffect(() => {
    if (containerNames.length > 0 && !selectedContainer) {
      setSelectedContainer(containerNames[0]);
    }
  }, [containerNames, selectedContainer]);

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
          // Write stderr in red
          terminalRef.current.write(`\x1b[31m${message.data}\x1b[0m`);
        }
        break;
      case 'error':
        if (message.error) {
          terminalRef.current.writeln(`\r\n\x1b[31mError: ${message.error}\x1b[0m`);
        }
        break;
      case 'status':
        if (message.status) {
          setStatusMessage(message.status.message);
        }
        break;
    }
  }, []);

  // Handle connection status changes
  const handleStatusChange = useCallback((newStatus: ConnectionStatus) => {
    if (!terminalRef.current) return;

    switch (newStatus) {
      case 'connected':
        // Clear terminal for a fresh start
        terminalRef.current.clear();
        terminalRef.current.writeln(`\x1b[32mConnected to pod ${pod} in container ${selectedContainer}\x1b[0m`);
        terminalRef.current.writeln(`\x1b[36mCommand: ${command}\x1b[0m`);
        terminalRef.current.writeln(`\x1b[37mType 'exit' to disconnect\x1b[0m\r\n`);
        // Fit terminal to container and focus to enable keyboard input
        terminalRef.current.fit();
        terminalRef.current.focus();
        break;
      case 'disconnected':
        terminalRef.current.writeln(`\r\n\x1b[31mDisconnected from pod ${pod}\x1b[0m`);
        break;
      case 'error':
        terminalRef.current.writeln(`\r\n\x1b[31mConnection error occurred\x1b[0m`);
        break;
    }
  }, [pod, selectedContainer, command]);

  // Handle WebSocket errors
  const handleError = useCallback((error: string) => {
    if (terminalRef.current) {
      terminalRef.current.writeln(`\r\n\x1b[31mError: ${error}\x1b[0m`);
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

    // Handle special terminal control sequences locally
    if (data.length === 1) {
      const charCode = data.charCodeAt(0);

      // Ctrl+L (form feed) - clear screen locally
      if (charCode === 12 && terminalRef.current) {
        terminalRef.current.clear();
      }
    }

    // Send input to WebSocket
    sendInput(data);
  }, [isConnected, sendInput]);

  // Handle terminal resize
  const handleTerminalResize = useCallback((dimensions: ResizeDimensions) => {
    if (isConnected) {
      sendResize(dimensions.cols, dimensions.rows);
    }
  }, [isConnected, sendResize]);

  // Connect to pod
  const connectToPod = useCallback(() => {
    if (!selectedContainer) {
      alert('Please select a container');
      return;
    }

    // Build WebSocket URL using the new terminal endpoint
    const url = buildExecWebSocketUrl({
      namespace,
      podName: pod,
      container: selectedContainer,
      command,
      configId: configName,
      cluster: clusterName,
    });

    // Clear terminal before connecting
    if (terminalRef.current) {
      terminalRef.current.clear();
    }

    setWsUrl(url);
  }, [namespace, pod, selectedContainer, command, configName, clusterName]);

  // Disconnect from pod
  const disconnectFromPod = useCallback(() => {
    disconnect();
    setWsUrl(null);
  }, [disconnect]);

  // Handle container change
  const handleContainerChange = useCallback((newContainer: string) => {
    if (isConnected) {
      disconnectFromPod();
    }
    setSelectedContainer(newContainer);
  }, [isConnected, disconnectFromPod]);

  return (
    <div className="pod-exec flex flex-col border rounded-lg">
      {/* Connection Controls */}
      <div className="flex items-center justify-between py-2 px-3 border-b bg-muted/50">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <Label htmlFor="container" className="text-xs whitespace-nowrap">Container:</Label>
            <Select value={selectedContainer} onValueChange={handleContainerChange}>
              <SelectTrigger className="w-48 h-8">
                <SelectValue placeholder="Select container" />
              </SelectTrigger>
              <SelectContent>
                {containerNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Label htmlFor="command" className="text-xs whitespace-nowrap">Command:</Label>
            <Input
              id="command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-32 h-8 text-xs"
              placeholder="/bin/sh"
              disabled={isConnected}
            />
          </div>

          {!isConnected ? (
            <Button
              onClick={connectToPod}
              className="h-8 text-xs"
              disabled={!selectedContainer}
            >
              Connect
            </Button>
          ) : (
            <Button
              onClick={disconnectFromPod}
              variant="destructive"
              className="h-8 text-xs"
            >
              Disconnect
            </Button>
          )}
        </div>
      </div>

      {/* Terminal */}
      <div className="flex-1">
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
          initialRows={30}
          initialCols={120}
        />
      </div>
    </div>
  );
}
