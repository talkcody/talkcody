// Skills Marketplace page for discovering and installing skills

import { Download, Plus, RefreshCw, Search, Zap } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { ImportGitHubDialog } from '@/components/skills/import-github-dialog';
import { SkillCard } from '@/components/skills/skill-card';
import { SkillDetailDialog } from '@/components/skills/skill-detail-dialog';
import { SkillEditorDialog } from '@/components/skills/skill-editor-dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from '@/hooks/use-locale';
import { useMarketplaceSkills } from '@/hooks/use-marketplace-skills';
import { useSkillMutations, useSkills } from '@/hooks/use-skills';
import { getDocLinks } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import type { RemoteSkillConfig } from '@/types/remote-skills';
import type { CreateSkillRequest, Skill, SkillSortOption, UpdateSkillRequest } from '@/types/skill';

/**
 * Helper function to convert RemoteSkillConfig to Skill format for UI components
 */
function convertRemoteSkillToSkill(remoteSkill: RemoteSkillConfig): Skill {
  return {
    id: remoteSkill.id,
    name: remoteSkill.name,
    description: remoteSkill.description,
    longDescription: undefined, // Not available in simplified schema
    category: remoteSkill.category,
    icon: undefined, // Not available in simplified schema
    content: {
      systemPromptFragment: undefined,
      workflowRules: undefined,
      documentation: undefined,
      hasScripts: false,
    },
    metadata: {
      isBuiltIn: false,
      sourceType: 'remote', // Remote skill from JSON config
      tags: [], // Not available in simplified schema
      createdAt: Date.now(), // Default value
      updatedAt: Date.now(), // Default value
      // Store GitHub info in metadata for SkillCard to use
      repository: remoteSkill.repository,
      githubPath: remoteSkill.githubPath,
    },
    marketplace: {
      marketplaceId: remoteSkill.id,
      slug: remoteSkill.id, // Use id as slug for simplified schema
      author: 'Unknown', // Not available in simplified schema
      authorId: '', // Not available in simplified schema
      version: '1.0.0', // Default version
      downloads: 0, // Not available in simplified schema
      rating: 0, // Not available in simplified schema
    },
  };
}

