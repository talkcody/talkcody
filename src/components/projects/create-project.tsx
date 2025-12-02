// src/components/projects/create-project.tsx

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useLocale } from '@/hooks/use-locale';
import { useProjects } from '@/hooks/use-projects';

const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(100, 'Project name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
  context: z.string().max(2000, 'Context must be less than 2000 characters').optional(),
  rules: z.string().max(2000, 'Rules must be less than 2000 characters').optional(),
});

type CreateProjectFormValues = z.infer<typeof createProjectSchema>;

interface CreateProjectProps {
  children?: React.ReactNode;
  onProjectCreated?: () => void;
}

export function CreateProject({ children, onProjectCreated }: CreateProjectProps) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createProject } = useProjects();

  const form = useForm<CreateProjectFormValues>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      name: '',
      description: '',
      context: '',
      rules: '',
    },
  });

  const onSubmit = async (data: CreateProjectFormValues) => {
    try {
      setIsSubmitting(true);
      await createProject(data);

      toast.success(t.Projects.created(data.name));

      form.reset();
      setOpen(false);
      onProjectCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t.Projects.createFailed);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      form.reset();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {t.Projects.createNew}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>{t.Projects.createTitle}</DialogTitle>
          <DialogDescription>{t.Projects.createDescription}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.Projects.form.name}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t.Projects.form.namePlaceholder}
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.Projects.form.description}</FormLabel>
                  <FormControl>
                    <Textarea
                      className="resize-none"
                      placeholder={t.Projects.form.descriptionPlaceholder}
                      rows={2}
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>{t.Projects.form.descriptionHint}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="context"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.Projects.form.context}</FormLabel>
                  <FormControl>
                    <Textarea
                      className="resize-none"
                      placeholder={t.Projects.form.contextPlaceholder}
                      rows={3}
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>{t.Projects.form.contextHint}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rules"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.Projects.form.rules}</FormLabel>
                  <FormControl>
                    <Textarea
                      className="resize-none"
                      placeholder={t.Projects.form.rulesPlaceholder}
                      rows={3}
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription>{t.Projects.form.rulesHint}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                disabled={isSubmitting}
                onClick={() => setOpen(false)}
                type="button"
                variant="outline"
              >
                {t.Common.cancel}
              </Button>
              <Button disabled={isSubmitting} type="submit">
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t.Common.loading}
                  </>
                ) : (
                  <>
                    <Plus className="mr-2 h-4 w-4" />
                    {t.Common.create}
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
