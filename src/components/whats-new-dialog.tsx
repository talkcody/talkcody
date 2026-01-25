import { getVersion } from '@tauri-apps/api/app';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { ExternalLink, Sparkles } from 'lucide-react';
import { type MouseEvent, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocale } from '@/hooks/use-locale';
import { logger } from '@/lib/logger';
import {
  type ChangelogContent,
  type ChangelogEntry,
  type ChangelogItem,
  getChangelogForVersion,
  getLatestChangelog,
} from '@/services/changelog-service';
import { useSettingsStore } from '@/stores/settings-store';

interface WhatsNewDialogProps {
  // Optional: force open (for "View Release Notes" button in settings)
  forceOpen?: boolean;
  onForceOpenChange?: (open: boolean) => void;
}

const DOCS_BASE_URL = 'https://www.talkcody.com';

type MarkdownSegment =
  | { type: 'text'; value: string; start: number }
  | { type: 'link'; label: string; href: string; start: number };

const parseMarkdownSegments = (input: string): MarkdownSegment[] => {
  const segments: MarkdownSegment[] = [];
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match = linkRegex.exec(input);

  while (match !== null) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({
        type: 'text',
        value: input.slice(lastIndex, matchIndex),
        start: lastIndex,
      });
    }

    const label = match[1];
    const href = match[2]?.trim();

    if (label && href) {
      segments.push({ type: 'link', label, href, start: matchIndex });
    } else {
      segments.push({ type: 'text', value: match[0], start: matchIndex });
    }

    lastIndex = matchIndex + match[0].length;
    match = linkRegex.exec(input);
  }

  if (lastIndex < input.length) {
    segments.push({
      type: 'text',
      value: input.slice(lastIndex),
      start: lastIndex,
    });
  }

  if (segments.length === 0) {
    return [{ type: 'text', value: input, start: 0 }];
  }

  return segments;
};

const resolveMarkdownHref = (href: string): string | null => {
  const trimmed = href.trim();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return `${DOCS_BASE_URL}${trimmed}`;
  }

  return null;
};

const handleOpenLink = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
  event.preventDefault();
  shellOpen(href).catch((error) => {
    logger.error('Failed to open markdown link:', error);
  });
};

const renderMarkdownLinks = (input: string) =>
  parseMarkdownSegments(input).map((segment) => {
    const key = `segment-${segment.type}-${segment.start}`;

    if (segment.type === 'text') {
      return <span key={key}>{segment.value}</span>;
    }

    const resolved = resolveMarkdownHref(segment.href);

    if (!resolved) {
      return <span key={key}>{segment.label}</span>;
    }

    return (
      <a
        key={key}
        href={resolved}
        onClick={(event) => handleOpenLink(event, resolved)}
        className="text-primary underline-offset-4 hover:underline"
      >
        {segment.label}
      </a>
    );
  });

type NormalizedChangelogItem = {
  title: string;
  description?: string;
  videoUrl?: string;
};

const normalizeChangelogItems = (items: ChangelogItem[] = []): NormalizedChangelogItem[] =>
  items.map((item) => (typeof item === 'string' ? { title: item } : item));

const sectionHasVideo = (items: NormalizedChangelogItem[]) =>
  items.some((item) => Boolean(item.videoUrl));

const renderItemText = (text: string) => <span>{renderMarkdownLinks(text)}</span>;

const renderVideoPreview = (
  videoUrl: string,
  label: string,
  captionsLabel: string,
  captionsLang: string
) => (
  <div className="w-full space-y-2">
    <div className="w-full overflow-hidden rounded-xl border bg-black/90 shadow-sm">
      <video
        className="aspect-video w-full object-cover"
        autoPlay
        muted
        controls
        loop
        playsInline
        preload="metadata"
        src={videoUrl}
      >
        <track
          kind="captions"
          src="data:text/vtt,WEBVTT"
          srcLang={captionsLang}
          label={captionsLabel}
        />
      </video>
    </div>
  </div>
);

const renderFeatureCards = (
  items: NormalizedChangelogItem[],
  videoLabel: string,
  captionsLabel: string,
  captionsLang: string
) => (
  <div className="space-y-3">
    {items.map((item, index) => (
      <div
        key={`${item.title}-${item.videoUrl ?? 'text'}-${index}`}
        className="rounded-2xl border border-border/70 bg-gradient-to-br from-background via-background to-muted/40 p-4 shadow-sm sm:p-5"
      >
        <div className={item.videoUrl ? 'flex flex-col gap-4' : 'space-y-2'}>
          <div className="space-y-2">
            <h5 className="text-base font-semibold text-foreground">
              {renderItemText(item.title)}
            </h5>
            {item.description && (
              <p className="text-sm text-muted-foreground">{renderItemText(item.description)}</p>
            )}
          </div>
          {item.videoUrl
            ? renderVideoPreview(item.videoUrl, videoLabel, captionsLabel, captionsLang)
            : null}
        </div>
      </div>
    ))}
  </div>
);

