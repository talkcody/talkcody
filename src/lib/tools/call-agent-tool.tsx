import { z } from 'zod';
import { CallAgentToolDoing } from '@/components/tools/call-agent-tool-doing';
import { CallAgentToolResult } from '@/components/tools/call-agent-tool-result';
import { createTool } from '@/lib/create-tool';
import { generateId } from '@/lib/utils';
import { agentRegistry } from '@/services/agents/agent-registry';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import { useNestedToolsStore } from '@/stores/nested-tools-store';
import type { UIMessage } from '@/types/agent';
import { logger } from '../logger';

export const callAgent = createTool({
  name: 'callAgent',
  description:
    'Call a registered sub-agent by id to perform a specific task. Useful for delegating specialized work.',
  inputSchema: z.object({
    agentId: z.string().describe('The id of the registered agent to call'),
    task: z.string().describe('The instruction or task to be executed by the agent'),
    context: z
      .string()
      .describe(
        'Relevant context for solving this task. For example, the file path that needs to be modified and created'
      ),
  }),
  canConcurrent: false,
  execute: async ({
    agentId,
    task,
    context,
    _abortController,
    _toolCallId,
  }: {
    agentId: string;
    task: string;
    user_input?: string;
    context?: string;
    _abortController?: AbortController;
    _toolCallId?: string;
  }) => {
    // Generate a unique execution ID for this callAgent invocation
    // This is needed because _toolCallId may not be passed when called directly by LLM
    const executionId =
      _toolCallId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      logger.info(`callAgent: Invoking agent ${agentId} for task: ${task}`);
      logger.info(`callAgent: Context: ${context}`);
      logger.info(
        `callAgent: Execution ID: ${executionId} (toolCallId: ${_toolCallId || 'not provided'})`
      );

      // Check for abort signal before starting
      if (_abortController?.signal.aborted) {
        return {
          success: false,
          message: 'Request was aborted',
        };
      }

      const agent = await agentRegistry.getWithResolvedTools(agentId);
      if (!agent) {
        logger.error(`callAgent: Agent not found: ${agentId}`);
        return {
          success: false,
          message: `Agent not found: ${agentId}`,
        };
      }

      // getWithResolvedTools returns agent with resolved model field
      const resolvedModel = (agent as any).model as string;

      // Check model availability before proceeding
      logger.info(`callAgent: Using model ${resolvedModel} for agent ${agentId}`);
      const modelService = await import('@/services/model-service').then((m) => m.modelService);
      const isModelAvailable = modelService.isModelAvailableSync(resolvedModel);

      if (!isModelAvailable) {
        logger.error(`callAgent: Model ${resolvedModel} is not available for agent ${agentId}`);
        return {
          success: false,
          message: `Model ${resolvedModel} is not available. Please configure API keys in settings.`,
        };
      }

      const messages: UIMessage[] = [
        {
          id: generateId(),
          role: 'user',
          content: [`## Task\\n${task}`, context ? `## Context\\n${context}` : null]
            .filter(Boolean)
            .join('\\n\\n'),
          timestamp: new Date(),
        },
      ];

      let fullText = '';
      let systemPrompt = agent
        ? typeof agent.systemPrompt === 'function'
          ? await Promise.resolve(agent.systemPrompt())
          : agent.systemPrompt
        : undefined;

      // If dynamic prompt is enabled for this agent, compose it with providers
      if (agent?.dynamicPrompt?.enabled) {
        try {
          const root = await getValidatedWorkspaceRoot();
          const { finalSystemPrompt } = await previewSystemPrompt({
            agent: agent,
            workspaceRoot: root,
          });
          systemPrompt = finalSystemPrompt;
        } catch (e) {
          logger.warn('Failed to compose dynamic system prompt, falling back to static:', e);
        }
      }
      // logger.info("systemPrompt: ", systemPrompt);

      // Dynamically import llmService to avoid circular dependency
      const { llmService } = await import('@/services/agents/llm-service');

      logger.info(`callAgent: Preparing to run nested agent loop`, {
        agentId,
        executionId,
        toolCallId: _toolCallId,
        hasToolCallId: !!_toolCallId,
      });

      await new Promise<void>((resolve, reject) => {
        llmService
          .runAgentLoop(
            {
              messages,
              model: resolvedModel,
              systemPrompt,
              tools: agent.tools,
              suppressReasoning: true,
            },
            {
              onChunk: (c) => {
                fullText += c;
              },
              onComplete: (finalText) => {
                logger.info(`callAgent: Agent ${agentId} completed successfully`);
                fullText = finalText || fullText;
                resolve();
              },
              onError: (error) => {
                logger.error(`callAgent: Agent ${agentId} failed:`, error);
                // Log additional error details for debugging
                if (error instanceof Error) {
                  logger.error(`callAgent: Error name: ${error.name}`);
                  logger.error(`callAgent: Error message: ${error.message}`);
                  if (error.message.includes('Load failed')) {
                    logger.error(
                      `callAgent: This appears to be a network/model loading issue. Check internet connection and API keys.`
                    );
                  }
                }
                reject(error);
              },
              onStatus: (_status) => {
                // logger.info(
                //   `callAgent: Agent ${agentId} status: ${status}`
                // );
              },
              onToolMessage: (message: UIMessage) => {
                // Use executionId as the key for storing nested tool messages
                // executionId is either _toolCallId (if available) or a generated unique ID
                try {
                  logger.info('[callAgent] 📨 Adding nested tool message to store', {
                    executionId,
                    nestedMessageId: message.id,
                    nestedToolName: message.toolName,
                    nestedToolCallId: message.toolCallId,
                    messageRole: message.role,
                  });

                  // Add message to store using executionId as the parent key
                  useNestedToolsStore.getState().addMessage(executionId, {
                    ...message,
                    parentToolCallId: executionId,
                  });

                  logger.info('[callAgent] ✅ Nested tool message added to store successfully');
                } catch (error) {
                  logger.error('[callAgent] ❌ Failed to add nested tool message:', error, {
                    executionId,
                    messageId: message.id,
                  });
                }
              },
            },
            _abortController
          )
          .catch(reject);
      });

      return {
        task: task,
        success: true,
        task_result: fullText,
      };
    } catch (error) {
      logger.error(`callAgent: Failed to execute agent ${agentId}:`, error);

      let errorMessage = 'Unknown error occurred';
      if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        message: errorMessage,
      };
    }
  },
  renderToolDoing: ({ agentId, task, _toolCallId }) => (
    <CallAgentToolDoing agentId={agentId} task={task} toolCallId={_toolCallId} />
  ),
  renderToolResult: (result, { agentId } = {}) => (
    <CallAgentToolResult
      success={result?.success ?? false}
      message={result?.message}
      output={result?.task_result}
    />
  ),
});
