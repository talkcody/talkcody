import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomToolsSettings } from './custom-tools-settings';

const refreshMock = vi.fn(() => Promise.resolve());
const setCustomToolsDirMock = vi.fn(() => Promise.resolve());

vi.mock('@/stores/custom-tools-store', () => ({
  useCustomToolsStore: vi.fn(() => ({
    tools: [],
    isLoading: false,
    refresh: refreshMock,
  })),
}));

vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: vi.fn((selector) =>
    selector({
      current_root_path: '/test/root',
      custom_tools_dir: '',
      setCustomToolsDir: setCustomToolsDirMock,
    })
  ),
}));

vi.mock('@/hooks/use-locale', () => ({
  useLocale: () => ({
    t: {
      Settings: {
        customTools: {
          title: 'Custom Tools',
          description: 'desc',
          sourcesHint: 'hint',
          selectDirectory: 'Select directory',
          customDirectoryLabel: 'Custom directory',
          customDirectoryUnset: 'Unset',
          workspaceDirectoryLabel: 'Workspace directory',
          homeDirectoryLabel: 'Home directory',
          empty: 'No custom tools found.',
        },
      },
      Common: {
        refresh: 'Refresh',
        loading: 'Loading',
        reset: 'Reset',
        enabled: 'Enabled',
        error: 'Error',
      },
    },
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

vi.mock('lucide-react', () => ({
  AlertCircle: () => null,
  FolderOpen: () => null,
  RefreshCw: () => null,
}));

describe('CustomToolsSettings', () => {
  it('should refresh tools on mount without task id', async () => {
    render(<CustomToolsSettings />);

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledWith();
    });
  });
});
