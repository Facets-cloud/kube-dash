import React from 'react';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { useTabs } from '../../../contexts/TabsContext';
import { Tab } from './Tab';
import './TabBar.css';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, switchTab, closeTab, reorderTabs } = useTabs();

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    reorderTabs(result.source.index, result.destination.index);
  };

  return (
    <div className="tab-bar">
      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="tabs" direction="horizontal">
          {(provided) => (
            <div
              className="tab-list"
              ref={provided.innerRef}
              {...provided.droppableProps}
            >
              {tabs.map((tab, index) => (
                <Draggable key={tab.id} draggableId={tab.id} index={index}>
                  {(provided, snapshot) => (
                    <Tab
                      tab={tab}
                      isActive={tab.id === activeTabId}
                      isDragging={snapshot.isDragging}
                      onClick={() => switchTab(tab.id)}
                      onClose={() => closeTab(tab.id)}
                      dragHandleProps={provided.dragHandleProps}
                      draggableProps={provided.draggableProps}
                      innerRef={provided.innerRef}
                    />
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
};
