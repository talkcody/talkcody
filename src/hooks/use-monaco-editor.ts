import type { Monaco } from '@monaco-editor/react';
import type { editor, IPosition } from 'monaco-editor';
import { useCallback, useEffect, useRef } from 'react';
import { AI_COMPLETION_EXPIRY } from '@/constants/editor';
import { logger } from '@/lib/logger';
import {
  getLastDefinitionResult,
  registerDefinitionProviders,
} from '@/services/monaco-definition-provider';
import { registerImportLinkProviders } from '@/services/monaco-link-provider';
import { settingsManager } from '@/stores/settings-store';
import type { AICompletionState } from '@/types/file-editor';
import {
  setupMonacoDiagnostics,
  setupVueLanguage,
  shouldTriggerAICompletion,
} from '@/utils/monaco-utils';

interface UseMonacoEditorProps {
  filePath: string | null;
  fileContent: string | null;
  lineNumber?: number;
  getCurrentCompletionState: () => AICompletionState | null;
  clearAICompletion: () => void;
  requestAICompletion: (
    model: editor.ITextModel,
    position: IPosition,
    editorRef: React.RefObject<editor.IStandaloneCodeEditor>
  ) => void;
  acceptAICompletion: (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => boolean;
  dismissAICompletion: () => boolean;
  shouldClearCompletion: (position: IPosition, completion: AICompletionState | null) => boolean;
  setUserAction: (isUserAction: boolean) => void;
  isUserTyping: boolean;
  isAICompleting: boolean;
  onGlobalSearch?: () => void;
  onOpenFile?: (filePath: string, lineNumber?: number) => void; // Callback for cross-file navigation
}

export function useMonacoEditor({
  filePath,
  fileContent: _fileContent,
  lineNumber,
  getCurrentCompletionState,
  clearAICompletion,
  requestAICompletion,
  acceptAICompletion,
  dismissAICompletion,
  shouldClearCompletion,
  setUserAction,
  isUserTyping: _isUserTyping,
  isAICompleting,
  onGlobalSearch,
  onOpenFile,
}: UseMonacoEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const lastContentLengthRef = useRef<number>(0);

  // Function to navigate to line number
  const navigateToLine = useCallback(
    (editor: editor.IStandaloneCodeEditor, targetLineNumber: number, targetFilePath: string) => {
      const model = editor.getModel();
      if (!model) {
        logger.info('No model available for navigation');
        return false;
      }

      // Check if this is the right file by comparing the file path
      const modelPath = model.uri.path;
      const normalizedModelPath = modelPath.startsWith('/') ? modelPath : `/${modelPath}`;
      const normalizedFilePath = targetFilePath.startsWith('/')
        ? targetFilePath
        : `/${targetFilePath}`;

      const isCorrectFile =
        normalizedModelPath === normalizedFilePath ||
        modelPath.endsWith(targetFilePath) ||
        targetFilePath.endsWith(modelPath);

      if (isCorrectFile) {
        // Ensure line number is valid
        const maxLineNumber = model.getLineCount();
        const safeLineNumber = Math.min(Math.max(1, targetLineNumber), maxLineNumber);

        logger.info(`Navigating to line ${safeLineNumber} in file ${targetFilePath}`);
        editor.revealLineInCenter(safeLineNumber, 1);
        editor.setPosition({ lineNumber: safeLineNumber, column: 1 });
        editor.focus();
        return true;
      }
      return false;
    },
    []
  );

  // Store pending navigation to execute when editor mounts
  const pendingNavigationRef = useRef<{ lineNumber: number; filePath: string } | null>(null);

  // Effect to handle line navigation when lineNumber or filePath changes
  // This stores the pending navigation, which will be executed in handleEditorDidMount
  useEffect(() => {
    if (lineNumber && filePath) {
      logger.info(`Setting pending navigation to line ${lineNumber} in file ${filePath}`);
      pendingNavigationRef.current = { lineNumber, filePath };

      // Also try immediate navigation if editor is already ready for the correct file
      const editor = editorRef.current;
      if (editor) {
        const model = editor.getModel();
        if (model) {
          const modelPath = model.uri.path;
          const normalizedFilePath = filePath.startsWith('/') ? filePath : `/${filePath}`;
          if (
            modelPath === normalizedFilePath ||
            modelPath.endsWith(filePath) ||
            filePath.endsWith(modelPath)
          ) {
            logger.info(`Immediate navigation to line ${lineNumber} in file ${filePath}`);
            navigateToLine(editor, lineNumber, filePath);
            pendingNavigationRef.current = null;
          }
        }
      }
    }
  }, [filePath, lineNumber, navigateToLine]);

  const handleTabKey = useCallback(
    async (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!(model && position)) return;

      // Set user action flag to prevent interference
      setUserAction(true);

      try {
        // Check for AI completion first
        if (acceptAICompletion(editor, monaco)) {
          return;
        }

        // Try Monaco's built-in inline suggestions
        try {
          const inlineSuggestController = editor.getContribution('editor.contrib.inlineSuggest');
          if (inlineSuggestController) {
            // biome-ignore lint/suspicious/noExplicitAny: Monaco internal API has no public type
            const inlineSuggestModel = (inlineSuggestController as any).model;
            if (inlineSuggestModel?.state?.inlineCompletion) {
              logger.info('Accepting built-in inline suggestion');
              editor.trigger('keyboard', 'editor.action.inlineSuggest.commit', {});
              return;
            }
          }
        } catch (_error) {
          logger.info('No built-in inline suggestion available');
        }

        // Default tab behavior - proper indentation
        const currentLine = model.getLineContent(position.lineNumber);
        const beforeCursor = currentLine.substring(0, position.column - 1);

        if (beforeCursor.trim() === '') {
          editor.trigger('keyboard', 'editor.action.indentLines', {});
        } else {
          editor.trigger('keyboard', 'type', { text: '\t' });
        }
      } finally {
        // Reset user action flag after a short delay
        setTimeout(() => {
          setUserAction(false);
        }, 500);
      }
    },
    [acceptAICompletion, setUserAction]
  );

