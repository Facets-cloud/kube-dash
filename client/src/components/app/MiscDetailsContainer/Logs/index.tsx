import './index.css';
import { useState } from 'react';
import { TerminalLogViewer } from "./TerminalLogViewer";
import { PodLogsViewer } from "./PodLogsViewer";
import { PodDetails } from '@/types';
import { Button } from '@/components/ui/button';
import { Maximize2, Minimize2, Monitor, List } from 'lucide-react';

type PodLogsProps = {
  namespace: string;
  name: string;
  configName: string;
  clusterName: string;
  podDetails?: PodDetails;
}

const PodLogs = ({ namespace, name, configName, clusterName, podDetails }: PodLogsProps) => {
  const [viewMode, setViewMode] = useState<'terminal' | 'classic'>('terminal');
  const [isExpanded, setIsExpanded] = useState(false);

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  const LogViewer = viewMode === 'terminal' ? TerminalLogViewer : PodLogsViewer;

  const ViewerComponent = (
    <LogViewer
      podName={name}
      namespace={namespace}
      configName={configName}
      clusterName={clusterName}
      podDetails={podDetails}
      className="h-full"
      isFullscreen={isExpanded}
      viewControls={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setViewMode(viewMode === 'terminal' ? 'classic' : 'terminal')}
            className="h-7 px-2"
            title={`Switch to ${viewMode === 'terminal' ? 'Classic' : 'Terminal'} view`}
          >
            {viewMode === 'terminal' ? (
              <List className="w-4 h-4" />
            ) : (
              <Monitor className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleExpanded}
            className="h-7 px-2"
            title={isExpanded ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
        </div>
      }
    />
  );

  if (isExpanded) {
    return (
      <div className="fixed inset-0 z-[100] bg-background">
        {ViewerComponent}
      </div>
    );
  }

  return ViewerComponent;
};

export {
  PodLogs
};