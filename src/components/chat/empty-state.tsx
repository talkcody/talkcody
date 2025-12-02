// src/components/chat/EmptyState.tsx

import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { useLocale } from '@/hooks/use-locale';

interface EmptyStateProps {
  assistant?: {
    name?: string;
    avatar?: string;
    category?: string;
    description?: string;
    createdAt?: number;
    systemPrompt?: string;
  };
}

export function EmptyState({ assistant }: EmptyStateProps) {
  const { t } = useLocale();

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      translation: 'bg-blue-100 text-blue-800',
      coding: 'bg-green-100 text-green-800',
      writing: 'bg-purple-100 text-purple-800',
      travel: 'bg-yellow-100 text-yellow-800',
      general: 'bg-gray-100 text-gray-800',
      custom: 'bg-indigo-100 text-indigo-800',
    };
    return colors[category] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="flex h-full flex-col items-center justify-center p-4 text-gray-500">
      <div className="text-center">
        <div className="mb-4 text-4xl">{assistant?.avatar || '🤖'}</div>
        <h3 className="mb-2 font-semibold text-lg">{assistant?.name || t.Chat.emptyState.title}</h3>
        {assistant?.category && (
          <Badge className={`mb-3 ${getCategoryColor(assistant.category)}`}>
            {assistant.category.charAt(0).toUpperCase() + assistant.category.slice(1)}
          </Badge>
        )}
        <p className="mx-auto mb-4 max-w-md text-sm">
          {assistant?.description || t.Chat.emptyState.description}
        </p>
        {assistant?.systemPrompt && (
          <div className="mx-auto mb-4 max-w-md rounded-lg bg-gray-100 p-3 text-left text-xs">
            <p className="mb-1 font-medium">{t.Chat.emptyState.systemPrompt}</p>
            <p className="line-clamp-3">{assistant.systemPrompt}</p>
          </div>
        )}
        {assistant?.createdAt && (
          <p className="text-gray-400 text-xs">
            {t.Chat.emptyState.created} {format(new Date(assistant.createdAt), 'MMM d, yyyy')}
          </p>
        )}
      </div>
    </div>
  );
}