  const handleEditorDidMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorRef.current = editor;

      const model = editor.getModel();

      if (monaco && model) {
        // Initialize content length tracking
        lastContentLengthRef.current = model.getValue().length;

        // Execute pending navigation now that editor is mounted with the correct model
        if (pendingNavigationRef.current) {
          const { lineNumber: targetLine, filePath: targetPath } = pendingNavigationRef.current;
          const modelPath = model.uri.path;
          const normalizedTargetPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;

          if (
            modelPath === normalizedTargetPath ||
            modelPath.endsWith(targetPath) ||
            targetPath.endsWith(modelPath)
          ) {
            logger.info(`Executing pending navigation to line ${targetLine} in mounted editor`);
            // Use setTimeout to ensure editor is fully ready
            setTimeout(() => {
              navigateToLine(editor, targetLine, targetPath);
            }, 50);
            pendingNavigationRef.current = null;
          }
        }

        // Set up model change listener for line navigation
        const modelChangeDisposable = editor.onDidChangeModel(() => {
          logger.info('Editor model changed');
          // When model changes and we have a pending line navigation, try again
          if (pendingNavigationRef.current) {
            const { lineNumber: targetLine, filePath: targetPath } = pendingNavigationRef.current;
            setTimeout(() => {
              navigateToLine(editor, targetLine, targetPath);
              pendingNavigationRef.current = null;
            }, 100);
          }
        });

        // Store model change disposable
        // biome-ignore lint/suspicious/noExplicitAny: storing disposable on editor instance
        (editor as any)._modelChangeDisposable = modelChangeDisposable;

        // Setup Monaco configuration
        setupMonacoDiagnostics(model, monaco);

        // Setup Vue language syntax highlighting (global one-time initialization)
        setupVueLanguage(monaco);
        // Note: setupMonacoTheme() is now handled in file-editor-content.tsx

        // Register Tree-sitter definition providers for all supported languages
        registerDefinitionProviders(monaco);

        // Register import/include link providers for path clicking
        registerImportLinkProviders(monaco);

        // Register editor opener for cross-file navigation
        logger.info('[CodeNav] Registering editor opener');
        const editorOpenerDisposable = monaco.editor.registerEditorOpener({
          openCodeEditor: (
            _source: editor.ICodeEditor,
            resource: { path: string },
            selectionOrPosition: { lineNumber?: number; startLineNumber?: number } | undefined
          ) => {
            const targetFilePath = resource.path;
            logger.info(
              '[CodeNav] Cross-file navigation requested:',
              targetFilePath,
              selectionOrPosition
            );

            if (onOpenFile) {
              logger.info('[CodeNav] Calling onOpenFile callback');
              // Extract line number from selection/position
              let targetLineNumber: number | undefined;
              if (selectionOrPosition) {
                if ('lineNumber' in selectionOrPosition) {
                  targetLineNumber = selectionOrPosition.lineNumber;
                } else if ('startLineNumber' in selectionOrPosition) {
                  targetLineNumber = selectionOrPosition.startLineNumber;
                }
              }
              onOpenFile(targetFilePath, targetLineNumber);
              return true; // Return true to indicate we handled the navigation
            }
            return false; // Return false to let Monaco handle it (will fail for cross-file)
          },
        });

        // Store opener disposable for cleanup
        // biome-ignore lint/suspicious/noExplicitAny: storing disposable on editor instance
        (editor as any)._editorOpenerDisposable = editorOpenerDisposable;

        // Handle Cmd+Click for go to definition using cached definition result
        // This is necessary because Monaco's default behavior doesn't work for cross-file navigation
        // when the target model doesn't exist
        // biome-ignore lint/suspicious/noExplicitAny: Monaco mouse event type not fully exported
        const mouseDownDisposable = editor.onMouseDown((e: any) => {
          // Check for Cmd+Click (metaKey on Mac) or Ctrl+Click (on Windows/Linux)
          if (!(e.event.metaKey || e.event.ctrlKey)) return;

          const position = e.target.position;
          if (!position) return;

          // Get cached definition result (set by provideDefinition during Cmd+hover)
          const cachedResult = getLastDefinitionResult();
          if (!cachedResult || cachedResult.definitions.length === 0) {
            logger.info('[CodeNav] No cached definition result for Cmd+Click');
            return;
          }

          // Verify click position is on the same line as the cached definition
          // (user should be clicking on the underlined word)
          if (position.lineNumber !== cachedResult.position.lineNumber) {
            logger.info('[CodeNav] Click position not on cached definition line');
            return;
          }

          // Use the cached definition for navigation
          const def = cachedResult.definitions[0];
          if (def) {
            logger.info('[CodeNav] Using cached definition:', def.file_path, def.start_line);

            if (onOpenFile) {
              onOpenFile(def.file_path, def.start_line);
            }
          }
        });

        // Store mouse down disposable for cleanup
        // biome-ignore lint/suspicious/noExplicitAny: storing disposable on editor instance
        (editor as any)._mouseDownDisposable = mouseDownDisposable;

        // Register inline completion provider
        const inlineCompletionProvider = monaco.languages.registerInlineCompletionsProvider(
          { pattern: '**' },
          {
            provideInlineCompletions: async (_model: editor.ITextModel, position: IPosition) => {
              // Check if AI completion is enabled
              if (!settingsManager.getAICompletionEnabled()) {
                return { items: [] };
              }

              const completionState = getCurrentCompletionState();

              if (
                completionState &&
                completionState.position.lineNumber === position.lineNumber &&
                Date.now() - completionState.triggerTime < AI_COMPLETION_EXPIRY
              ) {
                return {
                  items: [
                    {
                      insertText: completionState.completion,
                      range: new monaco.Range(
                        position.lineNumber,
                        position.column,
                        position.lineNumber,
                        position.column
                      ),
                      filterText: '',
                      kind: monaco.languages.CompletionItemKind.Text,
                    },
                  ],
                };
              }
              return { items: [] };
            },
            disposeInlineCompletions: () => {
              // Required method for Monaco - no-op
            },
          }
        );

        // Listen for content changes
        // biome-ignore lint/suspicious/noExplicitAny: Monaco content change event type
        const contentChangeDisposable = model.onDidChangeContent((e: any) => {
          const position = editor.getPosition();
          if (!position) return;

          // Clear existing completion on any change (unless it's our own acceptance)
          const currentCompletion = getCurrentCompletionState();
          if (currentCompletion) {
            logger.info('Content changed - clearing existing completion');
            clearAICompletion();
          }

          // Only trigger AI completion for appropriate changes and if enabled
          if (
            settingsManager.getAICompletionEnabled() &&
            shouldTriggerAICompletion(model, position, e.changes, isAICompleting)
          ) {
            logger.info('Triggering AI completion due to content change');
            requestAICompletion(model, position, { current: editor });
          }
        });

        // Override Tab key
        editor.addCommand(monaco.KeyCode.Tab, async () => {
          await handleTabKey(editor, monaco);
        });

        // Override Escape key
        editor.addCommand(monaco.KeyCode.Escape, () => {
          return dismissAICompletion();
        });

        // Enable Cmd+F / Ctrl+F for search
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF, () => {
          const findAction = editor.getAction('actions.find');
          if (findAction) {
            findAction.run();
          }
        });

