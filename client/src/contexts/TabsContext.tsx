import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';

export interface Tab {
  id: string;
  title: string;
  resourceType?: string;
  resourceName?: string;
  namespace?: string;
  cluster?: string;
  config?: string;
  route: string;
  icon?: string;
  isActive: boolean;
  isPinned?: boolean;
  isDirty?: boolean; // Has unsaved changes
  timestamp: number; // For "recently closed" feature
}

interface TabsContextValue {
  tabs: Tab[];
  activeTabId: string | null;
  addTab: (tab: Omit<Tab, 'id' | 'isActive' | 'timestamp'>) => string;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  updateTab: (id: string, updates: Partial<Tab>) => void;
  closeOtherTabs: (id: string) => void;
  closeAllTabs: () => void;
  closeTabsToRight: (id: string) => void;
  duplicateTab: (id: string) => void;
  pinTab: (id: string) => void;
  unpinTab: (id: string) => void;
  reorderTabs: (startIndex: number, endIndex: number) => void;
  getTabByRoute: (route: string) => Tab | undefined;
  reopenClosedTab: () => void;
  closedTabs: Tab[];
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined);

const STORAGE_KEY = 'kube-dash-tabs';
const CLOSED_TABS_KEY = 'kube-dash-closed-tabs';
const MAX_CLOSED_TABS = 10;

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const TabsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [closedTabs, setClosedTabs] = useState<Tab[]>([]);
  const saveTimeoutRef = useRef<NodeJS.Timeout>();

  // Load tabs from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedClosed = localStorage.getItem(CLOSED_TABS_KEY);
    let initialized = false;

    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0) {
          setTabs(data.tabs);
          setActiveTabId(data.activeTabId || data.tabs[0]?.id || null);
          initialized = true;
        }
      } catch (error) {
        console.error('Failed to restore tabs:', error);
      }
    }

    // If no tabs were restored, create initial tab from current route
    if (!initialized && location.pathname) {
      const initialTabId = generateTabId();
      const initialTab: Tab = {
        id: initialTabId,
        title: 'Pods',
        route: location.pathname,
        icon: 'pod',
        isActive: true,
        timestamp: Date.now(),
      };
      setTabs([initialTab]);
      setActiveTabId(initialTabId);
    }

    if (savedClosed) {
      try {
        const data = JSON.parse(savedClosed);
        setClosedTabs(data.slice(0, MAX_CLOSED_TABS));
      } catch (error) {
        console.error('Failed to restore closed tabs:', error);
      }
    }
  }, [location.pathname]);

  // Save tabs to localStorage (debounced)
  useEffect(() => {
    if (tabs.length === 0) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          tabs,
          activeTabId,
          timestamp: Date.now(),
        }));
      } catch (error) {
        console.error('Failed to save tabs:', error);
      }
    }, 500);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tabs, activeTabId]);

  // Save closed tabs
  useEffect(() => {
    try {
      localStorage.setItem(CLOSED_TABS_KEY, JSON.stringify(closedTabs));
    } catch (error) {
      console.error('Failed to save closed tabs:', error);
    }
  }, [closedTabs]);

  const addTab = useCallback((tab: Omit<Tab, 'id' | 'isActive' | 'timestamp'>): string => {
    const tabId = generateTabId();
    const newTab: Tab = {
      ...tab,
      id: tabId,
      isActive: true,
      timestamp: Date.now(),
    };

    setTabs(prevTabs => {
      // Deactivate all other tabs
      const updatedTabs = prevTabs.map(t => ({ ...t, isActive: false }));
      return [...updatedTabs, newTab];
    });
    setActiveTabId(tabId);

    // Navigate to the tab's route
    if (tab.route && tab.route !== location.pathname) {
      navigate({ to: tab.route } as any);
    }

    return tabId;
  }, [navigate, location]);

  const closeTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      const tabIndex = prevTabs.findIndex(t => t.id === id);
      if (tabIndex === -1) return prevTabs;

      const closingTab = prevTabs[tabIndex];
      const isActive = closingTab.isActive;

      // Add to closed tabs if not pinned
      if (!closingTab.isPinned) {
        setClosedTabs(prev => [closingTab, ...prev].slice(0, MAX_CLOSED_TABS));
      }

      const newTabs = prevTabs.filter(t => t.id !== id);

      // If closing active tab, activate another tab
      if (isActive && newTabs.length > 0) {
        // Try to activate the tab to the right, otherwise the one to the left
        const newActiveIndex = Math.min(tabIndex, newTabs.length - 1);
        const newActiveTab = newTabs[newActiveIndex];

        newTabs[newActiveIndex] = { ...newActiveTab, isActive: true };
        setActiveTabId(newActiveTab.id);

        // Navigate to the new active tab
        if (newActiveTab.route) {
          navigate({ to: newActiveTab.route } as any);
        }
      }

      return newTabs;
    });
  }, [navigate]);

  const switchTab = useCallback((id: string) => {
    setTabs(prevTabs => {
      const tab = prevTabs.find(t => t.id === id);
      if (!tab) return prevTabs;

      const updatedTabs = prevTabs.map(t => ({
        ...t,
        isActive: t.id === id,
      }));

      setActiveTabId(id);

      // Navigate to the tab's route
      if (tab.route && tab.route !== location.pathname) {
        navigate({ to: tab.route } as any);
      }

      return updatedTabs;
    });
  }, [navigate, location]);

  const updateTab = useCallback((id: string, updates: Partial<Tab>) => {
    setTabs(prevTabs =>
      prevTabs.map(t => (t.id === id ? { ...t, ...updates } : t))
    );
  }, []);

  const closeOtherTabs = useCallback((id: string) => {
    setTabs(prevTabs => {
      const tabToKeep = prevTabs.find(t => t.id === id);
      if (!tabToKeep) return prevTabs;

      // Also keep pinned tabs
      const pinnedTabs = prevTabs.filter(t => t.isPinned && t.id !== id);
      const closingTabs = prevTabs.filter(t => t.id !== id && !t.isPinned);

      // Add closing tabs to closed tabs history
      setClosedTabs(prev => [...closingTabs, ...prev].slice(0, MAX_CLOSED_TABS));

      // Navigate to the kept tab
      if (tabToKeep.route) {
        navigate({ to: tabToKeep.route } as any);
      }

      return [...pinnedTabs, { ...tabToKeep, isActive: true }];
    });
    setActiveTabId(id);
  }, [navigate]);

  const closeAllTabs = useCallback(() => {
    setClosedTabs(prev => [...tabs.filter(t => !t.isPinned), ...prev].slice(0, MAX_CLOSED_TABS));
    setTabs([]);
    setActiveTabId(null);
  }, [tabs]);

  const closeTabsToRight = useCallback((id: string) => {
    setTabs(prevTabs => {
      const index = prevTabs.findIndex(t => t.id === id);
      if (index === -1) return prevTabs;

      const tabsToClose = prevTabs.slice(index + 1).filter(t => !t.isPinned);
      const closingActiveTab = tabsToClose.some(t => t.isActive);

      setClosedTabs(prev => [...tabsToClose, ...prev].slice(0, MAX_CLOSED_TABS));

      const remainingTabs = prevTabs.slice(0, index + 1);

      // If we closed the active tab, navigate to the current tab
      if (closingActiveTab) {
        const currentTab = prevTabs[index];
        if (currentTab.route) {
          navigate({ to: currentTab.route } as any);
        }
        return remainingTabs.map(t => ({ ...t, isActive: t.id === id }));
      }

      return remainingTabs;
    });
  }, [navigate]);

  const duplicateTab = useCallback((id: string) => {
    const tab = tabs.find(t => t.id === id);
    if (!tab) return;

    addTab({
      title: tab.title,
      resourceType: tab.resourceType,
      resourceName: tab.resourceName,
      namespace: tab.namespace,
      cluster: tab.cluster,
      config: tab.config,
      route: tab.route,
      icon: tab.icon,
    });
  }, [tabs, addTab]);

  const pinTab = useCallback((id: string) => {
    updateTab(id, { isPinned: true });
  }, [updateTab]);

  const unpinTab = useCallback((id: string) => {
    updateTab(id, { isPinned: false });
  }, [updateTab]);

  const reorderTabs = useCallback((startIndex: number, endIndex: number) => {
    setTabs(prevTabs => {
      const result = Array.from(prevTabs);
      const [removed] = result.splice(startIndex, 1);
      result.splice(endIndex, 0, removed);
      return result;
    });
  }, []);

  const getTabByRoute = useCallback((route: string): Tab | undefined => {
    return tabs.find(t => t.route === route);
  }, [tabs]);

  const reopenClosedTab = useCallback(() => {
    if (closedTabs.length === 0) return;

    const [lastClosed, ...rest] = closedTabs;
    setClosedTabs(rest);

    addTab({
      title: lastClosed.title,
      resourceType: lastClosed.resourceType,
      resourceName: lastClosed.resourceName,
      namespace: lastClosed.namespace,
      cluster: lastClosed.cluster,
      config: lastClosed.config,
      route: lastClosed.route,
      icon: lastClosed.icon,
    });
  }, [closedTabs, addTab]);

  const value: TabsContextValue = {
    tabs,
    activeTabId,
    addTab,
    closeTab,
    switchTab,
    updateTab,
    closeOtherTabs,
    closeAllTabs,
    closeTabsToRight,
    duplicateTab,
    pinTab,
    unpinTab,
    reorderTabs,
    getTabByRoute,
    reopenClosedTab,
    closedTabs,
  };

  return <TabsContext.Provider value={value}>{children}</TabsContext.Provider>;
};

export const useTabs = (): TabsContextValue => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('useTabs must be used within a TabsProvider');
  }
  return context;
};
