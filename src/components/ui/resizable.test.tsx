import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from './resizable';

describe('Resizable wrappers', () => {
  it('renders with current library exports and supports legacy props', () => {
    const { container } = render(
      <ResizablePanelGroup direction="vertical">
        <ResizablePanel id="panel-a" order={1} defaultSize={60}>
          <div>A</div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="panel-b" order={2} defaultSize={40}>
          <div>B</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    );

    const group = container.querySelector('[data-slot="resizable-panel-group"]');
    const panels = container.querySelectorAll('[data-slot="resizable-panel"]');
    const handles = container.querySelectorAll('[data-slot="resizable-handle"]');

    expect(group).not.toBeNull();
    expect(group).toHaveAttribute('data-group');
    expect((group as HTMLElement).style.flexDirection).toBe('column');
    expect(panels.length).toBe(2);
    expect(handles.length).toBe(1);
  });
});
