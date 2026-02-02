import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Maximize2,
  Minimize2,
  Settings,
  Copy,
  Search,
  X,
  Trash2,
} from 'lucide-react';

export interface TerminalToolbarProps {
  // Current state
  fontSize: number;
  isWebGLEnabled: boolean;
  isFullscreen: boolean;
  showSearch: boolean;
  searchTerm: string;

  // Feature toggles
  allowFullscreen: boolean;
  allowSearch: boolean;

  // Callbacks
  onFontSizeChange: (size: number) => void;
  onToggleWebGL: () => void;
  onToggleFullscreen: () => void;
  onToggleSearch: () => void;
  onSearchTermChange: (term: string) => void;
  onSearch: (term: string, forward: boolean) => void;
  onCloseSearch: () => void;
  onCopy: () => void;
  onClear: () => void;
}

export function TerminalToolbar({
  fontSize,
  isWebGLEnabled,
  isFullscreen,
  showSearch,
  searchTerm,
  allowFullscreen,
  allowSearch,
  onFontSizeChange,
  onToggleWebGL,
  onToggleFullscreen,
  onToggleSearch,
  onSearchTermChange,
  onSearch,
  onCloseSearch,
  onCopy,
  onClear,
}: TerminalToolbarProps) {
  return (
    <div className="border-b bg-muted/50">
      {/* Main Toolbar */}
      <div className="flex items-center justify-between p-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {isWebGLEnabled ? 'WebGL' : 'Canvas'}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {fontSize}px
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {/* Search Toggle */}
          {allowSearch && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleSearch}
              className="h-7 w-7 p-0"
              title="Search (Ctrl+Shift+F)"
            >
              <Search className="h-4 w-4" />
            </Button>
          )}

          {/* Copy Selection */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onCopy}
            className="h-7 w-7 p-0"
            title="Copy Selection (Ctrl+Shift+C)"
          >
            <Copy className="h-4 w-4" />
          </Button>

          {/* Clear Terminal */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="h-7 w-7 p-0"
            title="Clear Terminal"
          >
            <Trash2 className="h-4 w-4" />
          </Button>

          {/* Settings Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Terminal Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onFontSizeChange(fontSize - 1)}>
                Decrease Font Size
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onFontSizeChange(fontSize + 1)}>
                Increase Font Size
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onToggleWebGL}>
                {isWebGLEnabled ? 'Disable' : 'Enable'} WebGL
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Fullscreen Toggle */}
          {allowFullscreen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleFullscreen}
              className="h-7 w-7 p-0"
              title="Toggle Fullscreen (F11)"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Close Fullscreen */}
          {isFullscreen && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleFullscreen}
              className="h-7 w-7 p-0"
              title="Exit Fullscreen (Escape)"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Search Bar */}
      {showSearch && (
        <div className="flex items-center gap-2 p-2 border-t bg-muted/30">
          <Input
            placeholder="Search terminal..."
            value={searchTerm}
            onChange={(e) => onSearchTermChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSearch(searchTerm, !e.shiftKey);
              } else if (e.key === 'Escape') {
                onCloseSearch();
              }
            }}
            className="flex-1 h-7"
            autoFocus
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSearch(searchTerm, false)}
            className="h-7 px-2"
            title="Previous (Shift+Enter)"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSearch(searchTerm, true)}
            className="h-7 px-2"
            title="Next (Enter)"
          >
            ↓
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onCloseSearch}
            className="h-7 w-7 p-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

export default TerminalToolbar;
