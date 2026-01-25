import { readTextFile } from '@tauri-apps/plugin-fs';
import { Bot } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import MyMarkdown from '../chat/my-markdown';

interface CallAgentToolResultProps {
  success: boolean;
  message?: string;
  output?: string;
}

type PlanLoadState = 'idle' | 'loading' | 'loaded' | 'error';

function extractPlanFilePath(text?: string): string | null {
  if (!text) return null;

  const backtickMatch = text.match(/`([^`]+\.md)`/i);
  if (backtickMatch?.[1]) {
    return backtickMatch[1].trim();
  }

  const bareMatch = text.match(/([A-Za-z]:\\[^\s]+\.md|\/[^\s]+\.md)/i);
  if (bareMatch?.[1]) {
    return bareMatch[1].trim();
  }

  return null;
}

export function CallAgentToolResult({ success, message, output }: CallAgentToolResultProps) {
  const displayOutput = output || message;
  const planFilePath = useMemo(() => extractPlanFilePath(displayOutput), [displayOutput]);
  const [planContent, setPlanContent] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<PlanLoadState>('idle');

  useEffect(() => {
    let isActive = true;

    const loadPlan = async (filePath: string) => {
      try {
        setLoadState('loading');
        const content = await readTextFile(filePath);
        if (!isActive) return;
        setPlanContent(content);
        setLoadState('loaded');
      } catch {
        if (!isActive) return;
        setPlanContent(null);
        setLoadState('error');
      }
    };

    if (planFilePath) {
      void loadPlan(planFilePath);
    } else {
      setPlanContent(null);
      setLoadState('idle');
    }

    return () => {
      isActive = false;
    };
  }, [planFilePath]);

  const renderContent = planContent || displayOutput;

  return (
    <div className="space-y-3">
      {success && (
        <div className="border rounded-lg p-3 bg-white dark:bg-gray-900 dark:border-gray-700 w-full">
          <div className="flex items-center gap-2 text-gray-700 border-b pb-2 dark:text-gray-300 dark:border-gray-600">
            <Bot className="h-4 w-4" />
            <span className="text-sm font-medium">Agent Output</span>
          </div>

          <div className="mt-2 space-y-2">
            {loadState === 'loading' && (
              <div className="text-xs text-muted-foreground">Loading plan file...</div>
            )}
            {loadState === 'error' && displayOutput && (
              <div className="text-xs text-orange-500">
                Failed to load plan file. Showing output.
              </div>
            )}
            {renderContent && (
              <div className="prose prose-neutral dark:prose-invert w-full max-w-none">
                <MyMarkdown content={renderContent} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