        // Disable tooltips for find widget buttons
        // This fixes the issue where tooltips block button clicks
        setTimeout(() => {
          const findController = editor.getContribution('editor.contrib.findController');
          if (findController) {
            // Get the find widget actions
            const actions = [
              'editor.action.findAgain',
              'editor.action.findNextMatch',
              'editor.action.findPreviousMatch',
              'closeFindWidgetCommand',
            ];
            actions.forEach((actionId) => {
              const action = editor.getAction(actionId);
              if (action) {
                // Remove tooltip property
                // biome-ignore lint/suspicious/noExplicitAny: Monaco internal API
                (action as any).tooltip = '';
              }
            });
          }
        }, 100);

        // Intercept Cmd+G to prevent Monaco's default "Go to Line" and trigger global search
        // We use onKeyDown to intercept before Monaco's keybinding system processes it
        // biome-ignore lint/suspicious/noExplicitAny: Monaco keyboard event type
        const keyDownDisposable = editor.onKeyDown((e: any) => {
          // Check for Cmd+G (Mac) or Ctrl+G (Windows/Linux)
          if ((e.metaKey || e.ctrlKey) && e.keyCode === monaco.KeyCode.KeyG) {
            // Prevent Monaco's default "Go to Line" action
            e.preventDefault();
            e.stopPropagation();

            // Trigger global content search
            if (onGlobalSearch) {
              onGlobalSearch();
            }
          }
        });

