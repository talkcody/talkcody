import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PptViewer } from '@/components/ppt-viewer';

const mockTranslations = {
  PptViewer: {
    slideOf: (current: number, total: number) => `Slide ${current} of ${total}`,
    previous: 'Previous',
    next: 'Next',
    exportPdf: 'Export PDF',
    keyboardShortcuts: 'Shortcuts: Left/Right to navigate, Home/End to jump',
    empty: 'No slides',
  },
};

vi.mock('@/hooks/use-locale', () => ({
  useTranslation: () => mockTranslations,
}));

const slides = [
  <div key="s-1">Slide One</div>,
  <div key="s-2">Slide Two</div>,
  <div key="s-3">Slide Three</div>,
];

describe('PptViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when slides are missing', () => {
    render(<PptViewer slides={[]} />);
    expect(screen.getAllByText('No slides').length).toBeGreaterThan(0);
  });

  it('renders the first slide by default', () => {
    render(<PptViewer slides={slides} />);
    expect(screen.getByText('Slide One')).toBeInTheDocument();
  });

  it('navigates to next and previous slides with buttons', () => {
    render(<PptViewer slides={slides} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Slide Two')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByText('Slide One')).toBeInTheDocument();
  });

  it('handles keyboard navigation', () => {
    render(<PptViewer slides={slides} />);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('Slide Two')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('Slide One')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.getByText('Slide Three')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Home' });
    expect(screen.getByText('Slide One')).toBeInTheDocument();
  });

  it('calls onSlideChange when the slide changes', () => {
    const onSlideChange = vi.fn();
    render(<PptViewer slides={slides} onSlideChange={onSlideChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onSlideChange).toHaveBeenLastCalledWith(1);
  });

  it('disables navigation at bounds', () => {
    render(<PptViewer slides={slides} />);

    const prevButton = screen.getByRole('button', { name: 'Previous' });
    expect(prevButton).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    const nextButton = screen.getByRole('button', { name: 'Next' });
    expect(nextButton).toBeDisabled();
  });

  it('adds print class when exporting PDF', () => {
    vi.useFakeTimers();
    const originalPrint = window.print;
    const printSpy = vi.fn();

    Object.defineProperty(window, 'print', {
      value: printSpy,
      writable: true,
    });

    render(<PptViewer slides={slides} />);
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));

    vi.runAllTimers();

    expect(document.body.classList.contains('ppt-viewer-printing')).toBe(true);
    expect(printSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'print', {
      value: originalPrint,
      writable: true,
    });
    vi.useRealTimers();
  });
});
