// src/components/chat/chat-input.tsx

import { getCurrentWindow } from '@tauri-apps/api/window';
import type { ChatStatus } from 'ai';
import { FileIcon, Image, Plus } from 'lucide-react';
import {
  type ChangeEventHandler,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useFileUpload } from '@/hooks/use-file-upload';
import { useLocale } from '@/hooks/use-locale';
import { useAppSettings } from '@/hooks/use-settings';
import { useVoiceInput } from '@/hooks/use-voice-input';
import { logger } from '@/lib/logger';
import { generateId } from '@/lib/utils';
import { fileUploadService } from '@/services/file-upload-service';
import { modelService } from '@/services/model-service';
import { repositoryService } from '@/services/repository-service';
import { useModelStore } from '@/stores/model-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import type { MessageAttachment } from '@/types/agent';
import type { Command } from '@/types/command';
import {
  PromptInput,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputToolbar,
  PromptInputTools,
} from '../ai-elements/prompt-input';
import { AgentSelector } from '../selectors';
import { ChatInputToolsBar } from './chat-input-tools-bar';
import { CommandPicker } from './command-picker';
import { FilePicker } from './file-picker';
import { FilePreview } from './file-preview';
import { ImageSupportAlert } from './image-support-alert';
import { VoiceInputButton } from './voice-input-button';
import { VoiceRecordingModal } from './voice-recording-modal';

interface ChatInputProps {
  input: string;
  onInputChange: ChangeEventHandler<HTMLTextAreaElement>;
  onSubmit: (e: React.FormEvent, attachments?: MessageAttachment[]) => void;
  onCommandExecute?: (command: Command, args: string) => void;
  isLoading: boolean;
  status: ChatStatus;
  selectedFile?: string | null;
  fileContent?: string | null;
  repositoryPath?: string | undefined;
  conversationId?: string | null;
}

export interface ChatInputRef {
  addFileToChat: (filePath: string, fileContent: string) => Promise<void>;
  appendToInput: (text: string) => void;
}