export function SkillsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy] = useState<SkillSortOption>('name');
  const [selectedSkill, setSelectedSkill] = useState<Skill | RemoteSkillConfig | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'local'>('local');
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isGitHubImportOpen, setIsGitHubImportOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);

  const t = useTranslation();

  // Use marketplace skills hook (similar to agent marketplace)
  const marketplace = useMarketplaceSkills();

  // Memoize local skills filter
  const localFilter = React.useMemo(
    () => ({
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      search: searchQuery || undefined,
    }),
    [selectedCategory, searchQuery]
  );

  const {
    skills: localSkills,
    loading: localLoading,
    error: localError,
    refresh: refreshLocal,
  } = useSkills(localFilter, sortBy);

  // Skill mutations
  const { createSkill, updateSkill, deleteSkill } = useSkillMutations();

  // Load marketplace data based on active tab and filters
  React.useEffect(() => {
    if (activeTab === 'all') {
      marketplace.loadSkills({
        search: searchQuery || undefined,
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        sort: sortBy,
      });
    }
  }, [activeTab, searchQuery, selectedCategory, sortBy, marketplace]);

  // Categories and tags are now loaded automatically with skills

  // Get displayed skills based on active tab
  const displayedSkills = React.useMemo(() => {
    if (activeTab === 'all') {
      return marketplace.skills;
    }
    // My Skills tab - filter out marketplace skills
    return localSkills.filter((skill) => !skill.marketplace);
  }, [activeTab, marketplace.skills, localSkills]);

  // Get loading and error states based on active tab
  const loading = activeTab === 'local' ? localLoading : marketplace.isLoading;
  const error =
    activeTab === 'local' ? localError : marketplace.error ? new Error(marketplace.error) : null;

  const handleRefresh = () => {
    logger.info('Refreshing skills marketplace...');
    if (activeTab === 'all') {
      marketplace.loadSkills({
        search: searchQuery || undefined,
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        sort: sortBy,
      });
    } else {
      refreshLocal();
    }
    toast.success(t.Skills.page.refreshed);
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
  };

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
  };

  const handleSkillClick = (skill: Skill | RemoteSkillConfig) => {
    // Only open details for local skills (non-remote)
    const isRemote = 'repository' in skill;
    if (isRemote) {
      return;
    }
    setSelectedSkill(skill);
  };

  const handleCloseDetail = () => {
    setSelectedSkill(null);
  };

  const handleCreateNew = () => {
    setEditingSkill(null);
    setIsEditorOpen(true);
  };

  const handleEdit = (skill: Skill) => {
    setEditingSkill(skill);
    setIsEditorOpen(true);
  };

  const handleDelete = (skill: Skill) => {
    setDeletingSkill(skill);
  };

  const handleConfirmDelete = async () => {
    if (!deletingSkill) return;

    try {
      await deleteSkill(deletingSkill.id);
      toast.success(t.Skills.page.deleted);
      refreshLocal();
    } catch (error) {
      logger.error('Failed to delete skill:', error);
      toast.error(t.Skills.page.deleteFailed);
    } finally {
      setDeletingSkill(null);
    }
  };

  const handleSaveSkill = async (skillData: Partial<Skill>) => {
    if (editingSkill) {
      // Transform Partial<Skill> to UpdateSkillRequest
      const updateRequest: UpdateSkillRequest = {
        name: skillData.name,
        description: skillData.description,
        longDescription: skillData.longDescription,
        category: skillData.category,
        icon: skillData.icon,
        content: skillData.content ? { ...skillData.content } : undefined,
        tags: skillData.metadata?.tags,
      };
      await updateSkill(editingSkill.id, updateRequest);
    } else {
      // Transform Partial<Skill> to CreateSkillRequest
      if (!skillData.name || !skillData.description || !skillData.category || !skillData.content) {
        throw new Error('Name, description, category, and content are required to create a skill');
      }
      const createRequest: CreateSkillRequest = {
        name: skillData.name,
        description: skillData.description,
        longDescription: skillData.longDescription,
        category: skillData.category,
        icon: skillData.icon,
        content: skillData.content,
        tags: skillData.metadata?.tags,
      };
      await createSkill(createRequest);
    }
    refreshLocal();
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingSkill(null);
  };

  const handleInstall = async (skill: Skill | RemoteSkillConfig) => {
    try {
      // Check if this is a RemoteSkillConfig (has repository) or converted Skill (has marketplace metadata)
      const isRemoteSkill =
        'repository' in skill || Boolean((skill as Skill).marketplace?.marketplaceId);

      if (!isRemoteSkill) {
        logger.warn('Attempted to install a non-remote skill');
        return;
      }

      // Extract repository and githubPath from skill
      // If it's a RemoteSkillConfig, use the fields directly
      // If it's a converted Skill, get from marketplace metadata
      const repository = 'repository' in skill ? skill.repository : '';
      const githubPath = 'githubPath' in skill ? skill.githubPath : '';
      const marketplaceId =
        'repository' in skill ? skill.id : (skill as Skill).marketplace?.marketplaceId;
      const version = 'repository' in skill ? '1.0.0' : (skill as Skill).marketplace?.version;

      if (!repository) {
        throw new Error('Skill repository is required for installation');
      }

      if (!githubPath) {
        throw new Error('Skill GitHub path is required for installation');
      }

      if (!marketplaceId) {
        throw new Error('Skill marketplace ID is required for installation');
      }

      if (!version) {
        throw new Error('Skill version is required for installation');
      }

      // Work with the skill as Skill type (it's already converted from RemoteSkillConfig)
      const convertedSkill = skill as Skill;

      // Import GitHub import service
      const { importSkillFromGitHub } = await import('@/services/skills/github-import-service');

      // Step 1: Download and extract skill package from GitHub
      logger.info('Downloading skill package from GitHub:', convertedSkill.name);
      await importSkillFromGitHub({
        repository,
        path: githubPath,
        skillId: marketplaceId,
      });

      logger.info('Skill package installed successfully from GitHub:', {
        name: convertedSkill.name,
        repository,
        githubPath,
      });

      // Refresh local skills list
      refreshLocal();

      toast.success(t.Skills.page.installed(convertedSkill.name));
    } catch (error) {
      logger.error('Failed to install skill:', error);
      toast.error(
        t.Skills.page.installFailed(error instanceof Error ? error.message : 'Unknown error')
      );
      throw error;
    }
  };

  const handleShare = (skill: Skill) => {
    // TODO: Implement share functionality
    logger.info('Share skill:', skill.name);
  };

  // Get unique categories based on active tab
  const categories = React.useMemo(() => {
    if (activeTab === 'local') {
      return Array.from(new Set(localSkills.map((s) => s.category))).sort();
    }
    // Use marketplace categories (already string[])
    return marketplace.categories;
  }, [activeTab, localSkills, marketplace.categories]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Zap className="h-6 w-6 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold">{t.Skills.title}</h1>
                <HelpTooltip
                  title={t.Skills.page.tooltipTitle}
                  description={t.Skills.page.tooltipDescription}
                  docUrl={getDocLinks().features.skills}
                />
              </div>
              <p className="text-sm text-muted-foreground">{t.Skills.page.description}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="default" size="sm" onClick={handleCreateNew}>
              <Plus className="h-4 w-4 mr-2" />
              {t.Skills.page.createNew}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setIsGitHubImportOpen(true)}>
              <Download className="h-4 w-4 mr-2" />
              {t.Skills.page.importFromGitHub}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {t.Skills.page.refresh}
            </Button>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t.Skills.page.searchPlaceholder}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={selectedCategory} onValueChange={handleCategoryChange}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t.Skills.page.allCategories}</SelectItem>
              {categories.map((category) => (
                <SelectItem key={category} value={category}>
                  {category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'all' | 'local')}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="border-b border-border px-6 flex-shrink-0">
          <TabsList>
            <TabsTrigger value="local">{t.Skills.page.localSkills}</TabsTrigger>
            {/* <TabsTrigger value="featured">Featured</TabsTrigger> */}
            <TabsTrigger value="all">{t.Skills.page.remoteSkills}</TabsTrigger>
          </TabsList>
        </div>

        {/* Content */}
        <TabsContent value="local" className="m-0 flex-1 min-h-0">
          <div className="h-full overflow-auto">
            <SkillsGrid
              skills={displayedSkills}
              loading={loading}
              error={error}
              onSkillClick={handleSkillClick}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onShare={handleShare}
              emptyMessage={t.Skills.page.noSkillsYet}
              loadingMessage={t.Skills.page.loading}
              loadFailedMessage={t.Skills.page.loadFailed}
            />
          </div>
        </TabsContent>

        <TabsContent value="all" className="m-0 flex-1 min-h-0">
          <div className="h-full overflow-auto">
            <SkillsGrid
              skills={displayedSkills}
              loading={loading}
              error={error}
              onSkillClick={handleSkillClick}
              onInstall={handleInstall}
              emptyMessage={t.Skills.page.noSkillsFound}
              loadingMessage={t.Skills.page.loading}
              loadFailedMessage={t.Skills.page.loadFailed}
            />
          </div>
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      {selectedSkill && (
        <SkillDetailDialog
          skill={
            'repository' in selectedSkill ? convertRemoteSkillToSkill(selectedSkill) : selectedSkill
          }
          open={true}
          onOpenChange={(open) => !open && handleCloseDetail()}
          onClose={handleCloseDetail}
          onEdit={activeTab === 'local' ? handleEdit : undefined}
          onDelete={activeTab === 'local' ? handleDelete : undefined}
          onInstall={activeTab !== 'local' ? handleInstall : undefined}
          isInstalled={activeTab === 'local'}
        />
      )}

      {/* Editor Dialog */}
      <SkillEditorDialog
        skill={editingSkill}
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSave={handleSaveSkill}
        onClose={handleCloseEditor}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingSkill} onOpenChange={(open) => !open && setDeletingSkill(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.Skills.page.deleteTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.Skills.page.deleteDescription(deletingSkill?.name || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.Common.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t.Common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* GitHub Import Dialog */}
      <ImportGitHubDialog
        open={isGitHubImportOpen}
        onOpenChange={setIsGitHubImportOpen}
        onImportComplete={refreshLocal}
      />
    </div>
  );
}

// Skills Grid Component
function SkillsGrid({
  skills,
  loading,
  error,
  onSkillClick,
  onEdit,
  onDelete,
  onShare,
  onInstall,
  emptyMessage,
  loadingMessage,
  loadFailedMessage,
}: {
  skills: (Skill | RemoteSkillConfig)[];
  loading: boolean;
  error: Error | null;
  onSkillClick: (skill: Skill | RemoteSkillConfig) => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onShare?: (skill: Skill) => void;
  onInstall?: (skill: Skill | RemoteSkillConfig) => Promise<void>;
  emptyMessage?: string;
  loadingMessage?: string;
  loadFailedMessage?: string;
}) {
  if (loading) {
    return (
      <div className="p-8 text-center">
        <RefreshCw className="h-8 w-8 mx-auto mb-4 animate-spin text-muted-foreground" />
        <p className="text-muted-foreground">{loadingMessage || 'Loading skills...'}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-destructive mb-4">
          <p className="font-semibold">{loadFailedMessage || 'Failed to load skills'}</p>
          <p className="text-sm text-muted-foreground mt-2">{error.message}</p>
        </div>
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <Zap className="h-12 w-12 mx-auto mb-4 opacity-50" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {skills.map((skill) => {
          const isLocalSkill = !('repository' in skill);
          // Convert RemoteSkillConfig to Skill format for display
          const displaySkill: Skill = isLocalSkill
            ? (skill as Skill)
            : convertRemoteSkillToSkill(skill as RemoteSkillConfig);

          return (
            <SkillCard
              key={skill.id}
              skill={displaySkill}
              onClick={() => onSkillClick(skill)}
              showActions={Boolean(onEdit || onDelete || onShare || onInstall)}
              onEdit={onEdit && isLocalSkill ? () => onEdit(skill as Skill) : undefined}
              onDelete={onDelete && isLocalSkill ? () => onDelete(skill as Skill) : undefined}
              onShare={onShare && isLocalSkill ? () => onShare(skill as Skill) : undefined}
              onInstall={onInstall && !isLocalSkill ? () => onInstall(skill) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
