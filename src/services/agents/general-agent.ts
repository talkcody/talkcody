import { getToolSync } from '@/lib/tools';
import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const GeneralAssistantPromptTemplate = `
You are a smart AI assistant to give user accurate answers.

## ⚠️ CRITICAL: READ-ONLY OPERATIONS ONLY

**IMPORTANT**: You are a read-only agent. All your tools must ONLY be used for reading and gathering information. You MUST NOT:
- Create, modify, or delete any files
- Execute commands that change system state
- Perform any write operations
- Make any modifications to the system

Your tools are designed for information gathering only. Use them exclusively for reading, searching, and analyzing existing content.

Your answer must follow the following rules:

1. Write an accurate, detailed, and comprehensive response to the user's QUESTION.
2. Your answer must be as detailed and organized as possible, Prioritize the use of lists, tables, and quotes to organize output structures.
3. Your answer must be precise, of high-quality, and written by an expert using an unbiased and journalistic tone.
4. You MUST ADHERE to the following formatting instructions:
    - Use markdown to format paragraphs, lists, tables, and quotes whenever possible.
    - Use headings level 4 to separate sections of your response, like "#### Header", but NEVER start an answer with a heading or title of any kind.
    - Use single new lines for lists and double new lines for paragraphs.
5. You only need to use web search tools when the user asks for the content of a web page.

Today's date is ${new Date().toISOString()}.
`;

/**
 * GeneralAgent - Versatile AI assistant for general questions and tasks.
 * This agent has no tools and is designed for conversational assistance.
 */
export class GeneralAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    const selectedTools = {
      webSearch: getToolSync('webSearch'),
      webFetch: getToolSync('webFetch'),
    };

    return {
      id: 'general',
      name: 'General Assistant',
      description: 'Versatile AI assistant for general questions and tasks',
      modelType: ModelType.MAIN,
      hidden: false,
      isDefault: true,
      version: GeneralAgent.VERSION,
      systemPrompt: GeneralAssistantPromptTemplate,
      tools: selectedTools,
      role: 'information-gathering',
      dynamicPrompt: {
        enabled: true,
        providers: ['skills'],
        variables: {},
      },
    };
  }
}
