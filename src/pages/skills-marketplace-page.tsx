// Skills Marketplace page for discovering and installing skills

import { Plus, RefreshCw, Search, Zap } from 'lucide-react';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { ChecksumWarningDialog } from '@/components/skills/checksum-warning-dialog';
import { PublishSkillDialog } from '@/components/skills/publish-skill-dialog';
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
import { DOC_LINKS } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import type { MarketplaceSkill, Skill, SkillSortOption } from '@/types/skill';

/**
 * Helper function to convert MarketplaceSkill to Skill format for UI components
 */
function convertMarketplaceSkillToSkill(marketplaceSkill: MarketplaceSkill): Skill {
  // Extract first category name or use 'General' as default
  const categoryName =
    marketplaceSkill.categories && marketplaceSkill.categories.length > 0
      ? (marketplaceSkill.categories[0]?.name ?? 'General')
      : 'General';

  return {
    id: marketplaceSkill.id,
    name: marketplaceSkill.name,
    description: marketplaceSkill.description,
    longDescription: marketplaceSkill.longDescription,
    category: categoryName,
    icon: marketplaceSkill.iconUrl,
    content: {
      systemPromptFragment: marketplaceSkill.systemPromptFragment,
      workflowRules: marketplaceSkill.workflowRules,
      documentation: marketplaceSkill.documentation,
      hasScripts: marketplaceSkill.hasScripts,
    },
    metadata: {
      isBuiltIn: false,
      sourceType: 'marketplace',
      tags: marketplaceSkill.tags?.map((t) => t.name) || [],
      createdAt: new Date(marketplaceSkill.createdAt).getTime(),
      updatedAt: new Date(marketplaceSkill.updatedAt).getTime(),
    },
    marketplace: {
      marketplaceId: marketplaceSkill.id,
      slug: marketplaceSkill.slug,
      author: marketplaceSkill.author?.name || 'Unknown',
      authorId: marketplaceSkill.author?.id || '',
      version: marketplaceSkill.latestVersion || '1.0.0',
      downloads: marketplaceSkill.installCount || 0,
      rating: marketplaceSkill.rating || 0,
    },
  };
}

