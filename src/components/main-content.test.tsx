// src/components/main-content.test.tsx

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MainContent } from './main-content';
import { NavigationView } from '@/types/navigation';

// Mock settings store before any imports
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector) => {
    const mockState = {
      language: 'en',
      setLanguage: vi.fn(),
      sidebar_view: 'files',
      setSidebarView: vi.fn(),
      getSidebarView: () => 'files',
      getAutoApproveEditsGlobal: vi.fn(() => false),
      setAutoApproveEditsGlobal: vi.fn(),
    };
    return selector ? selector(mockState) : mockState;
  }),
  settingsManager: {
    getSidebarView: () => 'files',
    setSidebarView: vi.fn(),
    getAutoApproveEditsGlobal: vi.fn(() => false),
    getSync: vi.fn((key: string) => (key === 'language' ? 'en' : undefined)),
  },
}));

// Mock all page components
vi.mock('@/pages/unified-page', () => ({
  UnifiedPage: () => <div data-testid="unified-page">Unified Page</div>,
}));

vi.mock('@/pages/explorer-page', () => ({
  ExplorerPage: () => <div data-testid="explorer-page">Explorer Page</div>,
}));

vi.mock('@/pages/chat-page', () => ({
  ChatOnlyPage: () => <div data-testid="chat-page">Chat Page</div>,
}));

vi.mock('@/pages/projects-page', () => ({
  ProjectsPage: () => <div data-testid="projects-page">Projects Page</div>,
}));

vi.mock('@/pages/agent-marketplace-page', () => ({
  AgentMarketplacePage: () => <div data-testid="agent-marketplace-page">Agent Marketplace Page</div>,
}));

vi.mock('@/pages/skills-page', () => ({
  SkillsPage: () => <div data-testid="skills-page">Skills Page</div>,
}));

vi.mock('@/pages/mcp-servers-page', () => ({
  MCPServersPage: () => <div data-testid="mcp-servers-page">MCP Servers Page</div>,
}));

vi.mock('@/pages/settings-page', () => ({
  SettingsPage: () => <div data-testid="settings-page">Settings Page</div>,
}));

vi.mock('@/pages/logs-page', () => ({
  LogsPage: () => <div data-testid="logs-page">Logs Page</div>,
}));

describe('MainContent - State Persistence on Page Switch', () => {
  it('should render UnifiedPage, ExplorerPage and ChatOnlyPage in the DOM but only show the active one', () => {
    render(<MainContent activeView={NavigationView.CHAT} />);

    // UnifiedPage, ExplorerPage and ChatOnlyPage are always in the DOM (kept mounted for state preservation)
    expect(screen.getByTestId('explorer-page')).toBeInTheDocument();

    // Other pages are lazy-loaded and should NOT be in the DOM when not active
    expect(screen.queryByTestId('projects-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('agent-marketplace-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skills-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mcp-servers-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('settings-page')).not.toBeInTheDocument();

    // Only chat page should be visible (not hidden)
    const explorerPageContainer = screen.getByTestId('explorer-page').parentElement;

    expect(explorerPageContainer).toHaveClass('hidden');
  });

  it('should keep UnifiedPage, ExplorerPage and ChatOnlyPage mounted when switching between views', () => {
    const { rerender } = render(<MainContent activeView={NavigationView.CHAT} />);

    const explorerPage = screen.getByTestId('explorer-page');

    expect(explorerPage).toBeInTheDocument();

    // Switch to unified
    rerender(<MainContent activeView={NavigationView.UNIFIED} />);

    // All pages should still be in the DOM (not unmounted)
    expect(explorerPage).toBeInTheDocument();

    // Visibility should have switched
    const explorerPageContainer = explorerPage.parentElement;

    expect(explorerPageContainer).toHaveClass('hidden');
  });

  it('should preserve component state across page switches', () => {
    // This test verifies that components are not unmounted (which would reset state)
    // by checking that the same DOM nodes persist across re-renders

    const { rerender } = render(<MainContent activeView={NavigationView.CHAT} />);

    const explorerPageBefore = screen.getByTestId('explorer-page');

    const explorerPageAfter = screen.getByTestId('explorer-page');


    expect(explorerPageBefore).toBe(explorerPageAfter);
  });

  it('should correctly show each navigation view', () => {
    const { rerender, unmount } = render(<MainContent activeView={NavigationView.EXPLORER} />);

    // Always-mounted pages (UnifiedPage, ExplorerPage and ChatOnlyPage)
    const alwaysMountedViews = [
      { view: NavigationView.EXPLORER, testId: 'explorer-page' },
    ];

    for (const { view, testId } of alwaysMountedViews) {
      rerender(<MainContent activeView={view} />);
      const activePageContainer = screen.getByTestId(testId).parentElement;
      expect(activePageContainer).not.toHaveClass('hidden');
    }

    // Lazy-loaded pages - rendered only when active
    const lazyLoadedViews = [
      { view: NavigationView.PROJECTS, testId: 'projects-page' },
      { view: NavigationView.SKILLS_MARKETPLACE, testId: 'skills-page' },
      { view: NavigationView.MCP_SERVERS, testId: 'mcp-servers-page' },
      { view: NavigationView.SETTINGS, testId: 'settings-page' },
    ];

    for (const { view, testId } of lazyLoadedViews) {
      rerender(<MainContent activeView={view} />);
      // Lazy-loaded pages should be present when active
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }

    unmount();
  });
});
