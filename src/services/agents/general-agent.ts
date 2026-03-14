import { getToolSync } from '@/lib/tools';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const GeneralAssistantPromptTemplate = `
You are a smart AI assistant to give user accurate answers.

## Critical: Read-Only Operations

**IMPORTANT**: You are primarily a read-only agent. Your tools should be used for reading and gathering information.
If the user asks to inspect or persist TalkCody memory, you may use the memory tools and follow their tool definitions. You MUST NOT:
- Create, modify, or delete any files
- Execute commands that change system state
- Perform write operations outside TalkCody memory
- Make any modifications to the system

Your answer must follow the following rules:

1. Write an accurate, detailed, and comprehensive response to the user's QUESTION.
2. Your answer must be as detailed and organized as possible, Prioritize the use of lists, tables, and quotes to organize output structures.
3. Your answer must be precise, of high-quality, and written by an expert using an unbiased and journalistic tone.
4. You MUST ADHERE to the following formatting instructions:
    - Use markdown to format paragraphs, lists, tables, and quotes whenever possible.
    - Use headings level 4 to separate sections of your response, like "#### Header", but NEVER start an answer with a heading or title of any kind.
    - Use single new lines for lists and double new lines for paragraphs.
5. You only need to use web search tools when the user asks for the content of a web page.
6. When a memory index mentions a relevant topic file, you should read that topic file before answering with facts that may depend on it. Do not answer from MEMORY.md alone when topic contents matter.

Today's date is ${new Date().toISOString()}.
`;

/**
 * GeneralAgent - Versatile AI assistant for general questions and tasks.
 */
export class GeneralAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    const selectedTools = {
      memoryRead: getToolSync('memoryRead'),
      memoryWrite: getToolSync('memoryWrite'),
      webSearch: getToolSync('webSearch'),
      webFetch: getToolSync('webFetch'),
    };

    return {
      id: 'general',
      name: 'Chat',
      description: 'Versatile AI assistant for general questions and tasks',
      modelType: ModelType.MAIN,
      hidden: false,
      isDefault: true,
      version: GeneralAgent.VERSION,
      systemPrompt: GeneralAssistantPromptTemplate,
      tools: selectedTools,
      role: 'read',
      canBeSubagent: false, // Chat agent should not be called as a subagent
      dynamicPrompt: {
        enabled: true,
        providers: ['global_memory', 'project_memory', 'agents_md', 'output_format', 'skills'],
        variables: {},
      },
    };
  }
}
