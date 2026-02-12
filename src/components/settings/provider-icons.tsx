import {
  SiAnthropic,
  SiElevenlabs,
  SiGooglegemini,
  SiOllama,
  SiOpenaigym,
  SiVercel,
} from '@icons-pack/react-simple-icons';
import type { ComponentType } from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

// Image-based icon component for providers without simple-icons
function createImageIcon(src: string, alt: string, invertOnDark = false) {
  return function ImageIcon({ size = 16, className }: IconProps) {
    const darkModeClass = invertOnDark ? 'dark:invert dark:brightness-0 dark:contrast-100' : '';
    return (
      <img
        src={src}
        width={size}
        height={size}
        className={`${className || ''} ${darkModeClass}`.trim()}
        alt={alt}
        style={{ objectFit: 'contain' }}
      />
    );
  };
}

// Icon mapping for all providers
export const PROVIDER_ICONS: Record<string, ComponentType<IconProps>> = {
  // Providers with simple-icons
  aiGateway: SiVercel,
  // `react-simple-icons` no longer exports `SiOpenai` in current versions.
  openai: SiOpenaigym,
  anthropic: SiAnthropic,
  google: SiGooglegemini,
  ollama: SiOllama,
  elevenlabs: SiElevenlabs,

  // Providers with local SVG icons
  deepseek: createImageIcon('/icons/providers/deepseek.svg', 'DeepSeek'),
  moonshot: createImageIcon('/icons/providers/kimi.svg', 'Kimi'),
  kimi_coding: createImageIcon('/icons/providers/kimi.svg', 'Kimi Coding'),
  lmstudio: createImageIcon('/icons/providers/lmstudio.svg', 'LM Studio'),
  MiniMax: createImageIcon('/icons/providers/minimax.svg', 'Minimax'),
  openRouter: createImageIcon('/icons/providers/openrouter.svg', 'OpenRouter'),
  tavily: createImageIcon('/icons/providers/tavily.svg', 'Tavily'),
  serper: createImageIcon('/icons/providers/serpser.jpeg', 'Serper'),
  zhipu: createImageIcon('/icons/providers/zhipu.png', 'Zhipu AI'),
  github_copilot: createImageIcon('/icons/providers/github-copilot.svg', 'GitHub Copilot', true),
  zai: createImageIcon('/icons/providers/zai.svg', 'ZAI', true),
  groq: createImageIcon('/icons/providers/groq.svg', 'Groq', true),
};

// Provider icon component
export function ProviderIcon({
  providerId,
  size = 16,
  className,
}: IconProps & { providerId: string }) {
  const Icon = PROVIDER_ICONS[providerId];
  if (!Icon) return null;
  return <Icon size={size} className={className} />;
}
