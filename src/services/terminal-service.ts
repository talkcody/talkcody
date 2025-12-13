import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Terminal } from '@xterm/xterm';
import stripAnsi from 'strip-ansi';
import { logger } from '@/lib/logger';
import { settingsManager } from '@/stores/settings-store';
import { type TerminalSession, useTerminalStore } from '@/stores/terminal-store';

interface PtySpawnResult {
  pty_id: string;
}

interface PtyOutput {
  pty_id: string;
  data: string;
}

interface PtyCloseEvent {
  pty_id: string;
}

class TerminalService {
  private listeners: Map<string, UnlistenFn> = new Map();
  private outputListener: UnlistenFn | null = null;
  private closeListener: UnlistenFn | null = null;
  private dataListeners: Map<string, { dispose: () => void }> = new Map();

  async initialize(): Promise<void> {
    logger.info('Initializing Terminal Service');

    // Check if already initialized
    if (this.outputListener || this.closeListener) {
      logger.warn('Terminal Service already initialized, skipping', {
        hasOutputListener: !!this.outputListener,
        hasCloseListener: !!this.closeListener,
      });
      return;
    }

    // Listen for PTY output
    this.outputListener = await listen<PtyOutput>('pty-output', (event) => {
      const { pty_id, data } = event.payload;
      this.handlePtyOutput(pty_id, data);
    });
    logger.info('PTY output listener registered');

    // Listen for PTY close events
    this.closeListener = await listen<PtyCloseEvent>('pty-close', (event) => {
      const { pty_id } = event.payload;
      this.handlePtyClose(pty_id);
    });
    logger.info('PTY close listener registered');

    logger.info('Terminal Service initialized');
  }

  async cleanup(): Promise<void> {
    logger.info('Cleaning up Terminal Service');

    // Remove all listeners
    for (const unlisten of this.listeners.values()) {
      unlisten();
    }
    this.listeners.clear();

    if (this.outputListener) {
      this.outputListener();
      this.outputListener = null;
    }

    if (this.closeListener) {
      this.closeListener();
      this.closeListener = null;
    }

    // Kill all active sessions
    const store = useTerminalStore.getState();
    const sessions = Array.from(store.sessions.values());

    for (const session of sessions) {
      await this.killTerminal(session.ptyId);
    }

    logger.info('Terminal Service cleaned up');
  }

  async createTerminal(cwd?: string, cols = 80, rows = 24): Promise<TerminalSession> {
    try {
      // Get user's preferred shell from settings
      const preferredShell = settingsManager.getTerminalShell();
      logger.info('Creating new terminal', { cwd, cols, rows, preferredShell });

      const result = await invoke<PtySpawnResult>('pty_spawn', {
        cwd,
        cols,
        rows,
        preferredShell: preferredShell === 'auto' ? null : preferredShell,
      });

      const session: TerminalSession = {
        id: crypto.randomUUID(),
        ptyId: result.pty_id,
        title: cwd ? `Terminal - ${cwd.split('/').pop()}` : 'Terminal',
        cwd,
        buffer: '',
        isActive: true,
        createdAt: new Date(),
      };

      useTerminalStore.getState().addSession(session);
      logger.info('Terminal created', { sessionId: session.id, ptyId: session.ptyId });

      return session;
    } catch (error) {
      logger.error('Failed to create terminal', error);
      throw error;
    }
  }

  async writeToTerminal(ptyId: string, data: string): Promise<void> {
    try {
      logger.info('Writing to PTY', { ptyId, data, dataLength: data.length });
      await invoke('pty_write', { ptyId, data });
    } catch (error) {
      logger.error('Failed to write to terminal', { ptyId, error });
      throw error;
    }
  }

  async resizeTerminal(ptyId: string, cols: number, rows: number): Promise<void> {
    try {
      await invoke('pty_resize', { ptyId, cols, rows });
    } catch (error) {
      logger.error('Failed to resize terminal', { ptyId, cols, rows, error });
      // Don't throw, resize is not critical
    }
  }

  async killTerminal(ptyId: string): Promise<void> {
    try {
      logger.info('Killing terminal', { ptyId });
      await invoke('pty_kill', { ptyId });

      // Remove session from store
      const store = useTerminalStore.getState();
      const session = Array.from(store.sessions.values()).find((s) => s.ptyId === ptyId);

      if (session) {
        // Clean up data listener
        const dataListener = this.dataListeners.get(session.id);
        if (dataListener) {
          dataListener.dispose();
          this.dataListeners.delete(session.id);
        }

        store.removeSession(session.id);
      }
    } catch (error) {
      logger.error('Failed to kill terminal', { ptyId, error });
      throw error;
    }
  }

