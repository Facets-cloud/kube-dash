import { useCallback, useEffect, useRef } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { ResizeDimensions } from '@/types/terminal';

interface UseTerminalResizeOptions {
  // Terminal instance ref
  terminalRef: React.RefObject<Terminal | null>;

  // Fit addon ref
  fitAddonRef: React.RefObject<FitAddon | null>;

  // Container element ref (for ResizeObserver)
  containerRef: React.RefObject<HTMLDivElement | null>;

  // Callback when terminal is resized
  onResize?: (dimensions: ResizeDimensions) => void;

  // Debounce delay in ms
  debounceDelay?: number;
}

interface UseTerminalResizeReturn {
  // Manually trigger a resize/fit
  fit: () => void;

  // Get current dimensions
  getDimensions: () => ResizeDimensions | null;
}

/**
 * Hook for managing terminal resize with debouncing
 * Handles window resize, container resize, and manual fit operations
 */
export function useTerminalResize(
  options: UseTerminalResizeOptions
): UseTerminalResizeReturn {
  const {
    terminalRef,
    fitAddonRef,
    containerRef,
    onResize,
    debounceDelay = 100,
  } = options;

  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastDimensions = useRef<ResizeDimensions | null>(null);

  // Get current terminal dimensions
  const getDimensions = useCallback((): ResizeDimensions | null => {
    const terminal = terminalRef.current;
    if (!terminal) return null;

    return {
      cols: terminal.cols,
      rows: terminal.rows,
    };
  }, [terminalRef]);

  // Perform fit operation with debouncing
  const fit = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }

    resizeTimeoutRef.current = setTimeout(() => {
      const fitAddon = fitAddonRef.current;
      const terminal = terminalRef.current;

      if (!fitAddon || !terminal) return;

      try {
        // Fit the terminal to its container
        fitAddon.fit();

        // Get new dimensions
        const newDimensions: ResizeDimensions = {
          cols: terminal.cols,
          rows: terminal.rows,
        };

        // Only trigger callback if dimensions actually changed
        if (
          !lastDimensions.current ||
          lastDimensions.current.cols !== newDimensions.cols ||
          lastDimensions.current.rows !== newDimensions.rows
        ) {
          lastDimensions.current = newDimensions;
          onResize?.(newDimensions);
        }
      } catch (error) {
        console.warn('Error fitting terminal:', error);
      }
    }, debounceDelay);
  }, [terminalRef, fitAddonRef, onResize, debounceDelay]);

  // Set up resize observers and event listeners
  useEffect(() => {
    const container = containerRef.current;

    // Window resize handler
    const handleWindowResize = () => {
      fit();
    };

    // ResizeObserver for container changes
    let resizeObserver: ResizeObserver | null = null;

    if (container) {
      resizeObserver = new ResizeObserver(() => {
        fit();
      });
      resizeObserver.observe(container);
    }

    // Listen for window resize
    window.addEventListener('resize', handleWindowResize);

    // Cleanup
    return () => {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      window.removeEventListener('resize', handleWindowResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [containerRef, fit]);

  return {
    fit,
    getDimensions,
  };
}

export default useTerminalResize;
