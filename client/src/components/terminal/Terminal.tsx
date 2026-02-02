import '@xterm/xterm/css/xterm.css';

import { useCallback, useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';

import { useTerminalResize } from '@/hooks/terminal/useTerminalResize';
import { useTerminalTheme } from '@/hooks/terminal/useTerminalTheme';
import { TerminalToolbar } from './TerminalToolbar';
import { TerminalStatusBar } from './TerminalStatusBar';
import {
  ResizeDimensions,
  ConnectionStatus,
  DEFAULT_TERMINAL_OPTIONS,
} from '@/types/terminal';

export interface TerminalProps {
  // Connection status for status bar
  status?: ConnectionStatus;
  statusMessage?: string;

  // Feature toggles
  enableWebGL?: boolean;
  allowFullscreen?: boolean;
  allowSearch?: boolean;
  showToolbar?: boolean;
  showStatusBar?: boolean;

  // Dimensions
  initialCols?: number;
  initialRows?: number;

  // Font settings
  fontSize?: number;
  fontFamily?: string;

  // Scrollback buffer
  scrollback?: number;

  // Callbacks
  onData?: (data: string) => void;
  onResize?: (dimensions: ResizeDimensions) => void;

  // Styling
  className?: string;
}

export interface TerminalRef {
  // Terminal instance
  terminal: XTerm | null;

  // Search addon for external search control
  searchAddon: SearchAddon | null;

  // Methods
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
  focus: () => void;
  fit: () => void;
  scrollToBottom: () => void;
  getSelection: () => string;
}

/**
 * Reusable Terminal component with xterm.js
 * Supports WebGL rendering, search, fullscreen, and theme sync
 */
export const Terminal = forwardRef<TerminalRef, TerminalProps>((props, ref) => {
  const {
    status = 'disconnected',
    statusMessage,
    enableWebGL = DEFAULT_TERMINAL_OPTIONS.enableWebGL,
    allowFullscreen = DEFAULT_TERMINAL_OPTIONS.allowFullscreen,
    allowSearch = DEFAULT_TERMINAL_OPTIONS.allowSearch,
    showToolbar = true,
    showStatusBar = true,
    initialCols = DEFAULT_TERMINAL_OPTIONS.initialCols,
    initialRows = DEFAULT_TERMINAL_OPTIONS.initialRows,
    fontSize: initialFontSize = DEFAULT_TERMINAL_OPTIONS.fontSize,
    fontFamily = DEFAULT_TERMINAL_OPTIONS.fontFamily,
    scrollback = DEFAULT_TERMINAL_OPTIONS.scrollback,
    onData,
    onResize,
    className = '',
  } = props;

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const webglAddonRef = useRef<WebglAddon | null>(null);
  const webLinksAddonRef = useRef<WebLinksAddon | null>(null);

  // Keep latest callbacks in refs to avoid stale closures
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);

  // State
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fontSize, setFontSize] = useState(initialFontSize);
  const [isWebGLEnabled, setIsWebGLEnabled] = useState(enableWebGL);
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Keep callback refs updated
  useEffect(() => {
    onDataRef.current = onData;
  }, [onData]);

  useEffect(() => {
    onResizeRef.current = onResize;
  }, [onResize]);

  // Theme hook
  const { theme } = useTerminalTheme({ terminalRef });

  // Resize hook
  const { fit, getDimensions } = useTerminalResize({
    terminalRef,
    fitAddonRef,
    containerRef,
    onResize,
    debounceDelay: 100,
  });

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    terminal: terminalRef.current,
    searchAddon: searchAddonRef.current,

    write: (data: string) => {
      terminalRef.current?.write(data);
    },

    writeln: (data: string) => {
      terminalRef.current?.writeln(data);
    },

    clear: () => {
      terminalRef.current?.clear();
    },

    focus: () => {
      terminalRef.current?.focus();
    },

    fit: () => {
      fit();
    },

    scrollToBottom: () => {
      terminalRef.current?.scrollToBottom();
    },

    getSelection: () => {
      return terminalRef.current?.getSelection() || '';
    },
  }), [fit]);

  // Toggle fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!allowFullscreen) return;

    setIsFullscreen((prev) => {
      const newValue = !prev;
      // Fit after transition
      requestAnimationFrame(() => {
        setTimeout(fit, 100);
      });
      return newValue;
    });
  }, [allowFullscreen, fit]);

  // Handle search
  const handleSearch = useCallback((term: string, forward = true) => {
    if (!searchAddonRef.current || !term) return;

    if (forward) {
      searchAddonRef.current.findNext(term, { caseSensitive: false });
    } else {
      searchAddonRef.current.findPrevious(term, { caseSensitive: false });
    }
  }, []);

  // Copy selection
  const copySelection = useCallback(() => {
    const selection = terminalRef.current?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    }
  }, []);

  // Change font size
  const changeFontSize = useCallback((newSize: number) => {
    if (newSize < 8 || newSize > 24) return;

    setFontSize(newSize);
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = newSize;
      fit();
    }
  }, [fit]);

  // Toggle WebGL
  const toggleWebGL = useCallback(() => {
    if (!terminalRef.current) return;

    const newState = !isWebGLEnabled;
    setIsWebGLEnabled(newState);

    if (newState && !webglAddonRef.current) {
      try {
        webglAddonRef.current = new WebglAddon();
        terminalRef.current.loadAddon(webglAddonRef.current);

        webglAddonRef.current.onContextLoss(() => {
          console.warn('WebGL context lost, falling back to canvas');
          webglAddonRef.current?.dispose();
          webglAddonRef.current = null;
          setIsWebGLEnabled(false);
        });
      } catch (error) {
        console.warn('Failed to enable WebGL:', error);
        setIsWebGLEnabled(false);
      }
    } else if (!newState && webglAddonRef.current) {
      webglAddonRef.current.dispose();
      webglAddonRef.current = null;
    }
  }, [isWebGLEnabled]);

  // Clear terminal
  const clearTerminal = useCallback(() => {
    terminalRef.current?.clear();
  }, []);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;

    // Create terminal instance
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'block',
      theme: theme,
      scrollback,
      fontSize,
      fontFamily,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      lineHeight: 1.2,
      letterSpacing: 0,
      allowTransparency: false,
      convertEol: true,
      windowsMode: false,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5,
      scrollSensitivity: 3,
      macOptionIsMeta: true,
      macOptionClickForcesSelection: false,
      rightClickSelectsWord: true,
      cols: initialCols,
      rows: initialRows,
      smoothScrollDuration: 0,
      disableStdin: false,
      allowProposedApi: true,
    });

    terminalRef.current = terminal;

    // Load addons
    fitAddonRef.current = new FitAddon();
    searchAddonRef.current = new SearchAddon();
    webLinksAddonRef.current = new WebLinksAddon();

    terminal.loadAddon(fitAddonRef.current);
    terminal.loadAddon(searchAddonRef.current);
    terminal.loadAddon(webLinksAddonRef.current);

    // Load WebGL addon if enabled
    if (enableWebGL) {
      try {
        webglAddonRef.current = new WebglAddon();
        terminal.loadAddon(webglAddonRef.current);

        webglAddonRef.current.onContextLoss(() => {
          console.warn('WebGL context lost, falling back to canvas');
          webglAddonRef.current?.dispose();
          webglAddonRef.current = null;
          setIsWebGLEnabled(false);
        });
      } catch (error) {
        console.warn('Failed to enable WebGL:', error);
        setIsWebGLEnabled(false);
      }
    }

    // Open terminal in container
    terminal.open(containerRef.current);

    // Add input handler - use ref to always get latest callback
    terminal.onData((data) => {
      if (onDataRef.current) {
        onDataRef.current(data);
      }
    });

    // Initial fit
    fitAddonRef.current.fit();

    // Notify of initial dimensions - use ref to always get latest callback
    if (onResizeRef.current) {
      onResizeRef.current({
        cols: terminal.cols,
        rows: terminal.rows,
      });
    }

    // Keyboard shortcuts
    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+Shift+F for search
      if (event.ctrlKey && event.shiftKey && event.key === 'F') {
        if (allowSearch) setShowSearch(true);
        return false;
      }
      // Ctrl+Shift+C for copy
      if (event.ctrlKey && event.shiftKey && event.key === 'C') {
        copySelection();
        return false;
      }
      // F11 for fullscreen
      if (event.key === 'F11' && allowFullscreen) {
        event.preventDefault();
        toggleFullscreen();
        return false;
      }
      return true;
    });

    // Cleanup
    return () => {
      webglAddonRef.current?.dispose();
      terminal.dispose();
    };
  }, []); // Empty deps - only run once on mount

  // Handle escape key for fullscreen exit
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  const containerClass = `
    flex flex-col
    ${isFullscreen ? 'fixed inset-0 z-50 bg-background' : 'w-full h-full relative'}
    ${className}
  `.trim();

  return (
    <div className={containerClass}>
      {showToolbar && (
        <TerminalToolbar
          fontSize={fontSize}
          isWebGLEnabled={isWebGLEnabled}
          isFullscreen={isFullscreen}
          showSearch={showSearch}
          searchTerm={searchTerm}
          allowFullscreen={allowFullscreen}
          allowSearch={allowSearch}
          onFontSizeChange={changeFontSize}
          onToggleWebGL={toggleWebGL}
          onToggleFullscreen={toggleFullscreen}
          onToggleSearch={() => setShowSearch(!showSearch)}
          onSearchTermChange={setSearchTerm}
          onSearch={handleSearch}
          onCloseSearch={() => {
            setShowSearch(false);
            setSearchTerm('');
          }}
          onCopy={copySelection}
          onClear={clearTerminal}
        />
      )}

      {/* Terminal Container */}
      <div
        ref={containerRef}
        className="flex-1 w-full cursor-text"
        style={{
          height: isFullscreen ? 'calc(100vh - 100px)' : 'calc(100vh - 220px)',
          minHeight: '500px'
        }}
        onClick={() => terminalRef.current?.focus()}
      />

      {showStatusBar && (
        <TerminalStatusBar
          status={status}
          message={statusMessage}
          dimensions={getDimensions()}
        />
      )}
    </div>
  );
});

Terminal.displayName = 'Terminal';

export default Terminal;
