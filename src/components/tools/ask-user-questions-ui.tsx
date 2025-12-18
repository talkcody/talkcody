import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/hooks/use-locale';
import { useUserQuestionStore } from '@/stores/user-question-store';
import type { AskUserQuestionsOutput, Question } from '@/types/user-question';

interface AskUserQuestionsUIProps {
  questions: Question[];
  taskId: string;
}

export function AskUserQuestionsUI({ questions, taskId }: AskUserQuestionsUIProps) {
  const [submitted, setSubmitted] = useState(false);
  const [answers, setAnswers] = useState<Record<string, { options: string[]; text: string }>>(
    () => {
      // Initialize answers state with empty arrays and strings
      const initial: Record<string, { options: string[]; text: string }> = {};
      for (const q of questions) {
        initial[q.id] = { options: [], text: '' };
      }
      return initial;
    }
  );

  const { t } = useLocale();
  const submitAnswers = useUserQuestionStore((state) => state.submitAnswers);

  const handleOptionToggle = (questionId: string, optionLabel: string, multiSelect: boolean) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      if (!current) return prev;

      const isSelected = current.options.includes(optionLabel);

      if (multiSelect) {
        // Multi-select: toggle the option
        return {
          ...prev,
          [questionId]: {
            options: isSelected
              ? current.options.filter((o) => o !== optionLabel)
              : [...current.options, optionLabel],
            text: current.text,
          },
        };
      }
      // Single-select: replace with new selection or deselect if clicking the same option
      return {
        ...prev,
        [questionId]: {
          options: isSelected ? [] : [optionLabel],
          text: current.text,
        },
      };
    });
  };

  const handleTextChange = (questionId: string, text: string) => {
    setAnswers((prev) => {
      const current = prev[questionId];
      if (!current) return prev;

      return {
        ...prev,
        [questionId]: {
          options: current.options,
          text,
        },
      };
    });
  };

  const handleSubmit = () => {
    // Convert internal state to output format
    const output: AskUserQuestionsOutput = {};
    for (const q of questions) {
      const answer = answers[q.id];
      if (answer) {
        output[q.id] = {
          selectedOptions: answer.options,
          customText: answer.text.trim() || undefined,
        };
      }
    }

    // Submit to store with taskId
    submitAnswers(taskId, output);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <Card className="border-green-500/50 bg-green-500/10 p-4">
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <Check className="size-5" />
          <span className="font-medium">{t.AskUserQuestions.submitted}</span>
        </div>
      </Card>
    );
  }

  return (
    <Card className="border-blue-500/50 bg-blue-500/10 p-4 w-full overflow-hidden">
      <div className="space-y-4 min-w-0">
        <div>
          <h3 className="font-semibold text-foreground text-lg">{t.AskUserQuestions.title}</h3>
          <p className="text-muted-foreground text-sm">{t.AskUserQuestions.description}</p>
        </div>

        <Tabs defaultValue={questions[0]?.id} className="w-full">
          <TabsList className="w-full">
            {questions.map((q) => (
              <TabsTrigger key={q.id} value={q.id} className="flex-1">
                {q.header}
              </TabsTrigger>
            ))}
          </TabsList>

          {questions.map((q) => (
            <TabsContent key={q.id} value={q.id} className="mt-4 space-y-4">
              <div>
                <h4 className="font-medium text-foreground">{q.question}</h4>
                <p className="text-muted-foreground text-xs">
                  {q.multiSelect ? t.AskUserQuestions.selectMultiple : t.AskUserQuestions.selectOne}
                </p>
              </div>

              <div className="space-y-3">
                {q.options.map((option) => {
                  const isSelected = answers[q.id]?.options.includes(option.label);
                  return (
                    <div
                      key={option.label}
                      className="flex items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:bg-muted/50"
                    >
                      <Checkbox
                        id={`${q.id}-${option.label}`}
                        checked={isSelected}
                        onCheckedChange={() =>
                          handleOptionToggle(q.id, option.label, q.multiSelect)
                        }
                      />
                      <div className="flex-1 min-w-0">
                        <Label
                          htmlFor={`${q.id}-${option.label}`}
                          className="cursor-pointer font-medium text-foreground text-sm break-words"
                        >
                          {option.label}
                        </Label>
                        <p className="text-muted-foreground text-xs break-words">
                          {option.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${q.id}-custom`} className="text-foreground text-sm">
                  {t.AskUserQuestions.otherLabel}
                </Label>
                <Textarea
                  id={`${q.id}-custom`}
                  placeholder={t.AskUserQuestions.otherPlaceholder}
                  value={answers[q.id]?.text || ''}
                  onChange={(e) => handleTextChange(q.id, e.target.value)}
                  className="min-h-[80px] resize-none w-full"
                />
              </div>
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSubmit} className="min-w-[120px]">
            {t.AskUserQuestions.submitAnswers}
          </Button>
        </div>
      </div>
    </Card>
  );
}
