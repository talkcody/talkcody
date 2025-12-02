import { ChevronDown, Edit2, Plus, Power, PowerOff, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpTooltip } from '@/components/ui/help-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/hooks/use-locale';
import { useMultiMCPTools } from '@/hooks/use-multi-mcp-tools';
import { DOC_LINKS } from '@/lib/doc-links';
import { logger } from '@/lib/logger';
import { TransportFactory } from '@/lib/mcp/transport-factory';
import {
  type CreateMCPServerData,
  databaseService,
  type MCPServer,
  type UpdateMCPServerData,
} from '@/services/database-service';

interface MCPServerFormData {
  id: string;
  name: string;
  url: string;
  protocol: 'http' | 'sse' | 'stdio';
  api_key?: string;
  headers?: string; // JSON string
  stdio_command?: string;
  stdio_args?: string; // JSON string
}

export function MCPServersPage() {
  // Generate unique IDs for form fields
  const createIdId = useId();
  const createNameId = useId();
  const createUrlId = useId();
  const createApiKeyId = useId();
  const createHeadersId = useId();
  const createCommandId = useId();
  const createArgsId = useId();
  const editIdId = useId();
  const editNameId = useId();
  const editUrlId = useId();
  const editApiKeyId = useId();
  const editHeadersId = useId();
  const editCommandId = useId();
  const editArgsId = useId();

  const t = useTranslation();

  const {
    servers,
    isLoading,
    error,
    refreshTools,
    refreshServer,
    enableServer,
    disableServer,
    reloadData,
  } = useMultiMCPTools();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [serverToDelete, setServerToDelete] = useState<MCPServer | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [formData, setFormData] = useState<MCPServerFormData>({
    id: '',
    name: '',
    url: '',
    protocol: 'http',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setFormData({
      id: '',
      name: '',
      url: '',
      protocol: 'http',
    });
    setFormError(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setIsCreateDialogOpen(true);
  };

  const openEditDialog = (server: MCPServer) => {
    setEditingServer(server);
    setFormData({
      id: server.id,
      name: server.name,
      url: server.url,
      protocol: server.protocol,
      api_key: server.api_key || '',
      headers: JSON.stringify(server.headers || {}, null, 2),
      stdio_command: server.stdio_command || '',
      stdio_args: JSON.stringify(server.stdio_args || [], null, 2),
    });
    setFormError(null);
    setIsEditDialogOpen(true);
  };

  const validateForm = (): boolean => {
    if (!formData.id.trim()) {
      setFormError(t.MCPServers.validation.serverIdRequired);
      return false;
    }

    if (!formData.name.trim()) {
      setFormError(t.MCPServers.validation.nameRequired);
      return false;
    }

    // Validate protocol-specific fields
    if (formData.protocol === 'stdio') {
      if (!formData.stdio_command?.trim()) {
        setFormError(t.MCPServers.validation.commandRequired);
        return false;
      }
    } else {
      if (!formData.url.trim()) {
        setFormError(t.MCPServers.validation.urlRequired);
        return false;
      }

      try {
        new URL(formData.url);
      } catch {
        setFormError(t.MCPServers.validation.invalidUrl);
        return false;
      }
    }

    // Validate JSON fields
    if (formData.headers?.trim()) {
      try {
        JSON.parse(formData.headers);
      } catch {
        setFormError(t.MCPServers.validation.invalidHeaders);
        return false;
      }
    }

    if (formData.stdio_args?.trim()) {
      try {
        const args = JSON.parse(formData.stdio_args);
        if (!Array.isArray(args)) {
          setFormError(t.MCPServers.validation.argumentsMustBeArray);
          return false;
        }
      } catch {
        setFormError(t.MCPServers.validation.invalidArguments);
        return false;
      }
    }

    return true;
  };

  const handleCreateServer = async () => {
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      const serverData: CreateMCPServerData = {
        id: formData.id.trim(),
        name: formData.name.trim(),
        url: formData.url.trim(),
        protocol: formData.protocol,
        api_key: formData.api_key?.trim() || undefined,
        headers: formData.headers?.trim() ? JSON.parse(formData.headers) : undefined,
        stdio_command: formData.stdio_command?.trim() || undefined,
        stdio_args: formData.stdio_args?.trim() ? JSON.parse(formData.stdio_args) : undefined,
        is_enabled: true,
        is_built_in: false,
      };

      await databaseService.createMCPServer(serverData);
      await reloadData();
      setIsCreateDialogOpen(false);
      resetForm();

      logger.info(`Created MCP server: ${serverData.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create server';
      setFormError(message);
      logger.error('Failed to create MCP server:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateServer = async () => {
    if (!editingServer || !validateForm()) return;

    setIsSubmitting(true);
    try {
      const updateData: UpdateMCPServerData = {
        name: formData.name.trim(),
        url: formData.url.trim(),
        protocol: formData.protocol,
        api_key: formData.api_key?.trim() || undefined,
        headers: formData.headers?.trim() ? JSON.parse(formData.headers) : undefined,
        stdio_command: formData.stdio_command?.trim() || undefined,
        stdio_args: formData.stdio_args?.trim() ? JSON.parse(formData.stdio_args) : undefined,
      };

      await databaseService.updateMCPServer(editingServer.id, updateData);
      await refreshServer(editingServer.id);
      await reloadData();
      setIsEditDialogOpen(false);
      setEditingServer(null);

      logger.info(`Updated MCP server: ${editingServer.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update server';
      setFormError(message);
      logger.error('Failed to update MCP server:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteServer = (server: MCPServer) => {
    if (server.is_built_in) {
      alert('Cannot delete built-in servers');
      return;
    }

    setServerToDelete(server);
    setIsDeleteDialogOpen(true);
  };

  const confirmDeleteServer = async () => {
    if (!serverToDelete) return;

    try {
      await databaseService.deleteMCPServer(serverToDelete.id);
      await reloadData();

      logger.info(`Deleted MCP server: ${serverToDelete.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete server';
      alert(message);
      logger.error('Failed to delete MCP server:', error);
    } finally {
      setServerToDelete(null);
      setIsDeleteDialogOpen(false);
    }
  };

  const handleToggleServer = async (server: MCPServer) => {
    try {
      if (server.is_enabled) {
        await disableServer(server.id);
      } else {
        await enableServer(server.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to toggle server';
      alert(message);
      logger.error('Failed to toggle MCP server:', error);
    }
  };

  const supportedProtocols = TransportFactory.getSupportedProtocols();

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{t.MCPServers.title}</h1>
            <HelpTooltip
              title={t.MCPServers.tooltipTitle}
              description={t.MCPServers.tooltipDescription}
              docUrl={DOC_LINKS.features.mcpServers}
            />
          </div>
          <p className="text-gray-600 dark:text-gray-400 mt-1">{t.MCPServers.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshTools} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t.MCPServers.refreshAll}
          </Button>
          <Button size="sm" onClick={openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            {t.MCPServers.addServer}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-6">
          {/* Error Alert */}
          {error && (
            <Alert className="mb-6 border-red-200 bg-red-50 text-red-800">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* Servers Grid */}
          <div className="grid gap-4">
            {servers.map((serverData) => (
              <Card key={serverData.server.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Server className="h-5 w-5" />
                      <div>
                        <CardTitle className="text-lg">{serverData.server.name}</CardTitle>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {serverData.server.url || `Command: ${serverData.server.stdio_command}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Status Badges */}
                      {serverData.server.is_built_in && (
                        <Badge variant="secondary">{t.MCPServers.builtIn}</Badge>
                      )}

                      <Badge
                        variant={serverData.server.protocol === 'http' ? 'default' : 'outline'}
                      >
                        {serverData.server.protocol.toUpperCase()}
                      </Badge>

                      {serverData.isConnected ? (
                        <Badge className="bg-green-100 text-green-800">
                          {t.MCPServers.connected(serverData.toolCount)}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">{t.MCPServers.disconnected}</Badge>
                      )}

                      {/* Action Buttons */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => refreshServer(serverData.server.id)}
                            disabled={isLoading}
                          >
                            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t.MCPServers.refreshConnection}</p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleToggleServer(serverData.server)}
                            disabled={isLoading}
                          >
                            {serverData.server.is_enabled ? (
                              <Power className="h-4 w-4 text-green-600" />
                            ) : (
                              <PowerOff className="h-4 w-4 text-gray-400" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            {serverData.server.is_enabled
                              ? t.MCPServers.disableServer
                              : t.MCPServers.enableServer}
                          </p>
                        </TooltipContent>
                      </Tooltip>

                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditDialog(serverData.server)}
                            disabled={isLoading}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t.MCPServers.editServer}</p>
                        </TooltipContent>
                      </Tooltip>

                      {!serverData.server.is_built_in && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteServer(serverData.server)}
                          disabled={isLoading}
                          title="Delete server"
                          className="text-red-600 hover:text-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>

                {serverData.error && (
                  <CardContent className="pt-0">
                    <Alert className="border-red-200 bg-red-50 text-red-800">
                      <AlertDescription>{serverData.error}</AlertDescription>
                    </Alert>
                  </CardContent>
                )}

                {/* GitHub MCP Server Setup Instructions */}
                {serverData.server.id === 'github' && !serverData.server.api_key && (
                  <CardContent className="pt-0">
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Alert className="cursor-pointer border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                          <div className="flex items-center gap-2">
                            <span className="whitespace-nowrap text-sm font-medium">
                              Setup Required
                            </span>
                            <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-200 [[data-state=open]>&]:rotate-180" />
                          </div>
                        </Alert>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="mt-2 space-y-1 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                          <p>This server requires a GitHub Personal Access Token (PAT).</p>
                          <p>
                            1. Go to GitHub Settings → Developer settings → Personal access tokens →
                            Tokens (classic)
                          </p>
                          <p>
                            2. Generate a new token with these scopes:{' '}
                            <span className="inline-flex flex-wrap gap-1">
                              <code>repo</code>
                              <code>read:packages</code>
                              <code>read:org</code>
                            </span>
                          </p>
                          <p>3. Edit this server and add the token as the API Key</p>
                          <p>4. Enable the server after adding the token</p>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  </CardContent>
                )}

                {/* GitHub MCP Server Connection Error Help */}
                {serverData.server.id === 'github' &&
                  serverData.server.api_key &&
                  serverData.error && (
                    <CardContent className="pt-0">
                      <Alert className="border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950 dark:text-yellow-200">
                        <AlertDescription>
                          <strong>Connection Failed:</strong> Please check:
                          <br />• Token has correct scopes:{' '}
                          <span className="inline-flex flex-wrap gap-1">
                            <code>repo</code>
                            <code>read:packages</code>
                            <code>read:org</code>
                          </span>
                          <br />• Token is not expired
                          <br />• Network connection is available
                          <br />• GitHub API is accessible
                        </AlertDescription>
                      </Alert>
                    </CardContent>
                  )}

                {serverData.server.is_enabled && serverData.tools.length > 0 && (
                  <CardContent className="pt-0">
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      <strong>{t.MCPServers.availableTools}</strong>{' '}
                      {serverData.tools.map((tool) => tool.name).join(', ')}
                    </div>
                  </CardContent>
                )}
              </Card>
            ))}

            {servers.length === 0 && !isLoading && (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <Server className="h-12 w-12 text-gray-400 mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">
                    {t.MCPServers.noServers}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 text-center mt-2 mb-4">
                    {t.MCPServers.noServersDescription}
                  </p>
                  <Button onClick={openCreateDialog}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t.MCPServers.addServer}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Create Server Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.MCPServers.addDialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <Alert className="border-red-200 bg-red-50 text-red-800">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor={createIdId}>{t.MCPServers.form.serverId}</Label>
                <Input
                  id={createIdId}
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder={t.MCPServers.form.serverIdPlaceholder}
                />
              </div>
              <div>
                <Label htmlFor={createNameId}>{t.MCPServers.form.name}</Label>
                <Input
                  id={createNameId}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.MCPServers.form.namePlaceholder}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="create-protocol">{t.MCPServers.form.protocol}</Label>
              <Select
                value={formData.protocol}
                onValueChange={(value: 'http' | 'sse' | 'stdio') =>
                  setFormData({ ...formData, protocol: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedProtocols.map((protocol) => (
                    <SelectItem key={protocol.value} value={protocol.value}>
                      <div>
                        <div className="font-medium">{protocol.label}</div>
                        <div className="text-xs text-gray-500">{protocol.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.protocol !== 'stdio' ? (
              <>
                <div>
                  <Label htmlFor={createUrlId}>{t.MCPServers.form.url}</Label>
                  <Input
                    id={createUrlId}
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder={t.MCPServers.form.urlPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={createApiKeyId}>{t.MCPServers.form.apiKey}</Label>
                  <Input
                    id={createApiKeyId}
                    type="password"
                    value={formData.api_key || ''}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={t.MCPServers.form.apiKeyPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={createHeadersId}>{t.MCPServers.form.headers}</Label>
                  <Textarea
                    id={createHeadersId}
                    value={formData.headers || ''}
                    onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                    placeholder={t.MCPServers.form.headersPlaceholder}
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor={createCommandId}>{t.MCPServers.form.command}</Label>
                  <Input
                    id={createCommandId}
                    value={formData.stdio_command || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        stdio_command: e.target.value,
                      })
                    }
                    placeholder={t.MCPServers.form.commandPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={createArgsId}>{t.MCPServers.form.arguments}</Label>
                  <Textarea
                    id={createArgsId}
                    value={formData.stdio_args || ''}
                    onChange={(e) => setFormData({ ...formData, stdio_args: e.target.value })}
                    placeholder={t.MCPServers.form.argumentsPlaceholder}
                    rows={3}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
                disabled={isSubmitting}
              >
                {t.Common.cancel}
              </Button>
              <Button onClick={handleCreateServer} disabled={isSubmitting}>
                {isSubmitting ? t.MCPServers.actions.creating : t.MCPServers.actions.create}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Server Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.MCPServers.editDialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {formError && (
              <Alert className="border-red-200 bg-red-50 text-red-800">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor={editIdId}>{t.MCPServers.form.serverId}</Label>
                <Input
                  id={editIdId}
                  value={formData.id}
                  disabled
                  className="bg-gray-100 dark:bg-gray-800"
                />
              </div>
              <div>
                <Label htmlFor={editNameId}>{t.MCPServers.form.name}</Label>
                <Input
                  id={editNameId}
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t.MCPServers.form.namePlaceholder}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit-protocol">{t.MCPServers.form.protocol}</Label>
              <Select
                value={formData.protocol}
                onValueChange={(value: 'http' | 'sse' | 'stdio') =>
                  setFormData({ ...formData, protocol: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {supportedProtocols.map((protocol) => (
                    <SelectItem key={protocol.value} value={protocol.value}>
                      <div>
                        <div className="font-medium">{protocol.label}</div>
                        <div className="text-xs text-gray-500">{protocol.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.protocol !== 'stdio' ? (
              <>
                <div>
                  <Label htmlFor={editUrlId}>{t.MCPServers.form.url}</Label>
                  <Input
                    id={editUrlId}
                    value={formData.url}
                    onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                    placeholder={t.MCPServers.form.urlPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={editApiKeyId}>{t.MCPServers.form.apiKey}</Label>
                  <Input
                    id={editApiKeyId}
                    type="password"
                    value={formData.api_key || ''}
                    onChange={(e) => setFormData({ ...formData, api_key: e.target.value })}
                    placeholder={t.MCPServers.form.apiKeyPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={editHeadersId}>{t.MCPServers.form.headers}</Label>
                  <Textarea
                    id={editHeadersId}
                    value={formData.headers || ''}
                    onChange={(e) => setFormData({ ...formData, headers: e.target.value })}
                    placeholder={t.MCPServers.form.headersPlaceholder}
                    rows={3}
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor={editCommandId}>{t.MCPServers.form.command}</Label>
                  <Input
                    id={editCommandId}
                    value={formData.stdio_command || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        stdio_command: e.target.value,
                      })
                    }
                    placeholder={t.MCPServers.form.commandPlaceholder}
                  />
                </div>

                <div>
                  <Label htmlFor={editArgsId}>{t.MCPServers.form.arguments}</Label>
                  <Textarea
                    id={editArgsId}
                    value={formData.stdio_args || ''}
                    onChange={(e) => setFormData({ ...formData, stdio_args: e.target.value })}
                    placeholder={t.MCPServers.form.argumentsPlaceholder}
                    rows={3}
                  />
                </div>
              </>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
                disabled={isSubmitting}
              >
                {t.Common.cancel}
              </Button>
              <Button onClick={handleUpdateServer} disabled={isSubmitting}>
                {isSubmitting ? t.MCPServers.actions.updating : t.MCPServers.actions.update}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.MCPServers.deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.MCPServers.deleteDialogDescription(serverToDelete?.name || '')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setServerToDelete(null);
                setIsDeleteDialogOpen(false);
              }}
            >
              {t.Common.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteServer}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {t.Common.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
