import { z } from 'zod';
import { CallAgentToolDoing } from '@/components/tools/call-agent-tool-doing';
import { CallAgentToolResult } from '@/components/tools/call-agent-tool-result';
import { createTool } from '@/lib/create-tool';
import { generateId } from '@/lib/utils';
import { getNestedAgentTimeoutMs } from '@/services/agents/agent-execution-config';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getEffectiveWorkspaceRoot } from '@/services/workspace-root-service';
import { useNestedToolsStore } from '@/stores/nested-tools-store';
import type { AgentDefinition, UIMessage } from '@/types/agent';
import type { ToolExecuteContext } from '@/types/tool';
import { logger } from '../logger';

// Tool description - detailed parallelism strategy is in planner's system prompt
const toolDescription = `Call a registered sub-agent for a focused task. Subagents start with empty context.

**Parameters**
- \`agentId\`: The agent to call (see Available Subagents in system prompt)
- \`task\`: Clear outcome description (2-5 sentences)
- \`context\`: All necessary artifacts (file contents, schemas, requirements)
- \`targets\`: Files/modules this agent will touch (for conflict avoidance)

**Key Rules**
- Subagents have zero history - pass all needed context
- Use targets to enable safe parallel execution
- For parallel calls, issue multiple callAgent in same response`;

