import { Badge } from '@/components/ui/badge';
import { ConnectionStatus, ResizeDimensions } from '@/types/terminal';
import { Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

export interface TerminalStatusBarProps {
  status: ConnectionStatus;
  message?: string;
  dimensions?: ResizeDimensions | null;
}

function getStatusIcon(status: ConnectionStatus) {
  switch (status) {
    case 'connecting':
      return <Loader2 className="h-3 w-3 animate-spin" />;
    case 'connected':
      return <CheckCircle2 className="h-3 w-3" />;
    case 'disconnected':
      return <XCircle className="h-3 w-3" />;
    case 'error':
      return <AlertCircle className="h-3 w-3" />;
  }
}

function getStatusColor(status: ConnectionStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'connecting':
      return 'secondary';
    case 'connected':
      return 'default';
    case 'disconnected':
      return 'outline';
    case 'error':
      return 'destructive';
  }
}

function getStatusText(status: ConnectionStatus): string {
  switch (status) {
    case 'connecting':
      return 'Connecting...';
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Disconnected';
    case 'error':
      return 'Error';
  }
}

export function TerminalStatusBar({
  status,
  message,
  dimensions,
}: TerminalStatusBarProps) {
  return (
    <div className="flex items-center justify-between px-2 py-1 border-t bg-muted/30 text-xs">
      {/* Left side - Connection status */}
      <div className="flex items-center gap-2">
        <Badge
          variant={getStatusColor(status)}
          className="flex items-center gap-1 text-xs h-5"
        >
          {getStatusIcon(status)}
          <span>{getStatusText(status)}</span>
        </Badge>

        {message && (
          <span className="text-muted-foreground truncate max-w-[300px]">
            {message}
          </span>
        )}
      </div>

      {/* Right side - Dimensions */}
      {dimensions && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span>
            {dimensions.cols} x {dimensions.rows}
          </span>
        </div>
      )}
    </div>
  );
}

export default TerminalStatusBar;
