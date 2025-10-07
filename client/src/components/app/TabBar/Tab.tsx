import React, { useState, useRef, useEffect } from 'react';
import { X, Pin, Copy, ChevronRight } from 'lucide-react';
import { useTabs, Tab as TabType } from '../../../contexts/TabsContext';
import { DraggableProvidedDragHandleProps, DraggableProvidedDraggableProps } from '@hello-pangea/dnd';
import './Tab.css';

interface TabProps {
  tab: TabType;
  isActive: boolean;
  isDragging: boolean;
  onClick: () => void;
  onClose: () => void;
  dragHandleProps?: DraggableProvidedDragHandleProps | null;
  draggableProps?: DraggableProvidedDraggableProps;
  innerRef?: (element: HTMLElement | null) => void;
}

export const Tab: React.FC<TabProps> = ({
  tab,
  isActive,
  isDragging,
  onClick,
  onClose,
  dragHandleProps,
  draggableProps,
  innerRef,
}) => {
  const { pinTab, unpinTab, duplicateTab, closeOtherTabs, closeTabsToRight } = useTabs();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Handle right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setShowContextMenu(false);
      }
    };

    if (showContextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showContextMenu]);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!tab.isPinned) {
      onClose();
    }
  };

  const handlePinToggle = () => {
    if (tab.isPinned) {
      unpinTab(tab.id);
    } else {
      pinTab(tab.id);
    }
    setShowContextMenu(false);
  };

  const handleDuplicate = () => {
    duplicateTab(tab.id);
    setShowContextMenu(false);
  };

  const handleCloseOthers = () => {
    closeOtherTabs(tab.id);
    setShowContextMenu(false);
  };

  const handleCloseToRight = () => {
    closeTabsToRight(tab.id);
    setShowContextMenu(false);
  };

  return (
    <>
      <div
        ref={innerRef}
        className={`tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${tab.isPinned ? 'pinned' : ''}`}
        onClick={onClick}
        onContextMenu={handleContextMenu}
        {...draggableProps}
        {...dragHandleProps}
      >
        <span className="tab-title" title={tab.title}>
          {tab.title}
        </span>

        {tab.isDirty && <span className="tab-dirty-indicator">•</span>}

        {tab.isPinned && (
          <Pin size={12} className="tab-pin-icon" />
        )}

        <button
          className="tab-close"
          onClick={handleClose}
          title={tab.isPinned ? 'Unpin to close' : 'Close (Ctrl+W)'}
          disabled={tab.isPinned}
        >
          <X size={14} />
        </button>
      </div>

      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="tab-context-menu"
          style={{
            position: 'fixed',
            top: contextMenuPos.y,
            left: contextMenuPos.x,
            zIndex: 10000,
          }}
        >
          <button onClick={handlePinToggle} className="context-menu-item">
            <Pin size={14} />
            {tab.isPinned ? 'Unpin Tab' : 'Pin Tab'}
          </button>

          <button onClick={handleDuplicate} className="context-menu-item">
            <Copy size={14} />
            Duplicate Tab
          </button>

          <div className="context-menu-divider" />

          <button onClick={() => { onClose(); setShowContextMenu(false); }} className="context-menu-item">
            <X size={14} />
            Close Tab
          </button>

          <button onClick={handleCloseOthers} className="context-menu-item">
            <X size={14} />
            Close Other Tabs
          </button>

          <button onClick={handleCloseToRight} className="context-menu-item">
            <ChevronRight size={14} />
            Close Tabs to the Right
          </button>
        </div>
      )}
    </>
  );
};