        // Clear completion when cursor moves significantly
        // biome-ignore lint/suspicious/noExplicitAny: Monaco cursor event type
        const cursorDisposable = editor.onDidChangeCursorPosition((e: any) => {
          const currentCompletion = getCurrentCompletionState();
          if (currentCompletion && shouldClearCompletion(e.position, currentCompletion)) {
            logger.info('Cursor moved significantly - clearing completion');
            clearAICompletion();
          }
        });

        // Hide Monaco find widget tooltips to prevent them from blocking buttons
        // Use MutationObserver to detect when hover widgets are added to the DOM
        const observerDisposable = (() => {
          const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
              // Convert NodeList to Array for iteration
              Array.from(mutation.addedNodes).forEach((node) => {
                if (node instanceof HTMLElement && node.classList.contains('monaco-hover')) {
                  // Check if this hover is from find widget (contains "Close" or "Escape" text)
                  const text = node.textContent || '';
                  if (text.includes('Close') || text.includes('Escape') || text.includes('Find')) {
                    node.style.display = 'none';
                  }
                }
              });
            }
          });

          // Observe the document body for added nodes
          observer.observe(document.body, {
            childList: true,
            subtree: true,
          });

          return {
            dispose: () => observer.disconnect(),
          };
        })();

        // Store disposables for cleanup
        // biome-ignore lint/suspicious/noExplicitAny: storing disposables on editor instance
        (editor as any)._aiCompletionDisposables = [
          inlineCompletionProvider,
          modelChangeDisposable,
          contentChangeDisposable,
          cursorDisposable,
          keyDownDisposable,
          observerDisposable,
          { dispose: () => {} }, // Placeholder for findCommandId since it doesn't return a disposable
        ];
      }
    },
    [
      getCurrentCompletionState,
      clearAICompletion,
      requestAICompletion,
      handleTabKey,
      dismissAICompletion,
      shouldClearCompletion,
      isAICompleting,
      navigateToLine,
      onGlobalSearch,
      onOpenFile,
    ]
  );

  // Cleanup AI completion resources
  useEffect(() => {
    return () => {
      const editor = editorRef.current;
      // biome-ignore lint/suspicious/noExplicitAny: accessing stored disposables on editor instance
      if (editor && (editor as any)._aiCompletionDisposables) {
        // biome-ignore lint/suspicious/noExplicitAny: accessing stored disposables on editor instance
        for (const disposable of (editor as any)._aiCompletionDisposables) {
          if (disposable && typeof disposable.dispose === 'function') {
            disposable.dispose();
          }
        }
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposables
        delete (editor as any)._aiCompletionDisposables;
      }

      // Cleanup model change disposable
      // biome-ignore lint/suspicious/noExplicitAny: accessing stored disposable on editor instance
      if (editor && (editor as any)._modelChangeDisposable) {
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        (editor as any)._modelChangeDisposable.dispose();
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        delete (editor as any)._modelChangeDisposable;
      }

      // Cleanup editor opener disposable
      // biome-ignore lint/suspicious/noExplicitAny: accessing stored disposable on editor instance
      if (editor && (editor as any)._editorOpenerDisposable) {
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        (editor as any)._editorOpenerDisposable.dispose();
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        delete (editor as any)._editorOpenerDisposable;
      }

      // Cleanup mouse down disposable
      // biome-ignore lint/suspicious/noExplicitAny: accessing stored disposable on editor instance
      if (editor && (editor as any)._mouseDownDisposable) {
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        (editor as any)._mouseDownDisposable.dispose();
        // biome-ignore lint/suspicious/noExplicitAny: cleanup stored disposable
        delete (editor as any)._mouseDownDisposable;
      }
    };
  }, []);

  return {
    editorRef,
    handleEditorDidMount,
  };
}
