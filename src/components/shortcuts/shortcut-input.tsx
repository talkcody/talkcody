import { RotateCcw, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLocale } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  parseShortcutString,
  type ShortcutAction,
  type ShortcutConfig,
} from '@/types/shortcuts';

interface ShortcutInputProps {
  label: string;
  value: ShortcutConfig;
  onChange: (config: ShortcutConfig) => void;
  onReset?: () => void;
  action?: ShortcutAction;
  disabled?: boolean;
  className?: string;
}

export function ShortcutInput({
  label,
  value,
  onChange,
  onReset,
  action,
  disabled = false,
  className,
}: ShortcutInputProps) {
  const { t } = useLocale();
  const [isCapturing, setIsCapturing] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const formattedShortcut = formatShortcut(value);

  const handleStartCapture = () => {
    if (disabled) return;
    setIsCapturing(true);
    setCurrentKeys([]);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!isCapturing) return;

    event.preventDefault();
    event.stopPropagation();

    const keys: string[] = [];

    // Add modifiers
    if (event.metaKey) keys.push('Cmd');
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.altKey) keys.push('Alt');
    if (event.shiftKey) keys.push('Shift');

    // Add main key (skip modifier keys themselves)
    const _keyCode = event.code;
    const key = event.key.toLowerCase();

    if (
      !['Meta', 'Control', 'Alt', 'Shift'].includes(event.key) &&
      key.length === 1 // Only single character keys
    ) {
      keys.push(key.toUpperCase());
      setCurrentKeys(keys);

      // Auto-complete the shortcut
      setTimeout(() => {
        const shortcutString = keys.join('+').toLowerCase();
        const parsedConfig = parseShortcutString(shortcutString);

        if (parsedConfig) {
          onChange(parsedConfig);
        }

        setIsCapturing(false);
        setCurrentKeys([]);
        inputRef.current?.blur();
      }, 100);
    } else {
      setCurrentKeys(keys);
    }
  };

  const handleBlur = () => {
    setIsCapturing(false);
    setCurrentKeys([]);
  };

  const handleClear = () => {
    const clearedConfig: ShortcutConfig = {
      key: '',
      modifiers: {},
    };
    onChange(clearedConfig);
  };

  const handleReset = () => {
    if (onReset) {
      onReset();
    } else if (action && DEFAULT_SHORTCUTS[action]) {
      onChange(DEFAULT_SHORTCUTS[action]);
    }
  };

  const isValid = value.key.length > 0;
  const displayValue = isCapturing
    ? currentKeys.join('+')
    : isValid
      ? formattedShortcut
      : 'Not set';

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={`shortcut-${label}`} className="text-sm font-medium">
        {label}
      </Label>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            ref={inputRef}
            id={`shortcut-${label}`}
            value={displayValue}
            placeholder="Click to set shortcut..."
            readOnly
            onClick={handleStartCapture}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            disabled={disabled}
            className={cn(
              'cursor-pointer font-mono',
              isCapturing && 'ring-2 ring-blue-500',
              !isValid && 'text-gray-400'
            )}
          />

          {isCapturing && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isValid && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClear}
                  disabled={disabled}
                  className="h-8 w-8 p-0"
                >
                  <X className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t.Settings.shortcuts.clearShortcut}</p>
              </TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                disabled={disabled}
                className="h-8 w-8 p-0"
              >
                <RotateCcw className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{t.Settings.shortcuts.resetToDefault}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {isCapturing && <div className="text-xs text-blue-600">Press key combination...</div>}

      {!isValid && !isCapturing && (
        <p className="text-xs text-orange-600">
          No shortcut set for this function. Click the input field above to configure.
        </p>
      )}
    </div>
  );
}
