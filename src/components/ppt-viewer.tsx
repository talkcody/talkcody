import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { ReactNode } from 'react';
import { isValidElement, useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';

type SlideDirection = 'next' | 'prev';

const printStyles = `
@page {
  margin: 12mm;
}

@media print {
  body.ppt-viewer-printing * {
    visibility: hidden !important;
  }

  body.ppt-viewer-printing .ppt-viewer,
  body.ppt-viewer-printing .ppt-viewer * {
    visibility: visible !important;
  }

  body.ppt-viewer-printing .ppt-viewer {
    position: static !important;
    height: auto !important;
    width: auto !important;
  }

  body.ppt-viewer-printing .ppt-viewer-screen-only {
    display: none !important;
  }

  body.ppt-viewer-printing .ppt-viewer-print-slides {
    display: block !important;
  }

  body.ppt-viewer-printing .ppt-viewer-print-slide {
    break-after: page;
    page-break-after: always;
    background: white;
    color: black;
  }

  body.ppt-viewer-printing .ppt-viewer-print-slide:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`;

const clampIndex = (index: number, total: number) => {
  if (total <= 0) return 0;
  return Math.min(Math.max(index, 0), total - 1);
};

const slideKeyCache = new WeakMap<object, string>();
let slideKeySeed = 0;

const getStableSlideKey = (slide: ReactNode) => {
  if (isValidElement(slide) && slide.key != null) {
    return `key-${String(slide.key)}`;
  }

  if (typeof slide === 'object' && slide !== null) {
    const cached = slideKeyCache.get(slide);
    if (cached) return cached;
    slideKeySeed += 1;
    const created = `node-${slideKeySeed}`;
    slideKeyCache.set(slide, created);
    return created;
  }

  if (slide === null) return 'null';
  if (slide === undefined) return 'undefined';
  return `primitive-${String(slide)}`;
};

export interface PptViewerProps {
  slides: ReactNode[];
  initialSlide?: number;
  onSlideChange?: (index: number) => void;
  showNavigation?: boolean;
  showProgress?: boolean;
  showExport?: boolean;
  enableKeyboard?: boolean;
  animated?: boolean;
  className?: string;
  slideClassName?: string;
}

export function PptViewer({
  slides,
  initialSlide = 0,
  onSlideChange,
  showNavigation = true,
  showProgress = true,
  showExport = true,
  enableKeyboard = true,
  animated = true,
  className,
  slideClassName,
}: PptViewerProps) {
  const t = useTranslation();
  const totalSlides = slides.length;
  const hasSlides = totalSlides > 0;
  const [currentIndex, setCurrentIndex] = useState(() => clampIndex(initialSlide, totalSlides));
  const [direction, setDirection] = useState<SlideDirection>('next');
  const [isPrinting, setIsPrinting] = useState(false);

  const printableSlides = useMemo(() => {
    const counts = new Map<string, number>();
    return slides.map((slide) => {
      const base = getStableSlideKey(slide);
      const nextCount = (counts.get(base) ?? 0) + 1;
      counts.set(base, nextCount);
      return {
        slide,
        key: `print-${base}-${nextCount}`,
      };
    });
  }, [slides]);

  useEffect(() => {
    setCurrentIndex((prev) => clampIndex(prev, totalSlides));
  }, [totalSlides]);

  useEffect(() => {
    if (!hasSlides) return;
    onSlideChange?.(currentIndex);
  }, [currentIndex, hasSlides, onSlideChange]);

  useEffect(() => {
    if (hasSlides) return;
    onSlideChange?.(0);
  }, [hasSlides, onSlideChange]);

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < totalSlides - 1;

  const setIndex = useCallback(
    (nextIndex: number, nextDirection: SlideDirection) => {
      if (!hasSlides) return;
      setDirection(nextDirection);
      setCurrentIndex(clampIndex(nextIndex, totalSlides));
    },
    [hasSlides, totalSlides]
  );

  const goPrev = useCallback(() => {
    if (!canGoPrev) return;
    setIndex(currentIndex - 1, 'prev');
  }, [canGoPrev, currentIndex, setIndex]);

  const goNext = useCallback(() => {
    if (!canGoNext) return;
    setIndex(currentIndex + 1, 'next');
  }, [canGoNext, currentIndex, setIndex]);

  const goFirst = useCallback(() => {
    if (!hasSlides || currentIndex === 0) return;
    setIndex(0, 'prev');
  }, [currentIndex, hasSlides, setIndex]);

  const goLast = useCallback(() => {
    if (!hasSlides || currentIndex === totalSlides - 1) return;
    setIndex(totalSlides - 1, 'next');
  }, [currentIndex, hasSlides, setIndex, totalSlides]);

  const handlePrint = useCallback(() => {
    if (!hasSlides || typeof window === 'undefined' || typeof window.print !== 'function') {
      return;
    }

    document.body.classList.add('ppt-viewer-printing');
    setIsPrinting(true);

    window.setTimeout(() => {
      window.print();
    }, 0);
  }, [hasSlides]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleAfterPrint = () => {
      document.body.classList.remove('ppt-viewer-printing');
      setIsPrinting(false);
    };

    window.addEventListener('afterprint', handleAfterPrint);
    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      document.body.classList.remove('ppt-viewer-printing');
      setIsPrinting(false);
    };
  }, []);

  useEffect(() => {
    if (!enableKeyboard) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!hasSlides || event.defaultPrevented) return;

      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goPrev();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goNext();
          break;
        case 'Home':
          event.preventDefault();
          goFirst();
          break;
        case 'End':
          event.preventDefault();
          goLast();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboard, goFirst, goLast, goNext, goPrev, hasSlides]);

  const slideAnimation = useMemo(() => {
    if (!animated || !hasSlides) return '';
    return direction === 'next'
      ? 'animate-in fade-in slide-in-from-right-6'
      : 'animate-in fade-in slide-in-from-left-6';
  }, [animated, direction, hasSlides]);

  const progressLabel = hasSlides
    ? t.PptViewer.slideOf(currentIndex + 1, totalSlides)
    : t.PptViewer.empty;

  return (
    <div className={cn('ppt-viewer flex h-full w-full flex-col gap-3', className)}>
      <style>{printStyles}</style>

      <div className="ppt-viewer-screen-only flex flex-wrap items-center gap-2">
        {showNavigation && (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goPrev}
              disabled={!hasSlides || !canGoPrev}
              aria-label={t.PptViewer.previous}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">{t.PptViewer.previous}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goNext}
              disabled={!hasSlides || !canGoNext}
              aria-label={t.PptViewer.next}
            >
              <ChevronRight className="h-4 w-4" />
              <span className="hidden sm:inline">{t.PptViewer.next}</span>
            </Button>
          </div>
        )}

        {showProgress && <div className="text-muted-foreground text-sm">{progressLabel}</div>}

        {showExport && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handlePrint}
            disabled={!hasSlides}
            aria-label={t.PptViewer.exportPdf}
            className="ml-auto"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t.PptViewer.exportPdf}</span>
          </Button>
        )}
      </div>

      <div className="ppt-viewer-screen-only relative flex min-h-[240px] flex-1 overflow-hidden rounded-lg border bg-card">
        {hasSlides ? (
          <div
            key={currentIndex}
            className={cn(
              'h-full w-full p-6 text-foreground motion-reduce:animate-none',
              slideAnimation,
              !animated && 'animate-none',
              slideClassName
            )}
          >
            {slides[currentIndex]}
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            {t.PptViewer.empty}
          </div>
        )}
      </div>

      {isPrinting && (
        <div className="ppt-viewer-print-slides hidden" aria-hidden>
          {printableSlides.map(({ slide, key }) => (
            <div key={key} className="ppt-viewer-print-slide min-h-[100vh] p-8">
              {slide}
            </div>
          ))}
        </div>
      )}

      {showProgress && (
        <div className="ppt-viewer-screen-only text-muted-foreground text-xs">
          {t.PptViewer.keyboardShortcuts}
        </div>
      )}
    </div>
  );
}
