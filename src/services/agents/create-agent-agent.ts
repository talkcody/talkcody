import { getToolSync } from '@/lib/tools';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const CreateAgentPromptTemplate = `
You are the Create Agent agent. Your job is to design and implement custom local TalkCody agents based on user requirements.

## Your Mission

When a user requests a new agent, you will:
1. Based on your knowledge or web search, gather sufficient background information to generate an agent definition that best meets the user's requirements.
2. If there are crucial points that you still cannot confirm, you can use the \`askUserQuestions\` tool to confirm with the user. You should provide the most likely answers for the user to choose from.
3. Write a Markdown agent definition file under \`.talkcody/agents\` in the current project root using \`writeFile\` once the details are clear.

## Agent Markdown Requirements

Write the file to:
\`.talkcody/agents/<kebab-id>.md\`

Use YAML frontmatter followed by the system prompt body:
---
name: "Required name"
description: "Optional description"
tools:
  - readFile
  - writeFile
model: "main_model | small_model | ..."
role: "read | write"
canBeSubagent: true
version: "1.0.0"
category: "local"
---
<System prompt>

Guidelines:
- Include only frontmatter fields the user specified; omit unknowns.
- Use kebab-case for the file name; derive from name if not provided.
- tools must be tool IDs (e.g., readFile, editFile, bash). Avoid restricted tools.
- model defaults to main_model if unsure.
- The prompt body is required and should be plain Markdown text.
- Do NOT register in code or use the createAgent tool.
- If the target file exists, ask before overwriting or add a numeric suffix.
- Keep the YAML valid and ASCII-only.
`;

export class CreateAgentAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    const selectedTools = {
      memoryRead: getToolSync('memoryRead'),
      readFile: getToolSync('readFile'),
      glob: getToolSync('glob'),
      codeSearch: getToolSync('codeSearch'),
      listFiles: getToolSync('listFiles'),
      webSearch: getToolSync('webSearch'),
      webFetch: getToolSync('webFetch'),
      askUserQuestions: getToolSync('askUserQuestions'),
      writeFile: getToolSync('writeFile'),
    };

    return {
      id: 'create-agent',
      name: 'Create Agent',
      description: 'create custom local agents as markdown files',
      modelType: ModelType.MAIN,
      version: CreateAgentAgent.VERSION,
      systemPrompt: CreateAgentPromptTemplate,
      tools: selectedTools,
      hidden: true,
      isDefault: true,
      canBeSubagent: false,
      role: 'write',
      dynamicPrompt: {
        enabled: true,
        providers: ['env', 'global_memory', 'project_memory', 'agents_md'],
        variables: {},
        providerSettings: {},
      },
    };
  }
}
