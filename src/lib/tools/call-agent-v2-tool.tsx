import { z } from 'zod';
import { CallAgentToolDoing } from '@/components/tools/call-agent-tool-doing';
import { CallAgentToolResult } from '@/components/tools/call-agent-tool-result';
import { createTool } from '@/lib/create-tool';
import { generateId } from '@/lib/utils';
import { previewSystemPrompt } from '@/services/prompt/preview';
import { getValidatedWorkspaceRoot } from '@/services/workspace-root-service';
import { useNestedToolsStore } from '@/stores/nested-tools-store';
import type { AgentDefinition, UIMessage } from '@/types/agent';
import { logger } from '../logger';

async function getSubAgents(): Promise<string> {
  try {
    const { agentRegistry } = await import('@/services/agents/agent-registry');
    await agentRegistry.loadAllAgents();
    const agents = agentRegistry
      .list()
      // Avoid recursive self-call; planner agents should not be spawned via callAgentV2
      .filter((agent) => agent.id !== 'planner' && agent.id !== 'planner-v2')
      .map((agent) => {
        const name = agent.id || agent.name;
        const description = agent.description?.trim() || 'No description available';
        return `- ${name}: ${description}`;
      });

    if (agents.length === 0) {
      return '- No subagents available';
    }

    return agents.join('\n');
  } catch (error) {
    logger.warn('callAgentV2: failed to load agent list for description', error);
    return '- (Failed to load subagent list)';
  }
}

const getToolDescription = (
  agentsList: string
) => `Call a registered sub-agent by id for a focused task (v2). Subagents start with an empty context; they only see what you pass in \`context\`.

**Purpose**
- Offload substantial, self-contained work (e.g., multi-file refactors, deep debugging, research sweeps) while keeping the main thread clean.
- Run independent tasks in parallel; sequence dependent tasks to avoid conflicts.
- Avoid trivial usage; subagents are for meaningful units of work, not small edits.

**Before you call**
- Pick the most suitable agent; if none fits, handle it yourself or gather missing info.
- Decide the exact deliverable and success criteria; do not forward the raw user prompt.
- Confirm which files/resources will be touched to populate \`targets\`.

**How to write \`task\`**
- Describe the outcome, scope, and constraints in 2–5 sentences.
- Include acceptance criteria, edge cases, and non-goals when relevant.
- Keep it self-contained; avoid references to prior turns or hidden context.

**How to write \`context\`**
- Provide every artifact needed: file paths, code snippets, schemas, requirements, platform constraints, env details.
- Paste critical code inline; do not assume the sub-agent can read files you did not quote.
- State testing expectations (commands, coverage focus) and formatting/linting rules if applicable.

**Targets & parallelism**
- Set \`targets\` to the specific files/modules the agent will modify or read heavily.
- For independent tasks, issue multiple \`callAgentV2\` calls in the same response with distinct \`targets\`.
- For dependent tasks, run sequentially and feed outputs forward yourself.

**Safety & quality**
- Never call without adequate context; the sub-agent has zero history.
- Avoid spawning if the task is faster to do directly.
- If the chosen model or agent is unavailable, fall back gracefully or notify the user.

**Examples**
- Split a refactor across multiple files by spawning one agent per file with explicit \`targets\`.
- Ask one agent to map an unfamiliar directory while another fixes tests elsewhere.
- Run parallel research queries (e.g., API options vs. performance tuning) with separate agents.

## Available subagents
- Pick the best-fit subagent (do not assume only one exists):
${agentsList}`;

let currentDescription = getToolDescription('- (Loading subagents...)');

// Start loading in background to avoid top-level await blocking and circular dependency issues
getSubAgents().then((agentsList) => {
  currentDescription = getToolDescription(agentsList);
});

export const callAgentV2 = createTool({
  name: 'callAgentV2',
  description: currentDescription,
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
  isBeta: true,
  execute: async ({
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
  }) => {
    const executionId =
      _toolCallId || `exec_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    let lastStatus: string | undefined;

    const addNestedMessage = (message: UIMessage) => {
      const messageWithParent: UIMessage = { ...message, parentToolCallId: executionId };
      try {
        useNestedToolsStore.getState().addMessage(executionId, messageWithParent);
        _onNestedToolMessage?.(messageWithParent);
      } catch (error) {
        logger.error('[callAgentV2] ❌ Failed to add nested tool message:', error, {
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
        toolName: 'callAgentV2-status',
      });
    };

    const addFailedStatus = (reason: string) => addStatus(`Failed: ${reason}`);

    try {
      logger.info(`callAgentV2: Start ${agentId}`, {
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
        logger.error(`callAgentV2: Agent not found: ${agentId}`);
        return { success: false, message: `Agent not found: ${agentId}` };
      }

      const resolvedModel = (agent as AgentDefinition & { model?: string }).model;
      if (!resolvedModel) {
        logger.error(`callAgentV2: Model not resolved for agent ${agentId}`);
        addStatus('Model unavailable');
        return {
          success: false,
          message: 'Model not resolved for agent. Please configure models in settings.',
        };
      }
      const modelService = await import('@/services/model-service').then((m) => m.modelService);
      const isModelAvailable = modelService.isModelAvailableSync(resolvedModel);

      if (!isModelAvailable) {
        logger.error(`callAgentV2: Model unavailable for agent ${agentId}`, { resolvedModel });
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
          const root = await getValidatedWorkspaceRoot();
          const { finalSystemPrompt } = await previewSystemPrompt({ agent, workspaceRoot: root });
          systemPrompt = finalSystemPrompt;
        } catch (error) {
          logger.warn('callAgentV2: dynamic prompt failed; using static', error);
        }
      }

      const { llmService } = await import('@/services/agents/llm-service');
      let fullText = '';

      await llmService.runAgentLoop(
        {
          messages,
          model: resolvedModel,
          systemPrompt,
          tools: agent.tools,
          suppressReasoning: true,
        },
        {
          onChunk: (chunk) => {
            fullText += chunk;
          },
          onComplete: (finalText) => {
            fullText = finalText || fullText;
            logger.info(`callAgentV2: Agent ${agentId} completed`);
          },
          onError: (error) => {
            logger.error(`callAgentV2: Agent ${agentId} failed`, error);
            if (error.message?.includes?.('Load failed')) {
              logger.error(
                'callAgentV2: Possible network/model loading issue. Check connection and API keys.'
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
                '[callAgentV2] ❌ Failed to add nested tool message after helper:',
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

      if (_abortController?.signal.aborted) {
        addStatus('Aborted');
        return { success: false, message: 'Request was aborted' };
      }

      addStatus('Completed');

      return { task, success: true, task_result: fullText };
    } catch (error) {
      logger.error(`callAgentV2: Failed to execute agent ${agentId}:`, error);
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

// Override description property with a getter to return the current (updated) description
Object.defineProperty(callAgentV2, 'description', {
  get: () => currentDescription,
  enumerable: true,
  configurable: true,
});