  attachTerminal(sessionId: string, terminal: Terminal): void {
    const store = useTerminalStore.getState();
    const session = store.getSession(sessionId);

    if (!session) {
      logger.error('Session not found for attachment', { sessionId });
      return;
    }

    // Clean up any existing listeners and terminal references
    const existingListener = this.dataListeners.get(sessionId);
    if (existingListener) {
      logger.warn('Disposing existing data listener before re-attachment', { sessionId });
      existingListener.dispose();
      this.dataListeners.delete(sessionId);
    }

    // Warn if a different terminal instance is already attached
    if (session.terminal && session.terminal !== terminal) {
      logger.warn('Different terminal instance already attached to session', { sessionId });
    }

    store.updateSession(sessionId, { terminal });

    // Write any buffered output that arrived before terminal was attached
    if (session.buffer) {
      logger.info('Writing buffered output to newly attached terminal', {
        sessionId,
        bufferLength: session.buffer.length,
      });
      terminal.write(session.buffer);
    }

    // Set up data handler for user input
    let callCount = 0;
    const disposable = terminal.onData((data) => {
      callCount++;
      logger.info('onData triggered', { sessionId, data, callCount, ptyId: session.ptyId });
      this.writeToTerminal(session.ptyId, data);
    });

    // Store the disposable for cleanup
    this.dataListeners.set(sessionId, disposable);

    logger.info('Terminal attached', {
      sessionId,
      ptyId: session.ptyId,
      totalListeners: this.dataListeners.size,
    });
  }

  detachTerminal(sessionId: string): void {
    // Clean up data listener
    const dataListener = this.dataListeners.get(sessionId);
    if (dataListener) {
      dataListener.dispose();
      this.dataListeners.delete(sessionId);
      logger.info('Terminal detached', { sessionId });
    }

    // Clear terminal reference from session
    const store = useTerminalStore.getState();
    store.updateSession(sessionId, { terminal: undefined });
  }

  private handlePtyOutput(ptyId: string, data: string): void {
    const store = useTerminalStore.getState();
    const session = Array.from(store.sessions.values()).find((s) => s.ptyId === ptyId);

    if (!session) {
      // Silently ignore output for unknown PTYs - this can happen during cleanup
      return;
    }

    logger.info('handlePtyOutput received', {
      ptyId,
      sessionId: session.id,
      data,
      dataLength: data.length,
      hasTerminal: !!session.terminal,
    });

    // Write to terminal
    if (session.terminal) {
      session.terminal.write(data);
      logger.info('Wrote to XTerm', { sessionId: session.id, data });
    }

    // Append to buffer for "copy to chat" feature
    store.appendToBuffer(session.id, data);
  }

  private closedPtys: Set<string> = new Set();

  private handlePtyClose(ptyId: string): void {
    // Prevent duplicate close handling
    if (this.closedPtys.has(ptyId)) {
      return;
    }
    this.closedPtys.add(ptyId);

    logger.info('PTY closed', { ptyId });

    const store = useTerminalStore.getState();
    const session = Array.from(store.sessions.values()).find((s) => s.ptyId === ptyId);

    if (session) {
      // Optionally show a message in the terminal
      if (session.terminal) {
        session.terminal.write('\r\n\x1b[33m[Process completed]\x1b[0m\r\n');
      }

      // Mark as inactive
      store.updateSession(session.id, { isActive: false });
    }

    // Clean up after a delay to prevent memory leak
    setTimeout(() => {
      this.closedPtys.delete(ptyId);
    }, 5000);
  }

  getSessionBuffer(sessionId: string): string {
    const store = useTerminalStore.getState();
    const session = store.getSession(sessionId);
    return session?.buffer || '';
  }

  getRecentCommands(sessionId: string, lines = 50): string {
    const buffer = this.getSessionBuffer(sessionId);
    const allLines = buffer.split('\n');
    const recentLines = allLines.slice(-lines);
    const cleanText = recentLines.join('\n');
    return stripAnsi(cleanText);
  }
}

export const terminalService = new TerminalService();
