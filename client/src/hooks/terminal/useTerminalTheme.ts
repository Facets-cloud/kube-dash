import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Terminal } from '@xterm/xterm';
import { TerminalTheme } from '@/types/terminal';
import { getSystemTheme } from '@/utils';
import { useTheme } from '@/components/app/ThemeProvider';

// Dark theme inspired by GitHub Dark
export const DARK_THEME: TerminalTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#645DF6',          // Facets primary color
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

// Light theme inspired by GitHub Light
export const LIGHT_THEME: TerminalTheme = {
  background: '#ffffff',
  foreground: '#1f2328',
  cursor: '#645DF6',          // Facets primary color
  cursorAccent: '#ffffff',
  selectionBackground: '#0969da',
  selectionForeground: '#ffffff',
  black: '#1f2328',
  red: '#d1242f',
  green: '#116329',
  yellow: '#4d2d00',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#656d76',
  brightRed: '#a40e26',
  brightGreen: '#0d5016',
  brightYellow: '#633c01',
  brightBlue: '#0550ae',
  brightMagenta: '#6639ba',
  brightCyan: '#1b7c83',
  brightWhite: '#1f2328',
};

type ThemeMode = 'dark' | 'light';

interface UseTerminalThemeOptions {
  // Terminal instance ref
  terminalRef: React.RefObject<Terminal | null>;

  // Force a specific theme mode (overrides auto-detection)
  forcedTheme?: ThemeMode;
}

interface UseTerminalThemeReturn {
  // Current theme mode
  mode: ThemeMode;

  // Current theme object
  theme: TerminalTheme;

  // Toggle between light and dark
  toggleTheme: () => void;

  // Set a specific theme mode
  setThemeMode: (mode: ThemeMode) => void;

  // Is currently using dark mode
  isDark: boolean;
}

/**
 * Hook for managing terminal theme
 * Syncs with system theme and application theme
 */
export function useTerminalTheme(
  options: UseTerminalThemeOptions
): UseTerminalThemeReturn {
  const { terminalRef, forcedTheme } = options;

  // Get application theme context
  const { theme: appTheme } = useTheme();

  // Determine initial theme mode
  const getInitialMode = useCallback((): ThemeMode => {
    if (forcedTheme) return forcedTheme;

    const systemTheme = getSystemTheme();
    return systemTheme === 'vs-dark' ? 'dark' : 'light';
  }, [forcedTheme]);

  const [mode, setMode] = useState<ThemeMode>(getInitialMode);

  // Get theme object based on mode
  const theme = useMemo<TerminalTheme>(() => {
    return mode === 'dark' ? DARK_THEME : LIGHT_THEME;
  }, [mode]);

  // Apply theme to terminal
  const applyTheme = useCallback(
    (themeToApply: TerminalTheme) => {
      const terminal = terminalRef.current;
      if (terminal) {
        terminal.options.theme = themeToApply;
      }
    },
    [terminalRef]
  );

  // Toggle between light and dark
  const toggleTheme = useCallback(() => {
    setMode((prevMode) => (prevMode === 'dark' ? 'light' : 'dark'));
  }, []);

  // Set a specific theme mode
  const setThemeMode = useCallback((newMode: ThemeMode) => {
    setMode(newMode);
  }, []);

  // Apply theme when mode changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  // Listen for system/app theme changes
  useEffect(() => {
    // Skip if theme is forced
    if (forcedTheme) return;

    const updateTheme = () => {
      const systemTheme = getSystemTheme();
      const newMode: ThemeMode = systemTheme === 'vs-dark' ? 'dark' : 'light';
      setMode(newMode);
    };

    // Update immediately
    updateTheme();

    // Listen for storage changes (theme preference changes)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'kw-ui-theme') {
        updateTheme();
      }
    };

    // Listen for system theme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = () => {
      if (appTheme === 'system') {
        updateTheme();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, [forcedTheme, appTheme]);

  return {
    mode,
    theme,
    toggleTheme,
    setThemeMode,
    isDark: mode === 'dark',
  };
}

export default useTerminalTheme;