export const callAgent = createTool({
  name: 'callAgent',
  description: toolDescription,
  inputSchema: z.object({
    agentId: z.string().describe('The id of the registered agent to call'),
    task: z.string().describe('The instruction or task to be executed by the agent'),
    context: z
      .string()
      .describe(
        'Relevant context for solving this task. For example, the file path that needs to be modified and created'
      ),
    targets: z
      .array(z.string())
      .optional()
      .describe(
        'Optional resource targets (files/modules) this sub-agent will touch. Use to avoid conflicts and enable safe parallel execution.'
      ),
  }),
  canConcurrent: true,
  execute: async (
    {
      agentId,
      task,
      context,
      _abortController,
      _toolCallId,
      _onNestedToolMessage,
    }: {
      agentId: string;
      task: string;
      user_input?: string;
      context?: string;
      _abortController?: AbortController;
      _toolCallId?: string;
      _onNestedToolMessage?: (message: UIMessage) => void;
    },
    toolContext: ToolExecuteContext
  ) => {
    const executionId =
      _toolCallId || `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    let lastStatus: string | undefined;

    const addNestedMessage = (message: UIMessage) => {
      const messageWithParent: UIMessage = { ...message, parentToolCallId: executionId };
      try {
        useNestedToolsStore.getState().addMessage(executionId, messageWithParent);
        _onNestedToolMessage?.(messageWithParent);
      } catch (error) {
        logger.error('[callAgent] ❌ Failed to add nested tool message:', error, {
          executionId,
          messageId: message.id,
        });
      }
    };

    const addStatus = (status: string) => {
      if (!status || status === lastStatus) return;
      lastStatus = status;
      addNestedMessage({
        id: generateId(),
        role: 'assistant',
        content: status,
        timestamp: new Date(),
        toolCallId: executionId,
        toolName: 'callAgent-status',
      });
    };

    const addFailedStatus = (reason: string) => addStatus(`Failed: ${reason}`);

    try {
      logger.info(`callAgent: Start ${agentId}`, {
        task,
        context,
        executionId,
        toolCallId: _toolCallId,
      });

      if (_abortController?.signal.aborted) {
        addStatus('Aborted before start');
        return { success: false, message: 'Request was aborted' };
      }

      const { agentRegistry } = await import('@/services/agents/agent-registry');
      const agent = await agentRegistry.getWithResolvedTools(agentId);
      if (!agent) {
        logger.error(`callAgent: Agent not found: ${agentId}`);
        return { success: false, message: `Agent not found: ${agentId}` };
      }

      const resolvedModel = (agent as AgentDefinition & { model?: string }).model;
      if (!resolvedModel) {
        logger.error(`callAgent: Model not resolved for agent ${agentId}`);
        addStatus('Model unavailable');
        return {
          success: false,
          message: 'Model not resolved for agent. Please configure models in settings.',
        };
      }
      const modelService = await import('@/services/model-service').then((m) => m.modelService);
      const isModelAvailable = modelService.isModelAvailableSync(resolvedModel);

      if (!isModelAvailable) {
        logger.error(`callAgent: Model unavailable for agent ${agentId}`, { resolvedModel });
        addStatus('Model unavailable');
        return {
          success: false,
          message: `Model ${resolvedModel} is not available. Please configure API keys in settings.`,
        };
      }

      addStatus('Starting sub-agent');

      const messages: UIMessage[] = [
        {
          id: generateId(),
          role: 'user',
          content: [`## Task\n${task}`, context ? `## Context\n${context}` : null]
            .filter(Boolean)
            .join('\n\n'),
          timestamp: new Date(),
        },
      ];

      let systemPrompt: string | undefined;
      if (agent) {
        if (typeof agent.systemPrompt === 'function') {
          systemPrompt = await Promise.resolve(agent.systemPrompt());
        } else {
          systemPrompt = agent.systemPrompt;
        }
      }

      if (agent?.dynamicPrompt?.enabled) {
        try {
          const root = await getEffectiveWorkspaceRoot(toolContext?.taskId);
          const { finalSystemPrompt } = await previewSystemPrompt({
            agent: agent,
            workspaceRoot: root,
            taskId: toolContext?.taskId,
          });
          systemPrompt = finalSystemPrompt;
        } catch (error) {
          logger.warn('callAgent: dynamic prompt failed; using static', error);
        }
      }

      // Create a task-specific LLMService instance for nested agent calls
      const { createLLMService } = await import('@/services/agents/llm-service');
      if (!toolContext?.taskId) {
        throw new Error('taskId is required for callAgent tool');
      }
      const nestedLlmService = createLLMService(toolContext.taskId);
      let fullText = '';

      // Run the agent loop with timeout protection to prevent infinite loops
      // Pass parent's taskId so nested agent tools use the correct worktree path
      const agentLoopPromise = nestedLlmService.runAgentLoop(
        {
          messages,
          model: resolvedModel,
          systemPrompt,
          tools: agent.tools,
          suppressReasoning: true,
          isSubagent: true,
        },
        {
          onChunk: (chunk) => {
            fullText += chunk;
          },
          onComplete: (finalText) => {
            fullText = finalText || fullText;
            logger.info(`callAgent: Agent ${agentId} completed`);
          },
          onError: (error) => {
            logger.error(`callAgent: Agent ${agentId} failed`, error);
            if (error.message?.includes?.('Load failed')) {
              logger.error(
                'callAgent: Possible network/model loading issue. Check connection and API keys.'
              );
            }
            addFailedStatus(error.message);
            throw error;
          },
          onStatus: addStatus,
          onToolMessage: (message: UIMessage) => {
            try {
              addNestedMessage(message);
            } catch (error) {
              logger.error(
                '[callAgent] ❌ Failed to add nested tool message after helper:',
                error,
                {
                  executionId,
                  messageId: message.id,
                }
              );
            }
          },
        },
        _abortController
      );

      // Add timeout protection to prevent infinite loops
      const timeoutMs = getNestedAgentTimeoutMs();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(`Agent ${agentId} execution timed out after ${timeoutMs / 1000} seconds`)
          );
        }, timeoutMs);
      });

      await Promise.race([agentLoopPromise, timeoutPromise]);

      if (_abortController?.signal.aborted) {
        addStatus('Aborted');
        return { success: false, message: 'Request was aborted' };
      }

      addStatus('Completed');

      return { task, success: true, task_result: fullText };
    } catch (error) {
      logger.error(`callAgent: Failed to execute agent ${agentId}:`, error);
      addStatus('Failed to complete');

      return {
        success: false,
        message: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  },
  renderToolDoing: ({ agentId, task, _toolCallId }) => (
    <CallAgentToolDoing agentId={agentId} task={task} toolCallId={_toolCallId} />
  ),
  renderToolResult: (result, _params) => (
    <CallAgentToolResult
      success={result?.success ?? false}
      message={result?.message}
      output={result?.task_result}
    />
  ),
});