export const ChatInput = forwardRef<ChatInputRef, ChatInputProps>(
  (
    {
      input,
      onInputChange,
      onSubmit,
      onCommandExecute,
      isLoading,
      status,
      selectedFile,
      fileContent,
      repositoryPath,
      conversationId,
    },
    ref
  ) => {
    const { t } = useLocale();
    const { loading: settingsLoading } = useAppSettings();
    const { isPlanModeEnabled, togglePlanMode } = usePlanModeStore();

    const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
    const { uploadImage, uploadFile, isUploading } = useFileUpload();

    // Voice input hook
    const {
      isRecording,
      isTranscribing,
      isSupported,
      error: voiceError,
      recordingDuration,
      partialTranscript,
      isConnecting,
      startRecording,
      stopRecording,
      cancelRecording,
    } = useVoiceInput();

    // Drag and drop state
    const [isDragging, setIsDragging] = useState(false);

    // File picker states
    const [showFilePicker, setShowFilePicker] = useState(false);
    const [filePickerPosition, setFilePickerPosition] = useState({
      top: 0,
      left: 0,
    });
    const [fileSearchQuery, setFileSearchQuery] = useState('');
    const [hashPosition, setHashPosition] = useState(-1);

    // Command picker states
    const [showCommandPicker, setShowCommandPicker] = useState(false);
    const [commandPickerPosition, setCommandPickerPosition] = useState({
      top: 0,
      left: 0,
    });
    const [commandSearchQuery, setCommandSearchQuery] = useState('');
    const [slashPosition, setSlashPosition] = useState(-1);

    // Image support alert state
    const [showImageAlert, setShowImageAlert] = useState(false);
    const [pendingImageAttachments, setPendingImageAttachments] = useState<MessageAttachment[]>([]);
    const isShowingAlertRef = useRef(false); // Guard flag to prevent double-triggering alert

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Helper function to check if attachment already exists
    const isAttachmentExists = useCallback(
      (filePath: string) => {
        return attachments.some(
          (attachment) => attachment.type === 'code' && attachment.filePath === filePath
        );
      },
      [attachments]
    );

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      const cursorPosition = e.target.selectionStart;

      // Check if user typed '/' for command picker
      // Look backwards from cursor to find the nearest slash in a valid position
      let shouldShowCommandPicker = false;
      let commandSlashIndex = -1;

      // Iterate backwards from cursor to find if we're in a command context
      for (let i = cursorPosition - 1; i >= 0; i--) {
        if (value[i] === '/') {
          // Check if there's anything between this slash and the cursor
          const textAfterSlash = value.substring(i + 1, cursorPosition);

          // If we encounter a newline or space after the slash, this slash is no longer valid
          if (textAfterSlash.includes('\n') || textAfterSlash.includes(' ')) {
            break;
          }

          // Check if this slash is at a valid position (start of input, after newline, or after space)
          const charBeforeSlash = i > 0 ? value[i - 1] : ' ';
          if (charBeforeSlash === ' ' || charBeforeSlash === '\n' || i === 0) {
            commandSlashIndex = i;
            shouldShowCommandPicker = true;
          }
          break;
        } else if (value[i] === '\n') {
          // Stop looking if we hit a newline (no slash found on this line)
          break;
        }
      }

      if (shouldShowCommandPicker && commandSlashIndex !== -1) {
        const searchQuery = value.substring(commandSlashIndex, cursorPosition);

        // Validate search query
        // - Should only contain "/" and alphanumeric characters (no spaces, special chars)
        // - Allow "/" alone or "/" followed by alphanumeric characters
        // - Close picker if invalid characters are found
        const isValidQuery = /^\/[a-zA-Z0-9]*$/.test(searchQuery);

        if (isValidQuery) {
          setCommandSearchQuery(searchQuery);
          setSlashPosition(commandSlashIndex);
          setShowCommandPicker(true);
          setShowFilePicker(false); // Close file picker if open

          // Calculate position for command picker
          if (textareaRef.current) {
            const rect = textareaRef.current.getBoundingClientRect();
            const pickerHeight = 320; // max-h-80 = 20rem = 320px
            const spaceAbove = rect.top;
            let top: number;

            if (spaceAbove >= pickerHeight + 10) {
              top = rect.top - pickerHeight - 5;
            } else {
              top = rect.bottom + 5;
            }

            setCommandPickerPosition({
              top: Math.max(10, top),
              left: rect.left,
            });
          }
        } else {
          // Close picker if invalid query detected (contains spaces, special chars, etc.)
          setShowCommandPicker(false);
        }
      } else {
        setShowCommandPicker(false);
      }

      // Check if user typed '#' for file picker - only if repositoryPath is available
      if (repositoryPath && !showCommandPicker) {
        const hashIndex = value.lastIndexOf('#', cursorPosition - 1);

        if (hashIndex !== -1) {
          // Check if there's a space or start of line before '#'
          const charBeforeHash = hashIndex > 0 ? value[hashIndex - 1] : ' ';
          if (charBeforeHash === ' ' || charBeforeHash === '\n' || hashIndex === 0) {
            const searchQuery = value.substring(hashIndex + 1, cursorPosition);

            // Only show picker if the search query doesn't contain spaces
            if (searchQuery.includes(' ') || searchQuery.includes('\n')) {
              setShowFilePicker(false);
            } else {
              setFileSearchQuery(searchQuery);
              setHashPosition(hashIndex);
              setShowFilePicker(true);

              // Calculate position for file picker
              if (textareaRef.current) {
                const rect = textareaRef.current.getBoundingClientRect();
                const pickerHeight = 256;
                const spaceBelow = window.innerHeight - rect.bottom;
                let top: number;
                if (spaceBelow < pickerHeight + 5) {
                  top = Math.max(0, rect.top - pickerHeight - 5);
                } else {
                  top = rect.bottom + 5;
                }
                setFilePickerPosition({
                  top,
                  left: rect.left,
                });
              }
            }
          } else {
            setShowFilePicker(false);
          }
        } else {
          setShowFilePicker(false);
        }
      } else {
        // No repository path available, close file picker if open
        setShowFilePicker(false);
      }

      onInputChange(e);
    };

    const handleFileSelect = async (filePath: string) => {
      try {
        // Check if file is already attached
        if (isAttachmentExists(filePath)) {
          setShowFilePicker(false);
          return;
        }

        const fileContent = await repositoryService.readFileContent(filePath);
        const fileName = repositoryService.getFileNameFromPath(filePath);
        const language = repositoryService.getLanguageFromExtension(fileName);

        const codeAttachment: MessageAttachment = {
          id: generateId(),
          filename: fileName,
          type: 'code',
          filePath,
          content: fileContent,
          mimeType: language,
          size: new Blob([fileContent]).size,
        };

        setAttachments((prev) => [...prev, codeAttachment]);

        // Replace the # and search query with file reference in input
        if (textareaRef.current && hashPosition !== -1 && repositoryPath) {
          const currentValue = textareaRef.current.value;
          const relativePath = filePath.substring(repositoryPath.length).replace(/^\/+/, '');
          const insertion = `[File: ${relativePath}] `;
          const beforeHash = currentValue.substring(0, hashPosition);
          const afterQuery = currentValue.substring(textareaRef.current.selectionStart);
          const newValue = beforeHash + insertion + afterQuery;
          const newCursorPosition = beforeHash.length + insertion.length;

          // Create a new event to trigger the onChange
          const event = {
            target: {
              value: newValue,
              selectionStart: newCursorPosition,
              selectionEnd: newCursorPosition,
            },
          } as React.ChangeEvent<HTMLTextAreaElement>;
          onInputChange(event);

          // Update textarea value and cursor position
          setTimeout(() => {
            if (textareaRef.current) {
              textareaRef.current.value = newValue;
              textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
              textareaRef.current.focus();
            }
          }, 0);
        }

        setShowFilePicker(false);
      } catch (error) {
        logger.error('Failed to read file:', error);
      }
    };

    const handleVoiceTranscription = (transcription: string) => {
      // Create a synthetic event to update the input
      const syntheticEvent = {
        target: {
          value: input + transcription,
          selectionStart: (input + transcription).length,
          selectionEnd: (input + transcription).length,
        },
      } as React.ChangeEvent<HTMLTextAreaElement>;

      onInputChange(syntheticEvent);

      // Focus the textarea after transcription
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newLength = (input + transcription).length;
        textareaRef.current.setSelectionRange(newLength, newLength);
      }
    };

    const handleStopRecording = async () => {
      try {
        const transcription = await stopRecording();
        if (transcription.trim()) {
          handleVoiceTranscription(transcription);
        }
      } catch (error) {
        logger.error('Failed to stop recording:', error);
      }
    };

    const handleCancelRecording = () => {
      cancelRecording();
    };

    const handleFilePickerClose = () => {
      setShowFilePicker(false);
    };

    const handleCommandSelect = (command: Command, rawArgs: string) => {
      if (textareaRef.current && slashPosition !== -1) {
        const currentValue = textareaRef.current.value;
        const beforeSlash = currentValue.substring(0, slashPosition);
        const afterCommand = currentValue.substring(textareaRef.current.selectionStart);

        // Replace the command query with the selected command
        const commandText = `/${command.name}${rawArgs ? ` ${rawArgs}` : ''}`;
        const newValue = beforeSlash + commandText + afterCommand;
        const newCursorPosition = beforeSlash.length + commandText.length;

        // Create a new event to trigger the onChange
        const event = {
          target: {
            value: newValue,
            selectionStart: newCursorPosition,
            selectionEnd: newCursorPosition,
          },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        onInputChange(event);

        // Update textarea value and cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.value = newValue;
            textareaRef.current.setSelectionRange(newCursorPosition, newCursorPosition);
            textareaRef.current.focus();
          }
        }, 0);

        // Execute command if callback is provided
        if (onCommandExecute) {
          onCommandExecute(command, rawArgs);
        }
      }

      setShowCommandPicker(false);
    };

    const handleCommandPickerClose = () => {
      setShowCommandPicker(false);
    };

    const checkModelImageSupport = useCallback(
      async (modelIdentifier: string): Promise<boolean> => {
        try {
          const { availableModels } = useModelStore.getState();

          // Parse model identifier (format: "modelKey@provider" or just "modelKey")
          const modelKey = modelIdentifier.split('@')[0];

          const model = availableModels.find((m) => m.key === modelKey);
          return model?.imageInput ?? false;
        } catch (error) {
          logger.error('Failed to check model image support:', error);
          return false;
        }
      },
      []
    );

    const showImageSupportAlert = useCallback((attachments: MessageAttachment[]) => {
      // Prevent double-triggering of the alert
      if (isShowingAlertRef.current) {
        logger.info('Alert already showing, ignoring duplicate call');
        return;
      }
      isShowingAlertRef.current = true;
      setPendingImageAttachments(attachments);
      setShowImageAlert(true);
    }, []);

    const handleImageAlertChange = useCallback((open: boolean) => {
      setShowImageAlert(open);
      // Reset guard flag when alert is closed
      if (!open) {
        isShowingAlertRef.current = false;
      }
    }, []);

    const handleImageAlertCancel = useCallback(() => {
      // User cancelled without selecting a model, clear pending attachments
      setPendingImageAttachments([]);
    }, []);

    const handleModelSelect = useCallback(
      async (modelKey: string) => {
        try {
          // Set the current model
          await modelService.setCurrentModel(modelKey);

          // Add pending image attachments if any
          if (pendingImageAttachments.length > 0) {
            setAttachments((prev) => [...prev, ...pendingImageAttachments]);
            setPendingImageAttachments([]);
          }

          logger.info(`Successfully switched model to ${modelKey} and added pending images`);
        } catch (error) {
          logger.error('Failed to switch model:', error);
          toast.error(t.Chat.model.switchFailed);
        }
      },
      [pendingImageAttachments, t]
    );

    const handleImageUpload = async () => {
      const newAttachments = await uploadImage();
      if (newAttachments.length > 0) {
        logger.debug(`Uploaded ${newAttachments.length} image(s):`, newAttachments);

        const currentModel = await modelService.getCurrentModel();
        if (currentModel) {
          const supportsImages = await checkModelImageSupport(currentModel);

          if (!supportsImages) {
            showImageSupportAlert(newAttachments);
            return;
          }
        }

        // If model supports images or no model is selected, add attachments
        setAttachments((prev) => [...prev, ...newAttachments]);
      }
    };

    const handleFileUpload = async () => {
      const attachment = await uploadFile();
      if (attachment) {
        const isDuplicate = attachments.some((att) => att.filename === attachment.filename);
        if (isDuplicate) {
          return;
        }
        logger.debug('File uploaded:', attachment);
        logger.debug('File size:', attachment.size);
        setAttachments((prev) => [...prev, attachment]);
      }
    };

    const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      try {
        // Delegate all clipboard handling to the service
        const newAttachments = await fileUploadService.handlePasteEvent(e);

        if (newAttachments.length > 0) {
          // Prevent default paste behavior
          e.preventDefault();

          // Check if any of the pasted items are images
          const imageAttachments = newAttachments.filter((att) => att.type === 'image');

          if (imageAttachments.length > 0) {
            // Check if current model supports images
            const currentModel = await modelService.getCurrentModel();

            if (currentModel) {
              const supportsImages = await checkModelImageSupport(currentModel);
              if (!supportsImages) {
                showImageSupportAlert(imageAttachments);
                return;
              }
            }
          }

          // Add to attachments state
          setAttachments((prev) => [...prev, ...newAttachments]);

          // Show success message
          const message =
            newAttachments.length === 1
              ? t.Chat.image.pasteSuccess(newAttachments[0]?.filename ?? 'unknown')
              : t.Chat.image.pasteMultipleSuccess(newAttachments.length);
          toast.success(message);

          logger.info('✅ Paste completed successfully, attachments:', newAttachments.length);
        }
      } catch (error) {
        logger.error('Failed to handle paste:', error);
        toast.error(t.Error.generic);
      }
    };

    const removeAttachment = (attachmentId: string) => {
      setAttachments((prev) => prev.filter((att) => att.id !== attachmentId));
    };

    // HTML5 drag/drop handlers are required to prevent browser default behavior
    // Without preventDefault(), the browser intercepts the drop and Tauri events don't fire
    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault(); // Required to allow dropping
      e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault(); // Prevent browser from opening the file
      e.stopPropagation();
      // Actual file processing is handled by Tauri's file-drop event
    };

    const handleSubmit = (e: React.FormEvent) => {
      const attachmentsToSend = attachments.length > 0 ? attachments : undefined;
      onSubmit(e, attachmentsToSend);

      setAttachments([]);
    };

    const handleInputKeydown = (e: React.KeyboardEvent) => {
      // Don't handle Enter if file picker or command picker is open
      if (showFilePicker || showCommandPicker) {
        return;
      }

      // Don't submit if IME composition is in progress (e.g., Chinese input method)
      if (e.code === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        handleSubmit(e);
      }
    };

    const handleAddCurrentFile = () => {
      if (selectedFile && fileContent) {
        // Check if current file is already attached
        if (isAttachmentExists(selectedFile)) {
          return;
        }

        const fileName = repositoryService.getFileNameFromPath(selectedFile);
        const language = repositoryService.getLanguageFromExtension(fileName);

        const codeAttachment: MessageAttachment = {
          id: generateId(),
          filename: fileName,
          type: 'code',
          filePath: selectedFile,
          content: fileContent,
          mimeType: language,
          size: new Blob([fileContent]).size,
        };

        setAttachments((prev) => [codeAttachment, ...prev]);
      }
    };

    const addFileToChat = useCallback(
      async (filePath: string, fileContent: string) => {
        // Check if file is already attached
        if (isAttachmentExists(filePath)) {
          return;
        }

        const fileName = repositoryService.getFileNameFromPath(filePath);
        const language = repositoryService.getLanguageFromExtension(fileName);

        const codeAttachment: MessageAttachment = {
          id: generateId(),
          filename: fileName,
          type: 'code',
          filePath,
          content: fileContent,
          mimeType: language,
          size: new Blob([fileContent]).size,
        };

        setAttachments((prev) => [codeAttachment, ...prev]);
      },
      [isAttachmentExists]
    );

    // Listen for Tauri file drop events
    // biome-ignore lint/correctness/useExhaustiveDependencies: showImageSupportAlert is stable (useCallback with [])
    useEffect(() => {
      logger.info('[INIT] Setting up Tauri drag-drop listener...');
      let mounted = true;

      const setupFileDropListener = async () => {
        try {
          const window = getCurrentWindow();
          logger.info('[INIT] Got current window:', window.label);

          // Listen for drag-enter to show drop zone
          const unlistenDragEnter = await window.listen('tauri://drag-enter', () => {
            if (!mounted) return;
            logger.info('🔵 Tauri drag-enter event triggered!');
            setIsDragging(true);
          });

          // Listen for drag-over (optional, for debugging)
          const unlistenDragOver = await window.listen('tauri://drag-over', () => {
            // Don't log every drag-over to avoid spam
            // logger.info('🟡 Tauri drag-over event triggered!');
          });

          // Listen for drag-leave to hide drop zone
          const unlistenDragLeave = await window.listen('tauri://drag-leave', () => {
            if (!mounted) return;
            logger.info('🔴 Tauri drag-leave event triggered!');
            setIsDragging(false);
          });

          // Listen for drag-drop (the correct event name in Tauri 2)
          const unlistenFileDrop = await window.listen<{ paths: string[] }>(
            'tauri://drag-drop',
            async (event) => {
              if (!mounted) return;

              logger.info('🎯 Tauri drag-drop event triggered');
              setIsDragging(false); // Hide drop zone immediately

              const filePaths = event.payload.paths;
              logger.info('Dropped files:', filePaths);

              if (!filePaths || filePaths.length === 0) {
                logger.info('No files in drop event');
                return;
              }

              // Delegate to file upload service
              try {
                const attachments = await fileUploadService.uploadImagesFromPaths(filePaths);

                if (attachments.length > 0) {
                  // Check if current model supports images
                  const currentModel = await modelService.getCurrentModel();

                  if (currentModel) {
                    const supportsImages = await checkModelImageSupport(currentModel);

                    if (!supportsImages) {
                      showImageSupportAlert(attachments);
                      return;
                    }
                  }

                  setAttachments((prev) => [...prev, ...attachments]);

                  const message =
                    attachments.length === 1
                      ? t.Chat.image.pasteSuccess(attachments[0]?.filename ?? 'unknown')
                      : t.Chat.image.pasteMultipleSuccess(attachments.length);
                  toast.success(message);

                  logger.info('✅ Drag-drop completed successfully:', attachments.length);
                }
              } catch (error) {
                logger.error('Failed to process dropped files:', error);
                toast.error(t.Error.generic);
              }
            }
          );

          logger.info('✅ All drag/drop listeners registered successfully');

          // Return cleanup function that unregisters all listeners
          return () => {
            // Safely call unlisten functions (they might be undefined if setup failed)
            unlistenDragEnter?.();
            unlistenDragOver?.();
            unlistenDragLeave?.();
            unlistenFileDrop?.();
          };
        } catch (error) {
          logger.error('❌ Failed to setup file drop listener:', error);
          throw error;
        }
      };

      let cleanupFn: (() => void) | null = null;

      setupFileDropListener()
        .then((unlisten) => {
          if (mounted) {
            cleanupFn = unlisten;
            logger.info('File drop listener setup complete');
          } else {
            // If component unmounted before setup completed, cleanup immediately
            unlisten();
          }
        })
        .catch((error) => {
          logger.error('Error in setupFileDropListener:', error);
        });

      return () => {
        mounted = false;
        logger.info('Cleaning up file drop listeners');
        if (cleanupFn) {
          cleanupFn();
          logger.info('File drop listeners unregistered');
        }
      };
    }, [checkModelImageSupport]);

    useImperativeHandle(
      ref,
      () => ({
        addFileToChat,
        appendToInput: (text: string) => {
          if (textareaRef.current) {
            const newValue = input + text;
            textareaRef.current.value = newValue;
            // Create a synthetic event to trigger the change handler
            const event = {
              target: textareaRef.current,
              currentTarget: textareaRef.current,
            } as React.ChangeEvent<HTMLTextAreaElement>;
            onInputChange(event);
          }
        },
      }),
      [addFileToChat, input, onInputChange]
    );

    if (settingsLoading) {
      return (
        <div className="flex-shrink-0 border-t bg-background p-4">
          <div className="flex h-16 items-center justify-center">
            <span className="text-muted-foreground text-sm">{t.Common.loading}</span>
          </div>
        </div>
      );
    }

    return (
      <>
        <div className="w-full flex-shrink-0 bg-background px-4 pb-8">
          {attachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <FilePreview
                  attachment={attachment}
                  key={attachment.id}
                  onRemove={() => removeAttachment(attachment.id)}
                />
              ))}
            </div>
          )}

          <section
            className="relative mt-2"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            aria-label="Drop zone for images"
          >
            {isDragging && (
              <div
                className="absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 backdrop-blur-sm"
                style={{ pointerEvents: 'none' }}
              >
                <div className="flex flex-col items-center gap-2">
                  <Image size={32} className="text-primary" />
                  <p className="text-sm font-medium text-primary">{t.Chat.image.dropHere}</p>
                </div>
              </div>
            )}

            <ChatInputToolsBar
              conversationId={conversationId}
              disabled={isLoading}
              onAddCurrentFile={handleAddCurrentFile}
            />

            <PromptInput
              className={`${isDragging ? 'ring-2 ring-primary ring-offset-2 bg-accent/50' : ''}`}
              onSubmit={handleSubmit}
            >
              <TextareaAutosize
                aria-label="Search"
                className={`mb-8 w-full resize-none overflow-y-auto border-0 bg-transparent p-4 text-sm outline-0 ring-0 placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 ${
                  isRecording && partialTranscript ? 'text-muted-foreground italic' : ''
                }`}
                maxRows={10}
                minRows={1}
                onChange={handleInputChange}
                onKeyDown={handleInputKeydown}
                onPaste={handlePaste}
                placeholder={t.Chat.placeholder}
                ref={textareaRef}
                value={isRecording && partialTranscript ? input + partialTranscript : input}
                readOnly={isRecording}
              />
              <PromptInputToolbar>
                <PromptInputTools>
                  <Tooltip>
                    <DropdownMenu>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <PromptInputButton disabled={isUploading || isLoading}>
                            <Plus size={16} />
                            <span className="sr-only">{t.Chat.files.addAttachment}</span>
                          </PromptInputButton>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={handleImageUpload}>
                          <Image size={16} className="mr-2" />
                          <span>{t.Chat.files.uploadImage}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleFileUpload}>
                          <FileIcon size={16} className="mr-2" />
                          <span>{t.Chat.files.uploadFile}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <TooltipContent>
                      <p>{t.Chat.files.addAttachment}</p>
                    </TooltipContent>
                  </Tooltip>
                  <AgentSelector disabled={isLoading} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 rounded-md border-input bg-background px-3 py-1.5">
                        <span className="text-xs font-medium">{t.Chat.planMode.label}</span>
                        <Switch
                          checked={isPlanModeEnabled}
                          onCheckedChange={togglePlanMode}
                          disabled={isLoading}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isPlanModeEnabled
                          ? t.Chat.planMode.enabledTooltip
                          : t.Chat.planMode.disabledTooltip}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </PromptInputTools>
                <div className="flex items-center gap-1">
                  <VoiceInputButton
                    onStartRecording={startRecording}
                    isRecording={isRecording}
                    isTranscribing={isTranscribing}
                    isSupported={isSupported}
                    error={voiceError}
                    disabled={isLoading}
                  />
                  <PromptInputSubmit disabled={!input.trim() || isLoading} status={status} />
                </div>
              </PromptInputToolbar>
            </PromptInput>
          </section>
        </div>

        {showFilePicker && repositoryPath && (
          <FilePicker
            onClose={handleFilePickerClose}
            onFileSelect={handleFileSelect}
            position={filePickerPosition}
            repositoryPath={repositoryPath}
            searchQuery={fileSearchQuery}
          />
        )}

        {showCommandPicker && (
          <CommandPicker
            onClose={handleCommandPickerClose}
            onCommandSelect={handleCommandSelect}
            position={commandPickerPosition}
            searchQuery={commandSearchQuery}
          />
        )}

        <ImageSupportAlert
          open={showImageAlert}
          onOpenChange={handleImageAlertChange}
          onModelSelect={handleModelSelect}
          onCancel={handleImageAlertCancel}
        />

        <VoiceRecordingModal
          isOpen={isRecording || isTranscribing || isConnecting}
          isTranscribing={isTranscribing}
          isConnecting={isConnecting}
          recordingDuration={recordingDuration}
          partialTranscript={partialTranscript}
          onStop={handleStopRecording}
          onCancel={handleCancelRecording}
        />
      </>
    );
  }
);

ChatInput.displayName = 'ChatInput';
