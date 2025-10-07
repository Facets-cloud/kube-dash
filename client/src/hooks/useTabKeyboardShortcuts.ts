import { useHotkeys } from 'react-hotkeys-hook';
import { useTabs } from '../contexts/TabsContext';

export const useTabKeyboardShortcuts = () => {
  const {
    tabs,
    activeTabId,
    closeTab,
    switchTab,
    addTab,
    reopenClosedTab,
    closeAllTabs
  } = useTabs();

  // Close current tab (Ctrl/Cmd + W)
  useHotkeys('mod+w', (e) => {
    e.preventDefault();
    if (activeTabId) {
      closeTab(activeTabId);
    }
  }, [activeTabId, closeTab]);

  // New tab (Ctrl/Cmd + T)
  useHotkeys('mod+t', (e) => {
    e.preventDefault();
    addTab({
      title: 'Home',
      route: '/',
      icon: 'home',
    });
  }, [addTab]);

  // Reopen closed tab (Ctrl/Cmd + Shift + T)
  useHotkeys('mod+shift+t', (e) => {
    e.preventDefault();
    reopenClosedTab();
  }, [reopenClosedTab]);

  // Switch to next tab (Ctrl/Cmd + Tab)
  useHotkeys('mod+tab', (e) => {
    e.preventDefault();
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex !== -1 && tabs.length > 1) {
      const nextIndex = (currentIndex + 1) % tabs.length;
      switchTab(tabs[nextIndex].id);
    }
  }, [tabs, activeTabId, switchTab]);

  // Switch to previous tab (Ctrl/Cmd + Shift + Tab)
  useHotkeys('mod+shift+tab', (e) => {
    e.preventDefault();
    const currentIndex = tabs.findIndex(t => t.id === activeTabId);
    if (currentIndex !== -1 && tabs.length > 1) {
      const prevIndex = currentIndex === 0 ? tabs.length - 1 : currentIndex - 1;
      switchTab(tabs[prevIndex].id);
    }
  }, [tabs, activeTabId, switchTab]);

  // Switch to tab by number (Ctrl/Cmd + 1-9)
  useHotkeys('mod+1', (e) => {
    e.preventDefault();
    if (tabs[0]) switchTab(tabs[0].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+2', (e) => {
    e.preventDefault();
    if (tabs[1]) switchTab(tabs[1].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+3', (e) => {
    e.preventDefault();
    if (tabs[2]) switchTab(tabs[2].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+4', (e) => {
    e.preventDefault();
    if (tabs[3]) switchTab(tabs[3].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+5', (e) => {
    e.preventDefault();
    if (tabs[4]) switchTab(tabs[4].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+6', (e) => {
    e.preventDefault();
    if (tabs[5]) switchTab(tabs[5].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+7', (e) => {
    e.preventDefault();
    if (tabs[6]) switchTab(tabs[6].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+8', (e) => {
    e.preventDefault();
    if (tabs[7]) switchTab(tabs[7].id);
  }, [tabs, switchTab]);

  useHotkeys('mod+9', (e) => {
    e.preventDefault();
    // Switch to last tab
    if (tabs.length > 0) switchTab(tabs[tabs.length - 1].id);
  }, [tabs, switchTab]);

  // Close all tabs (Ctrl/Cmd + Shift + W)
  useHotkeys('mod+shift+w', (e) => {
    e.preventDefault();
    if (confirm('Close all tabs?')) {
      closeAllTabs();
    }
  }, [closeAllTabs]);
};
