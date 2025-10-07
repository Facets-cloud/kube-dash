import React, { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Download,
  Search,
  Trash2,
  Terminal,
  Filter,
  ChevronUp,
  ChevronDown,
  History,
  Hash,
  InfoIcon,
  Regex,
} from 'lucide-react';
import { usePodLogsWebSocket, LogMessage } from '@/hooks/usePodLogsWebSocket';
import { cn } from '@/lib/utils';
import { PodDetails } from '@/types';
import { ContainerRestartInfoComponent } from './ContainerRestartInfo';
import { toast } from 'sonner';

interface TerminalLogViewerProps {
  podName: string;
  namespace: string;
  configName: string;
  clusterName: string;
  container?: string;
  allContainers?: boolean;
  className?: string;
  podDetails?: PodDetails;
  viewControls?: React.ReactNode;
  isFullscreen?: boolean;
}

const LogRetrievalControls: React.FC<{
  includePrevious: boolean;
  onIncludePreviousChange: (value: boolean) => void;
  logMode: 'all' | 'tail';
  onLogModeChange: (mode: 'all' | 'tail') => void;
  maxLines: number;
  onMaxLinesChange: (lines: number) => void;
  podName: string;
  namespace: string;
  configName: string;
  clusterName: string;
  containerName?: string;
}> = ({
  includePrevious,
  onIncludePreviousChange,
  logMode,
  onLogModeChange,
  maxLines,
  onMaxLinesChange,
  podName,
  namespace,
  configName,
  clusterName,
  containerName,
}) => {
  const [restartInfos, setRestartInfos] = React.useState<any[]>([]);
  const [loadingRestarts, setLoadingRestarts] = React.useState(false);

  React.useEffect(() => {
    const fetchRestartInfo = async () => {
      try {
        setLoadingRestarts(true);
        const params = new URLSearchParams({
          config: configName,
          cluster: clusterName,
        });

        const response = await fetch(
          `/api/v1/pods/${namespace}/${podName}/restarts?${params.toString()}`
        );

        if (response.ok) {
          const data = await response.json();
          setRestartInfos(data);
        }
      } catch (err) {
        console.error('Failed to fetch restart info:', err);
      } finally {
        setLoadingRestarts(false);
      }
    };

    fetchRestartInfo();
  }, [podName, namespace, configName, clusterName]);

  const filteredInfos = containerName
    ? restartInfos.filter(info => info.containerName === containerName)
    : restartInfos;

  const hasRestarts = filteredInfos.some(info => info.restartCount > 0);

  return (
    <div className="flex items-center gap-4 p-3 border-b bg-muted/30">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-muted-foreground" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <Label
                  htmlFor="previous-logs"
                  className={cn(
                    "text-sm font-medium",
                    !hasRestarts && "text-muted-foreground"
                  )}
                >
                  Show Previous Logs
                </Label>
                <Switch
                  id="previous-logs"
                  checked={includePrevious}
                  onCheckedChange={onIncludePreviousChange}
                  disabled={!hasRestarts}
                />
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="focus:outline-none">
                      <InfoIcon className="w-4 h-4 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 max-h-96 overflow-auto" align="start">
                    <div className="space-y-2">
                      <h4 className="font-medium text-sm">Container Restart Information</h4>
                      {loadingRestarts ? (
                        <p className="text-xs text-muted-foreground">Loading...</p>
                      ) : !hasRestarts ? (
                        <div className="text-xs text-muted-foreground">
                          <p className="font-medium text-green-600 dark:text-green-400 mb-1">✓ No Restarts</p>
                          <p>
                            {filteredInfos.length === 1
                              ? 'This container has not restarted.'
                              : filteredInfos.length > 1
                              ? 'None of the containers have restarted.'
                              : 'No container information available.'}
                          </p>
                        </div>
                      ) : (
                        <ContainerRestartInfoComponent
                          podName={podName}
                          namespace={namespace}
                          configName={configName}
                          clusterName={clusterName}
                          containerName={containerName}
                        />
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{hasRestarts ? 'Toggle between current and previous pod logs' : 'No restarts detected - toggle disabled'}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-2">
        <Label className="text-sm font-medium">Log Retrieval:</Label>
        <Select value={logMode} onValueChange={onLogModeChange}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Logs</SelectItem>
            <SelectItem value="tail">Recent Lines</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {logMode === 'tail' && (
        <div className="flex items-center gap-2">
          <Hash className="w-4 h-4 text-muted-foreground" />
          <Input
            type="number"
            min={1}
            max={10000}
            value={maxLines}
            onChange={(e) => onMaxLinesChange(parseInt(e.target.value) || 100)}
            className="w-20"
            placeholder="100"
          />
          <Label className="text-sm text-muted-foreground">lines</Label>
        </div>
      )}
    </div>
  );
};

export const TerminalLogViewer: React.FC<TerminalLogViewerProps> = ({
  podName,
  namespace,
  configName,
  clusterName,
  container,
  allContainers = false,
  className,
  podDetails,
  viewControls,
  isFullscreen = false,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchMode, setSearchMode] = useState<'simple' | 'regex' | 'grep'>('simple');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);
  const [includePrevious, setIncludePrevious] = useState(false);
  const [logMode, setLogMode] = useState<'all' | 'tail'>('tail');
  const [maxLines, setMaxLines] = useState(100);
  const logBufferRef = useRef<string>('');

  const allPodContainers = React.useMemo(() => {
    if (!podDetails?.spec) return [];
    const containers: string[] = [];
    if (podDetails.spec.containers) {
      containers.push(...podDetails.spec.containers.map(c => c.name));
    }
    if (podDetails.spec.initContainers) {
      containers.push(...podDetails.spec.initContainers.map(c => c.name));
    }
    if ((podDetails.spec as any).ephemeralContainers) {
      containers.push(...(podDetails.spec as any).ephemeralContainers.map((c: any) => c.name));
    }
    return containers;
  }, [podDetails]);

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#e0e0e0',
        cursor: '#e0e0e0',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);

    // Delay the fit to ensure container is properly sized
    setTimeout(() => {
      fitAddon.fit();
    }, 0);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      term.dispose();
    };
  }, []);

  // Refit terminal when fullscreen mode changes
  useEffect(() => {
    if (fitAddonRef.current) {
      // Small delay to allow layout to settle
      setTimeout(() => {
        fitAddonRef.current?.fit();
      }, 100);
    }
  }, [isFullscreen]);

  // Handle log mode/previous toggle changes
  const handleIncludePreviousChange = useCallback((value: boolean) => {
    setIncludePrevious(value);
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
    }
  }, []);

  const handleLogModeChange = useCallback((mode: 'all' | 'tail') => {
    setLogMode(mode);
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
    }
  }, []);

  const handleMaxLinesChange = useCallback((lines: number) => {
    setMaxLines(lines);
  }, []);

  const effectiveContainer = selectedContainer && selectedContainer !== 'all' ? selectedContainer : container;
  const effectiveAllContainers = selectedContainer === 'all' || (!selectedContainer && allContainers);

  const { isConnected, isConnecting } = usePodLogsWebSocket({
    podName,
    namespace,
    configName,
    clusterName,
    container: effectiveContainer,
    allContainers: effectiveAllContainers,
    tailLines: logMode === 'tail' ? maxLines : undefined,
    previous: includePrevious,
    allLogs: logMode === 'all',
    enabled: true,
    onLog: useCallback((logMessage: LogMessage) => {
      if (!xtermRef.current) return;

      const containerPrefix = logMessage.container ? `\x1b[36m[${logMessage.container}]\x1b[0m ` : '';
      const logLine = `${containerPrefix}${logMessage.message}\r\n`;

      xtermRef.current.write(logLine);
      logBufferRef.current += logLine;

      // Update available containers
      if (logMessage.container) {
        setAvailableContainers(prev => {
          const merged = new Set([...allPodContainers, ...prev]);
          if (!merged.has(logMessage.container!)) {
            merged.add(logMessage.container!);
          }
          return Array.from(merged).sort();
        });
      }
    }, [allPodContainers]),
    onError: useCallback((error: string) => {
      if (xtermRef.current) {
        xtermRef.current.write(`\x1b[31mError: ${error}\x1b[0m\r\n`);
      }
      toast.error('Log Stream Error', { description: error });
    }, []),
  });

  // Initialize available containers from pod spec
  useEffect(() => {
    if (allPodContainers.length > 0) {
      setAvailableContainers(allPodContainers);
    }
  }, [allPodContainers]);

  // Handle container change
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
    }
  }, [selectedContainer]);

  // Search functionality
  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchAddonRef.current || !searchTerm) return;

    let searchPattern = searchTerm;

    // Process search term based on mode
    if (searchMode === 'regex') {
      // Use search term as-is for regex
      searchPattern = searchTerm;
    } else if (searchMode === 'grep') {
      // Convert grep-style wildcards to regex
      searchPattern = searchTerm
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&') // Escape special chars first
        .replace(/\\\*/g, '.*')  // * becomes .*
        .replace(/\\\?/g, '.');  // ? becomes .
    } else {
      // Simple mode - escape all special characters
      searchPattern = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const searchOptions = {
      regex: searchMode === 'regex' || searchMode === 'grep',
      caseSensitive: caseSensitive,
    };

    if (direction === 'next') {
      searchAddonRef.current.findNext(searchPattern, searchOptions);
    } else {
      searchAddonRef.current.findPrevious(searchPattern, searchOptions);
    }
  }, [searchTerm, searchMode, caseSensitive]);

  // Clear terminal
  const handleClear = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
      toast.success('Logs cleared');
    }
  }, []);

  // Download logs
  const handleDownload = useCallback(() => {
    const content = logBufferRef.current.replace(/\x1b\[[0-9;]*m/g, ''); // Strip ANSI codes
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${podName}-${selectedContainer || 'all'}-logs.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Logs downloaded successfully');
  }, [podName, selectedContainer]);

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
        </div>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          {/* Container Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4" />
            <Select value={selectedContainer} onValueChange={setSelectedContainer}>
              <SelectTrigger className="w-[140px] h-8">
                <SelectValue placeholder="All containers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All containers</SelectItem>
                {availableContainers.map((container) => (
                  <SelectItem key={container} value={container}>
                    {container}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Search */}
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4" />
            <Input
              placeholder="Search logs..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-48 h-8"
            />

            {/* Search Mode Selector */}
            <Select value={searchMode} onValueChange={(value: 'simple' | 'regex' | 'grep') => setSearchMode(value)}>
              <SelectTrigger className="w-[100px] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="simple">Simple</SelectItem>
                <SelectItem value="regex">
                  <div className="flex items-center">
                    <Regex className="h-4 w-4 mr-2" />
                    Regex
                  </div>
                </SelectItem>
                <SelectItem value="grep">Grep</SelectItem>
              </SelectContent>
            </Select>

            {/* Case Sensitive Toggle */}
            <Button
              variant={caseSensitive ? "default" : "outline"}
              size="sm"
              onClick={() => setCaseSensitive(!caseSensitive)}
              title="Case sensitive search"
              className="h-8 px-2"
            >
              Aa
            </Button>

            {searchTerm && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSearch('prev')}
                  className="h-6 w-6 p-0"
                >
                  <ChevronUp className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSearch('next')}
                  className="h-6 w-6 p-0"
                >
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </div>
            )}
          </div>

          <Separator orientation="vertical" className="h-6" />

          {/* Actions */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDownload}
            className="h-8 px-2"
          >
            <Download className="w-4 h-4" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-8 px-2"
          >
            <Trash2 className="w-4 h-4" />
          </Button>

          {viewControls && (
            <>
              <Separator orientation="vertical" className="h-6" />
              {viewControls}
            </>
          )}
        </div>
      </CardHeader>

      <LogRetrievalControls
        includePrevious={includePrevious}
        onIncludePreviousChange={handleIncludePreviousChange}
        logMode={logMode}
        onLogModeChange={handleLogModeChange}
        maxLines={maxLines}
        onMaxLinesChange={handleMaxLinesChange}
        podName={podName}
        namespace={namespace}
        configName={configName}
        clusterName={clusterName}
        containerName={selectedContainer !== 'all' ? selectedContainer : undefined}
      />

      <CardContent className="flex-1 p-0 min-h-0 overflow-hidden">
        <div ref={terminalRef} className="h-full w-full p-2" />
      </CardContent>
    </Card>
  );
};
