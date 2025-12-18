import { ChevronRight, File as FileIcon, Loader2, Search, X } from 'lucide-react';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { useGlobalContentSearch } from '@/hooks/use-global-content-search';
import { useTranslation } from '@/hooks/use-locale';
import { cn } from '@/lib/utils';
import { repositoryService } from '@/services/repository-service';

interface GlobalContentSearchProps {
  isSearchVisible: boolean;
  toggleSearchVisibility: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFileSelect: (filePath: string, lineNumber?: number) => void;
  repositoryPath: string | null;
}

type FlatResult =
  | { type: 'file'; filePath: string; totalMatches: number }
  | {
      type: 'match';
      filePath: string;
      match: { lineNumber: number; lineContent: string };
    };

export function GlobalContentSearch({
  isSearchVisible,
  toggleSearchVisibility,
  inputRef,
  onFileSelect,
  repositoryPath,
}: GlobalContentSearchProps) {
  const t = useTranslation();
  const { searchQuery, setSearchQuery, searchResults, isLoading, executeSearch, resetSearch } =
    useGlobalContentSearch(repositoryPath);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  // Debounced search execution
  useEffect(() => {
    const handler = setTimeout(() => {
      if (searchQuery.trim()) {
        executeSearch();
      }
    }, 300); // 300ms debounce delay

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery, executeSearch]);

  // Expand all files by default when new search results arrive
  useEffect(() => {
    if (searchResults.length > 0) {
      const allFilePaths = new Set(searchResults.map((result) => result.filePath));
      setExpandedFiles(allFilePaths);
    } else {
      setExpandedFiles(new Set());
    }
  }, [searchResults]);

  const handleClose = useCallback(() => {
    toggleSearchVisibility();
    resetSearch();
  }, [toggleSearchVisibility, resetSearch]);

  useEffect(() => {
    if (isSearchVisible) {
      setSelectedIndex(0);
      setExpandedFiles(new Set());
    }
  }, [isSearchVisible]);

  const flatResults = useMemo((): FlatResult[] => {
    const flat: FlatResult[] = [];
    for (const fileResult of searchResults) {
      flat.push({
        type: 'file',
        filePath: fileResult.filePath,
        totalMatches: fileResult.matches.length,
      });

      if (expandedFiles.has(fileResult.filePath)) {
        for (const match of fileResult.matches) {
          flat.push({ type: 'match', filePath: fileResult.filePath, match });
        }
      }
    }
    return flat;
  }, [searchResults, expandedFiles]);

  const toggleFileExpansion = (filePath: string) => {
    setExpandedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const handleSelection = (item: FlatResult | undefined) => {
    if (!item) return;

    if (item.type === 'file') {
      toggleFileExpansion(item.filePath);
    } else if (item.type === 'match' && item.match) {
      onFileSelect(item.filePath, item.match.lineNumber);
      handleClose();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (flatResults.length > 0) {
        handleSelection(flatResults[selectedIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, flatResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'ArrowRight') {
      const item = flatResults[selectedIndex];
      if (item?.type === 'file' && !expandedFiles.has(item.filePath)) {
        toggleFileExpansion(item.filePath);
      }
    } else if (e.key === 'ArrowLeft') {
      const item = flatResults[selectedIndex];
      if (item?.type === 'file' && expandedFiles.has(item.filePath)) {
        toggleFileExpansion(item.filePath);
      }
    }
  };

  useEffect(() => {
    if (listRef.current && flatResults.length > 0) {
      const selectedElement = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`
      ) as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      }
    }
  }, [selectedIndex, flatResults]);

  const highlightMatch = (text: string, query: string) => {
    if (!query) return text;
    const parts = text.split(new RegExp(`(${query})`, 'gi'));
    let keyCounter = 0;
    return (
      <>
        {parts.map((part) => {
          const key = `${part.toLowerCase() === query.toLowerCase() ? 'match' : 'text'}-${keyCounter++}`;
          return part.toLowerCase() === query.toLowerCase() ? (
            <span className="bg-yellow-200 font-semibold dark:bg-yellow-700" key={key}>
              {part}
            </span>
          ) : (
            <span key={key}>{part}</span>
          );
        })}
      </>
    );
  };

  const totalMatches = searchResults.reduce((sum, file) => sum + file.matches.length, 0);

  if (!isSearchVisible) {
    return null;
  }

  return (
    <div
      className="absolute top-0 right-0 bottom-0 left-0 z-40 flex items-start justify-center bg-black/30 pt-20"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          handleClose();
        }
      }}
    >
      <div className="flex h-[600px] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-center border-b px-4 py-2 dark:border-gray-700">
          <Search className="h-4 w-4 text-gray-400" />
          <Input
            className="border-0 bg-transparent pl-4 shadow-none focus-visible:ring-0"
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.Settings.search.searchContentPlaceholder}
            ref={inputRef}
            type="text"
            value={searchQuery}
          />
          <button
            type="button"
            className="ml-2 rounded p-1 hover:bg-gray-200 dark:hover:bg-gray-700"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-auto" ref={listRef}>
          {searchQuery.trim() ? (
            isLoading ? (
              <div className="flex items-center justify-center p-8 text-center text-gray-500">
                <Loader2 className="mr-2 h-8 w-8 animate-spin" />
                {t.Settings.search.searching}
              </div>
            ) : searchResults.length === 0 && searchQuery ? (
              <div className="p-8 text-center text-gray-500">
                <FileIcon className="mx-auto mb-4 h-12 w-12 text-gray-300" />
                <p>
                  {t.Settings.search.noMatchesFound} "{searchQuery}"
                </p>
              </div>
            ) : (
              <div className="py-2">
                <div className="border-b px-4 py-2 text-gray-500 text-xs dark:border-gray-700">
                  {t.Settings.search.matchesInFiles(totalMatches, searchResults.length)}
                </div>

                {flatResults.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  if (item.type === 'file') {
                    const isExpanded = expandedFiles.has(item.filePath);
                    return (
                      <button
                        type="button"
                        className={cn(
                          'flex w-full cursor-pointer items-center border-0 px-2 py-1.5 text-left',
                          isSelected
                            ? 'bg-blue-100 dark:bg-blue-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        )}
                        data-index={index}
                        key={item.filePath}
                        onClick={() => {
                          setSelectedIndex(index);
                          toggleFileExpansion(item.filePath);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelectedIndex(index);
                            toggleFileExpansion(item.filePath);
                          }
                        }}
                      >
                        <ChevronRight
                          className={cn(
                            'mr-2 h-4 w-4 transition-transform',
                            isExpanded && 'rotate-90'
                          )}
                        />
                        <FileIcon className="mr-2 h-4 w-4 text-gray-500" />
                        <span className="font-semibold">
                          {repositoryService.getFileNameFromPath(item.filePath)}
                        </span>
                        <span className="ml-2 text-gray-400 text-xs">
                          {repositoryService.getRelativePath(item.filePath, repositoryPath || '')}
                        </span>
                        <span className="ml-2 text-gray-500 border rounded-full bg-gray-200 px-2 py-0.5 text-xs dark:bg-gray-700">
                          {item.totalMatches}
                        </span>
                      </button>
                    );
                  }
                  // Match item
                  return (
                    <button
                      type="button"
                      className={cn(
                        'flex w-full cursor-pointer items-start border-0 py-1 pr-2 pl-8 text-left',
                        isSelected
                          ? 'bg-blue-100 dark:bg-blue-900/30'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                      )}
                      data-index={index}
                      key={`${item.filePath}:${item.match.lineNumber}`}
                      onClick={() => {
                        setSelectedIndex(index);
                        handleSelection(item);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedIndex(index);
                          handleSelection(item);
                        }
                      }}
                    >
                      <span className="w-12 shrink-0 pr-4 text-right text-gray-400 text-xs">
                        {item.match.lineNumber}:
                      </span>
                      <div className="truncate text-sm">
                        {highlightMatch(item.match.lineContent, searchQuery)}
                      </div>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="p-8 text-center text-gray-500">
              <Search className="mx-auto mb-4 h-12 w-12 text-gray-300" />
              <p>{t.Settings.search.typeToSearchContent}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
