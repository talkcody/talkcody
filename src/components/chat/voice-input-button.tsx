// src/components/chat/voice-input-button.tsx
import { Mic } from 'lucide-react';
import { useLocale } from '@/hooks/use-locale';
import { PromptInputButton } from '../ai-elements/prompt-input';

interface VoiceInputButtonProps {
  onStartRecording: () => void;
  isRecording: boolean;
  isTranscribing: boolean;
  isSupported: boolean;
  error: string | null;
  disabled?: boolean;
}

export function VoiceInputButton({
  onStartRecording,
  isRecording,
  isTranscribing,
  isSupported,
  error,
  disabled = false,
}: VoiceInputButtonProps) {
  const { t } = useLocale();

  const getTooltip = () => {
    if (!isSupported) {
      return t.Chat.voice.notSupported;
    }
    if (error) {
      return t.Chat.voice.error(error);
    }
    if (isRecording || isTranscribing) {
      return t.Chat.voice.stopRecording;
    }
    return t.Chat.voice.startRecording;
  };

  return (
    <PromptInputButton
      onClick={onStartRecording}
      disabled={disabled || isTranscribing || isRecording || !isSupported}
      variant={isRecording ? 'default' : 'ghost'}
      title={getTooltip()}
      className={`${isRecording ? 'animate-pulse border-red-200 bg-red-50' : ''} ${
        isSupported ? '' : 'cursor-not-allowed opacity-50'
      }`}
    >
      <Mic size={16} className={isRecording ? 'text-red-500' : ''} />
    </PromptInputButton>
  );
}
