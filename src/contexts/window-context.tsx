import { invoke } from '@tauri-apps/api/core';
import type React from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { logger } from '@/lib/logger';
import { WindowStateStore } from '@/lib/window-state-store';

interface WindowContextType {
  windowLabel: string;
  isMainWindow: boolean;
}

const WindowContext = createContext<WindowContextType>({
  windowLabel: 'main',
  isMainWindow: true,
});

export function useWindowContext() {
  return useContext(WindowContext);
}

export function WindowProvider({ children }: { children: React.ReactNode }) {
  const [windowLabel, setWindowLabel] = useState<string>('main');

  useEffect(() => {
    // Get current window label on mount
    invoke<string>('get_current_window_label')
      .then(async (label) => {
        setWindowLabel(label);
      })
      .catch((error) => {
        logger.error('Failed to get window label:', error);
        // Fallback to main window
        setWindowLabel('main');
      });
  }, []);

  const value: WindowContextType = {
    windowLabel,
    isMainWindow: windowLabel === 'main',
  };

  return <WindowContext.Provider value={value}>{children}</WindowContext.Provider>;
}
