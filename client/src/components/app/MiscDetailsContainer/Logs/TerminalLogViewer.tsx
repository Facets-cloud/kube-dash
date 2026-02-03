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
  // Store raw log entries for grep filtering
  const rawLogsRef = useRef<Array<{ container?: string; message: string }>>([]);
  // Refs for search state to avoid callback dependency issues
  const searchModeRef = useRef(searchMode);
  const searchTermRef = useRef(searchTerm);
  const caseSensitiveRef = useRef(caseSensitive);
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains('dark')
  );

  // Keep refs in sync with state
  useEffect(() => {
    searchModeRef.current = searchMode;
    searchTermRef.current = searchTerm;
    caseSensitiveRef.current = caseSensitive;
  }, [searchMode, searchTerm, caseSensitive]);

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

  // Theme configurations - memoized to avoid recreating on every render
  const lightTheme = React.useMemo(() => ({
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    black: '#1a1a1a',
    red: '#c00000',
    green: '#008000',
    yellow: '#b8860b',
    blue: '#0066cc',
    magenta: '#8b008b',
    cyan: '#008b8b',
    white: '#1a1a1a',
    brightBlack: '#4a4a4a',
    brightRed: '#ff0000',
    brightGreen: '#00aa00',
    brightYellow: '#ffaa00',
    brightBlue: '#0088ff',
    brightMagenta: '#cc00cc',
    brightCyan: '#00cccc',
    brightWhite: '#333333',
  }), []);

  const darkTheme = React.useMemo(() => ({
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
  }), []);

  // Initialize xterm
  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new XTerm({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
      theme: isDarkMode ? darkTheme : lightTheme,
      scrollback: 10000,
      allowProposedApi: true, // Required for search decorations
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

    // Observe theme changes
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName === 'class') {
          const isDark = document.documentElement.classList.contains('dark');
          setIsDarkMode(isDark);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
      term.dispose();
    };
  }, []);

  // Update xterm theme when dark mode changes
  useEffect(() => {
    if (xtermRef.current) {
      const newTheme = isDarkMode ? darkTheme : lightTheme;
      xtermRef.current.options.theme = newTheme;
      // Force a refresh to apply the new theme
      xtermRef.current.refresh(0, xtermRef.current.rows - 1);
    }
  }, [isDarkMode, darkTheme, lightTheme]);

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
      rawLogsRef.current = [];
    }
  }, []);

  const handleLogModeChange = useCallback((mode: 'all' | 'tail') => {
    setLogMode(mode);
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
      rawLogsRef.current = [];
    }
  }, []);

  const handleMaxLinesChange = useCallback((lines: number) => {
    setMaxLines(lines);
  }, []);

  const effectiveContainer = selectedContainer && selectedContainer !== 'all' ? selectedContainer : container;
  const effectiveAllContainers = selectedContainer === 'all' || (!selectedContainer && allContainers);

  // Helper function to check if a log message matches the grep pattern
  const matchesGrepPattern = useCallback((message: string, pattern: string, isCaseSensitive: boolean): boolean => {
    if (!pattern) return true;
    try {
      // Strip ANSI codes before matching
      const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
      const grepPattern = pattern
        .replace(/\*/g, '.*')  // * becomes .*
        .replace(/\?/g, '.');  // ? becomes .
      const searchRegex = new RegExp(grepPattern, isCaseSensitive ? 'g' : 'gi');
      return searchRegex.test(cleanMessage);
    } catch {
      // Invalid regex, fall back to simple contains check
      const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
      return isCaseSensitive
        ? cleanMessage.includes(pattern)
        : cleanMessage.toLowerCase().includes(pattern.toLowerCase());
    }
  }, []);

  // Re-render filtered logs when grep term changes
  const applyGrepFilter = useCallback(() => {
    if (!xtermRef.current) return;

    xtermRef.current.clear();
    logBufferRef.current = '';

    if (searchMode !== 'grep' || !searchTerm) {
      // Show all logs
      rawLogsRef.current.forEach(log => {
        const containerPrefix = log.container ? `\x1b[36m[${log.container}]\x1b[0m ` : '';
        const logLine = `${containerPrefix}${log.message}\r\n`;
        xtermRef.current!.write(logLine);
        logBufferRef.current += logLine;
      });
    } else {
      // Show only matching logs
      rawLogsRef.current.forEach(log => {
        if (matchesGrepPattern(log.message, searchTerm, caseSensitive)) {
          const containerPrefix = log.container ? `\x1b[36m[${log.container}]\x1b[0m ` : '';
          const logLine = `${containerPrefix}${log.message}\r\n`;
          xtermRef.current!.write(logLine);
          logBufferRef.current += logLine;
        }
      });
    }
  }, [searchMode, searchTerm, caseSensitive, matchesGrepPattern]);

  // Track previous search mode to detect mode changes
  const prevSearchModeRef = useRef(searchMode);

  // Apply grep filter when in grep mode, or restore all logs when switching away from grep
  useEffect(() => {
    const wasGrep = prevSearchModeRef.current === 'grep';
    const isGrep = searchMode === 'grep';
    prevSearchModeRef.current = searchMode;

    if (isGrep) {
      // In grep mode - apply filtering
      applyGrepFilter();
    } else if (wasGrep && !isGrep) {
      // Switched from grep to simple/regex - restore all logs
      applyGrepFilter(); // This will show all logs since searchMode !== 'grep'
    }
    // For simple/regex modes, the SearchAddon handles highlighting via handleSearch
  }, [searchTerm, searchMode, caseSensitive, applyGrepFilter]);

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

      // Store raw log entry for grep filtering
      rawLogsRef.current.push({
        container: logMessage.container,
        message: logMessage.message,
      });

      // Limit stored logs to prevent memory issues
      if (rawLogsRef.current.length > 10000) {
        rawLogsRef.current = rawLogsRef.current.slice(-5000);
      }

      // Check if we should display this log (grep filtering uses refs to avoid callback deps)
      const currentSearchMode = searchModeRef.current;
      const currentSearchTerm = searchTermRef.current;
      const currentCaseSensitive = caseSensitiveRef.current;

      const shouldDisplay = currentSearchMode !== 'grep' || !currentSearchTerm ||
        matchesGrepPattern(logMessage.message, currentSearchTerm, currentCaseSensitive);

      if (shouldDisplay) {
        const containerPrefix = logMessage.container ? `\x1b[36m[${logMessage.container}]\x1b[0m ` : '';
        const logLine = `${containerPrefix}${logMessage.message}\r\n`;
        xtermRef.current.write(logLine);
        logBufferRef.current += logLine;
      }

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
    }, [allPodContainers, matchesGrepPattern]),
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
      rawLogsRef.current = [];
    }
  }, [selectedContainer]);

  // Get search pattern based on mode
  const getSearchPattern = useCallback((term: string, mode: 'simple' | 'regex' | 'grep') => {
    if (mode === 'regex') {
      return term;
    } else if (mode === 'grep') {
      return term
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')
        .replace(/\\\?/g, '.');
    } else {
      return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }, []);

  // Search functionality
  const handleSearch = useCallback((direction: 'next' | 'prev') => {
    if (!searchAddonRef.current || !searchTerm) return;

    const searchPattern = getSearchPattern(searchTerm, searchMode);
    const searchOptions = {
      regex: searchMode === 'regex' || searchMode === 'grep',
      caseSensitive: caseSensitive,
      decorations: {
        matchBackground: '#FFFF00',
        matchBorder: '#FFFF00',
        matchOverviewRuler: '#FFFF00',
        activeMatchBackground: '#FF6600',
        activeMatchBorder: '#FF6600',
        activeMatchColorOverviewRuler: '#FF6600',
      },
    };

    if (direction === 'next') {
      searchAddonRef.current.findNext(searchPattern, searchOptions);
    } else {
      searchAddonRef.current.findPrevious(searchPattern, searchOptions);
    }
  }, [searchTerm, searchMode, caseSensitive, getSearchPattern]);

  // Auto-search when term changes in simple/regex mode (to show highlights)
  useEffect(() => {
    if (searchMode === 'grep') return; // Grep mode filters, doesn't highlight
    if (!searchAddonRef.current || !searchTerm) {
      // Clear search when term is empty
      searchAddonRef.current?.clearDecorations();
      return;
    }

    // Trigger search to show highlights
    const searchPattern = getSearchPattern(searchTerm, searchMode);
    const searchOptions = {
      regex: searchMode === 'regex',
      caseSensitive: caseSensitive,
      decorations: {
        matchBackground: '#FFFF00',
        matchBorder: '#FFFF00',
        matchOverviewRuler: '#FFFF00',
        activeMatchBackground: '#FF6600',
        activeMatchBorder: '#FF6600',
        activeMatchColorOverviewRuler: '#FF6600',
      },
    };

    // Use findNext to highlight matches
    searchAddonRef.current.findNext(searchPattern, searchOptions);
  }, [searchTerm, searchMode, caseSensitive, getSearchPattern]);

  // Clear terminal
  const handleClear = useCallback(() => {
    if (xtermRef.current) {
      xtermRef.current.clear();
      logBufferRef.current = '';
      rawLogsRef.current = [];
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
