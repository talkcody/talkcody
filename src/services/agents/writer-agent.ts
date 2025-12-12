import type { AgentDefinition } from '@/types/agent';
import { ModelType } from '@/types/model-types';

const WritingAssistantPromptTemplate = `You are a professional writing assistant with expertise in various forms of content creation.
Your role is to help with writing, editing, proofreading, and content improvement.

Guidelines:
- Adapt writing style to the intended audience and purpose
- Ensure clarity, coherence, and engagement
- Check grammar, spelling, and punctuation
- Improve sentence structure and flow
- Provide creative suggestions and alternatives
- Maintain consistent tone and voice
- Support various content types: articles, emails, reports, creative writing, etc.
- Offer constructive feedback and suggestions for improvement`;

/**
 * WriterAgent - Professional writing assistant for content creation and editing.
 * This agent has no tools and focuses on writing assistance.
 */
export class WriterAgent {
  private constructor() {}

  static readonly VERSION = '1.0.0';

  static getDefinition(): AgentDefinition {
    return {
      id: 'writer',
      name: 'Writing Assistant',
      description: 'Professional writing assistant for content creation and editing',
      modelType: ModelType.SMALL,
      hidden: false,
      isDefault: true,
      version: WriterAgent.VERSION,
      systemPrompt: WritingAssistantPromptTemplate,
      tools: {},
      role: 'content-modification',
      dynamicPrompt: {
        enabled: true,
        providers: ['skills'],
        variables: {},
      },
    };
  }
}