export function SkillsMarketplacePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<SkillSortOption>('downloads');
  const [selectedSkill, setSelectedSkill] = useState<Skill | MarketplaceSkill | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'featured' | 'local'>('local');
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [publishingSkill, setPublishingSkill] = useState<Skill | null>(null);
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  const [deletingSkill, setDeletingSkill] = useState<Skill | null>(null);
  const [checksumWarning, setChecksumWarning] = useState<{
    skillName: string;
    expectedChecksum: string;
    actualChecksum: string;
    onContinue: () => void;
    onCancel: () => void;
  } | null>(null);

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
    } else if (activeTab === 'featured') {
      marketplace.loadFeaturedSkills();
    }
  }, [
    activeTab,
    searchQuery,
    selectedCategory,
    sortBy,
    marketplace.loadSkills,
    marketplace.loadFeaturedSkills,
  ]);

  // Load categories and tags on mount
  React.useEffect(() => {
    marketplace.loadCategories();
    marketplace.loadTags();
  }, [marketplace.loadCategories, marketplace.loadTags]);

  // Get displayed skills based on active tab
  const displayedSkills = React.useMemo(() => {
    if (activeTab === 'all') {
      return marketplace.skills;
    }
    if (activeTab === 'featured') {
      return marketplace.featuredSkills;
    }
    // My Skills tab - filter out marketplace skills
    return localSkills.filter((skill) => !skill.marketplace);
  }, [activeTab, marketplace.skills, marketplace.featuredSkills, localSkills]);

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
    } else if (activeTab === 'featured') {
      marketplace.loadFeaturedSkills();
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

  const handleSortChange = (value: SkillSortOption) => {
    setSortBy(value);
  };

  const handleSkillClick = (skill: Skill | MarketplaceSkill) => {
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
      await updateSkill(editingSkill.id, skillData);
    } else {
      await createSkill(skillData);
    }
    refreshLocal();
  };

  const handleCloseEditor = () => {
    setIsEditorOpen(false);
    setEditingSkill(null);
  };

  const handleInstall = async (skill: Skill | MarketplaceSkill) => {
    try {
      // Check if this is a MarketplaceSkill (has slug) or converted Skill (has marketplace metadata)
      const isMarketplaceSkill =
        'slug' in skill || Boolean((skill as Skill).marketplace?.marketplaceId);

      if (!isMarketplaceSkill) {
        logger.warn('Attempted to install a non-marketplace skill');
        return;
      }

      // Extract slug and version from skill
      // If it's a MarketplaceSkill, use the slug directly
      // If it's a converted Skill, get slug from marketplace metadata
      const slug = 'slug' in skill ? skill.slug : (skill as Skill).marketplace?.slug;
      const marketplaceId =
        'slug' in skill ? skill.id : (skill as Skill).marketplace?.marketplaceId;
      const version = 'slug' in skill ? skill.latestVersion : (skill as Skill).marketplace?.version;

      if (!slug) {
        throw new Error('Skill slug is required for installation');
      }

      if (!marketplaceId) {
        throw new Error('Skill marketplace ID is required for installation');
      }

      if (!version) {
        throw new Error('Skill version is required for installation');
      }

      // Work with the skill as Skill type (it's already converted from MarketplaceSkill)
      const convertedSkill = skill as Skill;

      // Import marketplace service
      const { marketplaceService } = await import('@/services/skills/marketplace-service');

      // Step 1: Download and extract skill package from R2
      logger.info('Downloading skill package from R2:', convertedSkill.name);
      const installResult = await marketplaceService.installSkill({
        skillId: marketplaceId,
        version: version,
        metadata: {
          skillId: marketplaceId,
          name: convertedSkill.name,
          description: convertedSkill.description,
          longDescription: convertedSkill.longDescription,
          author: {
            name: convertedSkill.marketplace?.author || 'Unknown',
            url: undefined,
          },
          version: version,
          tags: convertedSkill.metadata?.tags || [],
          license: 'MIT',
          requiredPermission: 'read-only',
          storageUrl: '',
          packageSize: 0,
          publishedAt: convertedSkill.metadata?.createdAt || Date.now(),
          updatedAt: convertedSkill.metadata?.updatedAt || Date.now(),
          downloadCount: convertedSkill.marketplace?.downloads || 0,
          rating: convertedSkill.marketplace?.rating,
          ratingCount: 0,
        },
        onChecksumMismatch: async (expectedChecksum, actualChecksum) => {
          return new Promise<boolean>((resolve) => {
            setChecksumWarning({
              skillName: convertedSkill.name,
              expectedChecksum,
              actualChecksum,
              onContinue: () => {
                setChecksumWarning(null);
                resolve(true);
              },
              onCancel: () => {
                setChecksumWarning(null);
                resolve(false);
              },
            });
          });
        },
      });

      if (!installResult.success) {
        throw new Error(installResult.error || 'Failed to install skill package');
      }

      logger.info('Skill package installed successfully:', {
        name: installResult.name,
        localPath: installResult.localPath,
      });

      // Step 2: Track installation in marketplace API
      await marketplace.installSkill(slug, version);

      // Step 4: Refresh local skills list
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
    setPublishingSkill(skill);
    setIsPublishDialogOpen(true);
  };

  const handlePublishSuccess = () => {
    refreshLocal();
    marketplace.loadSkills({
      search: searchQuery || undefined,
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      sort: sortBy,
    });
    setIsPublishDialogOpen(false);
    setPublishingSkill(null);
  };

  const handleClosePublishDialog = () => {
    setIsPublishDialogOpen(false);
    setPublishingSkill(null);
  };

  // Get unique categories based on active tab
  const categories = React.useMemo(() => {
    if (activeTab === 'local') {
      return Array.from(new Set(localSkills.map((s) => s.category))).sort();
    }
    // Use marketplace categories if available, otherwise extract from skills
    if (marketplace.categories.length > 0) {
      return marketplace.categories.map((c) => c.name).sort();
    }
    // Extract unique category names from marketplace skills
    const categorySet = new Set<string>();
    for (const skill of marketplace.skills) {
      if (skill.categories && skill.categories.length > 0) {
        for (const category of skill.categories) {
          categorySet.add(category.name);
        }
      }
    }
    return Array.from(categorySet).sort();
  }, [activeTab, localSkills, marketplace.skills, marketplace.categories]);

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
                  docUrl={DOC_LINKS.features.skills}
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

          <Select
            value={sortBy}
            onValueChange={(value) => handleSortChange(value as SkillSortOption)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">{t.Skills.page.sortName}</SelectItem>
              <SelectItem value="downloads">{t.Skills.page.sortDownloads}</SelectItem>
              <SelectItem value="rating">{t.Skills.page.sortRating}</SelectItem>
              <SelectItem value="recent">{t.Skills.page.sortRecent}</SelectItem>
              <SelectItem value="updated">{t.Skills.page.sortUpdated}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'all' | 'featured' | 'local')}
        className="flex-1 flex flex-col"
      >
        <div className="border-b border-border px-6">
          <TabsList>
            <TabsTrigger value="local">{t.Skills.page.localSkills}</TabsTrigger>
            {/* <TabsTrigger value="featured">Featured</TabsTrigger> */}
            <TabsTrigger value="all">{t.Skills.page.remoteSkills}</TabsTrigger>
          </TabsList>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          <TabsContent value="local" className="m-0 h-full">
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
          </TabsContent>

          {/* <TabsContent value="featured" className="m-0 h-full">
            <SkillsGrid
              skills={displayedSkills}
              loading={loading}
              error={error}
              onSkillClick={handleSkillClick}
              emptyMessage="No featured skills available"
            />
          </TabsContent> */}

          <TabsContent value="all" className="m-0 h-full">
            <SkillsGrid
              skills={displayedSkills}
              loading={loading}
              error={error}
              onSkillClick={handleSkillClick}
              emptyMessage={t.Skills.page.noSkillsFound}
              loadingMessage={t.Skills.page.loading}
              loadFailedMessage={t.Skills.page.loadFailed}
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Detail Dialog */}
      {selectedSkill && (
        <SkillDetailDialog
          skill={
            'slug' in selectedSkill ? convertMarketplaceSkillToSkill(selectedSkill) : selectedSkill
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

      {/* Publish Dialog */}
      {publishingSkill && (
        <PublishSkillDialog
          skill={publishingSkill}
          open={isPublishDialogOpen}
          onClose={handleClosePublishDialog}
          onSuccess={handlePublishSuccess}
        />
      )}

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

      {checksumWarning && (
        <ChecksumWarningDialog
          open={true}
          skillName={checksumWarning.skillName}
          expectedChecksum={checksumWarning.expectedChecksum}
          actualChecksum={checksumWarning.actualChecksum}
          onContinue={checksumWarning.onContinue}
          onCancel={checksumWarning.onCancel}
        />
      )}
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
  emptyMessage,
  loadingMessage,
  loadFailedMessage,
}: {
  skills: (Skill | MarketplaceSkill)[];
  loading: boolean;
  error: Error | null;
  onSkillClick: (skill: Skill | MarketplaceSkill) => void;
  onEdit?: (skill: Skill) => void;
  onDelete?: (skill: Skill) => void;
  onShare?: (skill: Skill) => void;
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
          const isLocalSkill = !('slug' in skill);
          // Convert MarketplaceSkill to Skill format for display
          const displaySkill: Skill = isLocalSkill
            ? (skill as Skill)
            : convertMarketplaceSkillToSkill(skill as MarketplaceSkill);

          return (
            <SkillCard
              key={skill.id}
              skill={displaySkill}
              onClick={() => onSkillClick(skill)}
              showActions={Boolean(onEdit || onDelete || onShare) && isLocalSkill}
              onEdit={onEdit && isLocalSkill ? () => onEdit(skill as Skill) : undefined}
              onDelete={onDelete && isLocalSkill ? () => onDelete(skill as Skill) : undefined}
              onShare={onShare && isLocalSkill ? () => onShare(skill as Skill) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}