const renderBulletList = (items: NormalizedChangelogItem[]) => (
  <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
    {items.map((item, index) => (
      <li key={`${item.title}-${index}`}>
        <span className="text-foreground/90">{renderItemText(item.title)}</span>
        {item.description ? (
          <span className="block pl-5 text-xs text-muted-foreground">
            {renderItemText(item.description)}
          </span>
        ) : null}
      </li>
    ))}
  </ul>
);

const renderSection = (
  label: string,
  items: ChangelogItem[] | undefined,
  labelClassName: string,
  videoLabel: string,
  captionsLabel: string,
  captionsLang: string
) => {
  if (!items || items.length === 0) {
    return null;
  }

  const normalized = normalizeChangelogItems(items);
  const hasVideo = sectionHasVideo(normalized);

  return (
    <div className="space-y-3">
      <h4 className={`text-xs font-semibold uppercase tracking-wide ${labelClassName}`}>{label}</h4>
      {hasVideo
        ? renderFeatureCards(normalized, videoLabel, captionsLabel, captionsLang)
        : renderBulletList(normalized)}
    </div>
  );
};

export function WhatsNewDialog({ forceOpen, onForceOpenChange }: WhatsNewDialogProps) {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [changelog, setChangelog] = useState<ChangelogEntry | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>('');

  const lastSeenVersion = useSettingsStore((state) => state.last_seen_version);
  const setLastSeenVersion = useSettingsStore((state) => state.setLastSeenVersion);
  const isInitialized = useSettingsStore((state) => state.isInitialized);

  // Check if we need to show the dialog
  useEffect(() => {
    if (!isInitialized) return;

    const checkVersion = async () => {
      try {
        const version = await getVersion();
        setCurrentVersion(version);

        // Try to get changelog for current version, fallback to latest
        const entry = getChangelogForVersion(version) ?? getLatestChangelog();
        setChangelog(entry ?? null);

        // TODO: Remove this line after testing - forces dialog to show
        // setOpen(true); // Uncomment for testing

        // If current version differs from last seen version, show dialog
        if (lastSeenVersion !== version && entry) {
          logger.info(
            `Showing What's New dialog for version ${version} (last seen: ${lastSeenVersion})`
          );
          setOpen(true);
        }
      } catch (error) {
        logger.error("Failed to check version for What's New:", error);
      }
    };

    checkVersion();
  }, [isInitialized, lastSeenVersion]);

  // Handle force open (from settings page)
  useEffect(() => {
    if (forceOpen) {
      // When force opening, ensure we have changelog data
      if (!changelog) {
        const entry = getLatestChangelog();
        setChangelog(entry ?? null);
      }
      setOpen(true);
    } else if (forceOpen === false) {
      setOpen(false);
    }
  }, [forceOpen, changelog]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    onForceOpenChange?.(newOpen);

    // When closing, record that user has seen current version
    if (!newOpen && currentVersion) {
      setLastSeenVersion(currentVersion);
    }
  };

  const handleDismiss = () => {
    handleOpenChange(false);
  };

  const handleViewFullChangelog = async () => {
    // Open docs website changelog page using Tauri shell
    await shellOpen('https://talkcody.com/docs/changelog');
  };

  if (!changelog) {
    return null;
  }

  // Get content based on current locale, fallback to English
  const content: ChangelogContent = changelog[locale as 'en' | 'zh'] || changelog.en;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-fit min-w-4/5 max-h-[80vh] overflow-y-auto bg-gradient-to-br from-background via-background to-muted/30">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-yellow-500" />
            {t.WhatsNew.title}
            <Badge variant="secondary" className="ml-2">
              v{changelog.version}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            {changelog.date && t.WhatsNew.releasedOn(changelog.date)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {renderSection(
            t.WhatsNew.added,
            content.added,
            'text-emerald-600 dark:text-emerald-400',
            t.WhatsNew.videoPreview,
            t.WhatsNew.videoCaptionsLabel,
            locale
          )}
          {renderSection(
            t.WhatsNew.changed,
            content.changed,
            'text-sky-600 dark:text-sky-400',
            t.WhatsNew.videoPreview,
            t.WhatsNew.videoCaptionsLabel,
            locale
          )}
          {renderSection(
            t.WhatsNew.fixed,
            content.fixed,
            'text-orange-600 dark:text-orange-400',
            t.WhatsNew.videoPreview,
            t.WhatsNew.videoCaptionsLabel,
            locale
          )}
          {renderSection(
            t.WhatsNew.removed,
            content.removed,
            'text-rose-600 dark:text-rose-400',
            t.WhatsNew.videoPreview,
            t.WhatsNew.videoCaptionsLabel,
            locale
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleViewFullChangelog}>
            <ExternalLink className="mr-2 h-4 w-4" />
            {t.WhatsNew.viewFullChangelog}
          </Button>
          <Button onClick={handleDismiss}>{t.WhatsNew.gotIt}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
