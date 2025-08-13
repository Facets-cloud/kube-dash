import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { toast } from 'sonner';
import {
  Play,
  Pause,
  Download,
  Search,
  Copy,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Trash2,
  Terminal,
  Clock,
  AlertCircle,
  Info,
  XCircle,
} from 'lucide-react';
import { usePodLogsWebSocket, LogMessage } from '@/hooks/usePodLogsWebSocket';
import { cn } from '@/lib/utils';

interface PodLogsViewerProps {
  podName: string;
  namespace: string;
  configName: string;
  clusterName: string;
  container?: string;
  allContainers?: boolean;
  className?: string;
}

interface LogEntry extends LogMessage {
  id: string;
  searchMatch?: boolean;
}

const LOG_LEVEL_COLORS = {
  error: 'text-red-500',
  warn: 'text-yellow-500',
  warning: 'text-yellow-500',
  info: 'text-blue-500',
  debug: 'text-gray-500',
  trace: 'text-gray-400',
} as const;

const LOG_LEVEL_ICONS = {
  error: XCircle,
  warn: AlertCircle,
  warning: AlertCircle,
  info: Info,
  debug: Terminal,
  trace: Terminal,
} as const;

const LogLine: React.FC<{
  log: LogEntry;
  showTimestamps: boolean;
  searchTerm: string;
  onCopyLine: (log: LogEntry) => void;
}> = ({ log, showTimestamps, searchTerm, onCopyLine }) => {
  const levelColor = log.level ? LOG_LEVEL_COLORS[log.level as keyof typeof LOG_LEVEL_COLORS] : '';
  const LevelIcon = log.level ? LOG_LEVEL_ICONS[log.level as keyof typeof LOG_LEVEL_ICONS] : null;
  
  const highlightText = (text: string, term: string) => {
    if (!term) return text;
    
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, i) => 
      regex.test(part) ? (
        <span key={i} className="bg-yellow-200 dark:bg-yellow-800 px-1 rounded">
          {part}
        </span>
      ) : part
    );
  };

  return (
    <div
      className={cn(
        'flex items-start gap-2 px-3 py-1 text-sm font-mono hover:bg-muted/50 group border-b border-border/20',
        log.searchMatch && 'bg-yellow-50 dark:bg-yellow-900/20'
      )}
    >
      {/* Line number */}
      <span className="text-muted-foreground text-xs w-12 flex-shrink-0 text-right pt-0.5">
        {log.lineNumber}
      </span>
      
      {/* Timestamp */}
      {showTimestamps && (
        <span className="text-muted-foreground text-xs w-20 flex-shrink-0 pt-0.5">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
      )}
      
      {/* Container name (if multiple containers) */}
      {log.container && (
        <Badge variant="outline" className="text-xs h-5 px-1.5">
          {log.container}
        </Badge>
      )}
      
      {/* Log level icon */}
      {LevelIcon && (
        <LevelIcon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', levelColor)} />
      )}
      
      {/* Log message */}
      <span className={cn('flex-1 break-all', levelColor)}>
        {highlightText(log.message, searchTerm)}
      </span>
      
      
      {/* Copy button */}
      <Button
        variant="ghost"
        size="sm"
        className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0"
        onClick={() => onCopyLine(log)}
        title="Copy line"
      >
        <Copy className="w-3 h-3" />
      </Button>
    </div>
  );
};

export const PodLogsViewer: React.FC<PodLogsViewerProps> = ({
  podName,
  namespace,
  configName,
  clusterName,
  container,
  allContainers = false,
  className,
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isPaused] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentSearchIndex, setCurrentSearchIndex] = useState(-1);
  const [tailLines] = useState(100);
  const [logLevel] = useState<string>('all');
  
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const logIdCounter = useRef(0);
  const userScrolledRef = useRef(false);
  const lastScrollTop = useRef(0);
  
  // WebSocket connection
  const {
    isConnected,
    isConnecting,
    error: wsError,
    connect,
    disconnect,
    reconnect,
  } = usePodLogsWebSocket({
    podName,
    namespace,
    configName,
    clusterName,
    container,
    allContainers,
    tailLines,
    enabled: !isPaused,
    onLog: useCallback((logMessage: LogMessage) => {
      const logEntry: LogEntry = {
        ...logMessage,
        id: `log-${logIdCounter.current++}`,
      };
      
      setLogs(prevLogs => {
        const newLogs = [...prevLogs, logEntry];
        // Keep only last 10000 logs to prevent memory issues
        return newLogs.length > 10000 ? newLogs.slice(-10000) : newLogs;
      });
    }, []),
    onError: useCallback((error: string) => {
      toast.error('Log Stream Error', {
        description: error,
      });
    }, []),
  });

  // Filter logs based on level
  const filteredLogs = useMemo(() => {
    if (logLevel === 'all') return logs;
    return logs.filter(log => log.level === logLevel);
  }, [logs, logLevel]);

  // Search functionality
  useEffect(() => {
    if (!searchTerm) {
      setSearchResults([]);
      setCurrentSearchIndex(-1);
      setLogs(prevLogs => prevLogs.map(log => ({ ...log, searchMatch: false })));
      return;
    }

    const results: number[] = [];
    const updatedLogs = filteredLogs.map((log, index) => {
      const matches = log.message.toLowerCase().includes(searchTerm.toLowerCase());
      if (matches) {
        results.push(index);
      }
      return { ...log, searchMatch: matches };
    });
    
    setLogs(updatedLogs);
    setSearchResults(results);
    setCurrentSearchIndex(results.length > 0 ? 0 : -1);
  }, [searchTerm, filteredLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && !userScrolledRef.current && filteredLogs.length > 0 && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
    }
  }, [filteredLogs.length, autoScroll]);

  // Handle scroll events to detect user scrolling
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const { scrollTop, scrollHeight, clientHeight } = target;
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10; // 10px threshold
    const isScrollingUp = scrollTop < lastScrollTop.current;
    
    if (isScrollingUp && scrollTop > 0) {
      userScrolledRef.current = true;
      setAutoScroll(false);
    } else if (isAtBottom && userScrolledRef.current) {
      userScrolledRef.current = false;
      setAutoScroll(true);
    }
    
    lastScrollTop.current = scrollTop;
  }, []);

  // Copy log line
  const handleCopyLine = useCallback((log: LogEntry) => {
    const text = showTimestamps 
      ? `${log.timestamp} ${log.container ? `[${log.container}] ` : ''}${log.message}`
      : `${log.container ? `[${log.container}] ` : ''}${log.message}`;
    
    navigator.clipboard.writeText(text).then(() => {
      toast.success('Copied to clipboard');
    }).catch(() => {
      toast.error('Failed to copy to clipboard');
    });
  }, [showTimestamps]);

  // Download logs
  const handleDownloadLogs = useCallback(() => {
    const content = filteredLogs.map(log => {
      const timestamp = showTimestamps ? `${log.timestamp} ` : '';
      const containerName = log.container ? `[${log.container}] ` : '';
      return `${timestamp}${containerName}${log.message}`;
    }).join('\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-${container || 'all'}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    toast.success('Logs downloaded successfully');
  }, [filteredLogs, showTimestamps, podName, container]);

  // Clear logs
  const handleClearLogs = useCallback(() => {
    setLogs([]);
    setSearchResults([]);
    setCurrentSearchIndex(-1);
    toast.success('Logs cleared');
  }, []);

  // Navigate search results
  const navigateSearch = useCallback((direction: 'next' | 'prev') => {
    if (searchResults.length === 0) return;
    
    let newIndex;
    if (direction === 'next') {
      newIndex = currentSearchIndex < searchResults.length - 1 ? currentSearchIndex + 1 : 0;
    } else {
      newIndex = currentSearchIndex > 0 ? currentSearchIndex - 1 : searchResults.length - 1;
    }
    
    setCurrentSearchIndex(newIndex);
    // Scroll to the search result (approximate)
    if (scrollAreaRef.current) {
      const lineHeight = 24;
      scrollAreaRef.current.scrollTop = searchResults[newIndex] * lineHeight;
    }
  }, [searchResults, currentSearchIndex]);

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (filteredLogs.length > 0 && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
      setAutoScroll(true);
      userScrolledRef.current = false;
    }
  }, [filteredLogs.length]);

  const connectionStatus = isConnecting ? 'connecting' : isConnected ? 'connected' : 'disconnected';
  const statusColor = {
    connecting: 'text-yellow-500',
    connected: 'text-green-500',
    disconnected: 'text-red-500',
  }[connectionStatus];

  return (
    <Card className={cn('flex flex-col h-full', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="w-5 h-5" />
            Pod Logs
            <Badge variant="outline" className={statusColor}>
              {connectionStatus}
            </Badge>
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {/* Connection controls */}
            <Button
              variant="outline"
              size="sm"
              onClick={isPaused ? connect : disconnect}
              className="flex items-center gap-1"
            >
              {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              onClick={reconnect}
              disabled={isConnecting}
            >
              <RotateCcw className="w-4 h-4" />
            </Button>
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {/* Search */}
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-48 h-8"
            />
            {searchResults.length > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-muted-foreground">
                  {currentSearchIndex + 1} of {searchResults.length}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateSearch('prev')}
                  className="h-6 w-6 p-0"
                >
                  <ChevronUp className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateSearch('next')}
                  className="h-6 w-6 p-0"
                >
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Toggles */}
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <Label htmlFor="timestamps" className="text-xs">Timestamps</Label>
            <Switch
              id="timestamps"
              checked={showTimestamps}
              onCheckedChange={setShowTimestamps}
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Label htmlFor="autoscroll" className="text-xs">Auto-scroll</Label>
            <Switch
              id="autoscroll"
              checked={autoScroll}
              onCheckedChange={(checked) => {
                setAutoScroll(checked);
                if (checked) {
                  scrollToBottom();
                }
              }}
            />
          </div>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Actions */}
          <Button
            variant="ghost"
            size="sm"
            onClick={scrollToBottom}
            className="h-8 px-2"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownloadLogs}
            className="h-8 px-2"
            disabled={filteredLogs.length === 0}
          >
            <Download className="w-4 h-4" />
          </Button>
          
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearLogs}
            className="h-8 px-2"
            disabled={filteredLogs.length === 0}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
        
        {/* Status */}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {filteredLogs.length} lines
            {searchResults.length > 0 && ` • ${searchResults.length} matches`}
          </span>
          
          {wsError && (
            <span className="text-red-500 flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {wsError}
            </span>
          )}
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 p-0 min-h-0">
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Terminal className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No logs available</p>
              <p className="text-xs mt-1">
                {isPaused ? 'Streaming is paused' : 'Waiting for logs...'}
              </p>
            </div>
          </div>
        ) : (
          <div 
            ref={scrollAreaRef}
            className="h-full overflow-auto scrollbar-active max-h-[calc(100vh-20rem)]"
            onScroll={handleScroll}
          >
            <div className="space-y-0">
              {filteredLogs.map((log) => (
                <LogLine
                  key={log.id}
                  log={log}
                  showTimestamps={showTimestamps}
                  searchTerm={searchTerm}
                  onCopyLine={handleCopyLine}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};