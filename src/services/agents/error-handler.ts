// src/services/agents/error-handler.ts
import { InvalidToolInputError, NoSuchToolError, type UserModelMessage } from 'ai';
import {
  createErrorContext,
  createHttpStatusError,
  extractAndFormatError,
} from '@/lib/error-utils';
import { logger } from '@/lib/logger';
import type { AgentLoopState, AgentToolSet } from '@/types/agent';

export interface ErrorHandlerOptions {
  model: string;
  tools: AgentToolSet;
  loopState: AgentLoopState;
  onError?: (error: Error) => void;
}

export interface ErrorHandlerResult {
  shouldContinue: boolean;
  shouldStop: boolean;
  error?: Error;
}

/**
 * ErrorHandler provides unified error handling for the agent loop
 */
export class ErrorHandler {
  private readonly maxConsecutiveToolErrors = 3;

  /**
   * Handle NoSuchToolError
   */
  handleNoSuchToolError(error: Error, options: ErrorHandlerOptions): ErrorHandlerResult {
    const { model, tools, loopState } = options;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'stream-processing',
    });

    const { formattedError } = extractAndFormatError(error, errorContext);

    logger.error('NoSuchToolError detected:', formattedError);

    // Add error message to conversation history
    const availableTools = Object.keys(tools);
    const errorMessage: UserModelMessage = {
      role: 'user',
      content: `Tool error: ${error.message}. The requested tool is not available. Available tools: ${availableTools.join(', ')}. Please try using a different approach or available tools.`,
    };
    loopState.messages.push(errorMessage);

    return { shouldContinue: true, shouldStop: false };
  }

  /**
   * Handle InvalidToolInputError
   */
  handleInvalidToolInputError(error: Error, options: ErrorHandlerOptions): ErrorHandlerResult {
    const { model, loopState } = options;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'stream-processing',
    });

    const { errorDetails, formattedError } = extractAndFormatError(error, errorContext);

    logger.error('InvalidToolInputError detected:', formattedError);

    // Add error message to conversation history
    const inputErrorMessage: UserModelMessage = {
      role: 'user',
      content: `Tool input error: ${error.message}. Tool "${errorDetails.toolName}" received invalid input parameters. Please check the tool input parameters and try again.`,
    };
    loopState.messages.push(inputErrorMessage);

    return { shouldContinue: true, shouldStop: false };
  }

  /**
   * Handle tool validation error
   */
  handleToolValidationError(
    errorMessage: string,
    options: ErrorHandlerOptions
  ): ErrorHandlerResult {
    const { tools, loopState } = options;

    logger.error('Tool call validation failed:', errorMessage);

    // Add error message to conversation history
    const availableTools = Object.keys(tools);
    const validationErrorMessage: UserModelMessage = {
      role: 'user',
      content: `Tool validation error: ${errorMessage}. Available tools: ${availableTools.join(', ')}. Please use only the tools that were provided to you.`,
    };
    loopState.messages.push(validationErrorMessage);

    return { shouldContinue: true, shouldStop: false };
  }

  /**
   * Handle HTTP errors
   */
  handleHttpError(error: unknown, options: ErrorHandlerOptions): ErrorHandlerResult {
    const { model, loopState } = options;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'stream-processing',
    });

    const { errorDetails, formattedError } = extractAndFormatError(error, errorContext);

    const httpError = createHttpStatusError(errorDetails, formattedError);

    if (httpError) {
      logger.error(`HTTP ${errorDetails.status} error:`, formattedError);
      // Note: onError callback will be invoked in handleMainLoopError when this error is caught
      return { shouldContinue: false, shouldStop: true, error: httpError };
    }

    return { shouldContinue: false, shouldStop: false };
  }

  /**
   * Handle unknown stream error
   */
  handleUnknownError(error: unknown, options: ErrorHandlerOptions): ErrorHandlerResult {
    const { model, loopState } = options;

    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'stream-processing',
    });

    const { errorDetails, formattedError } = extractAndFormatError(error, errorContext);

    logger.error('Unknown stream error:', formattedError);

    const streamError = new Error(
      `Unexpected error in agent loop (${errorDetails.name}): ${errorDetails.message}`
    );

    // Note: onError callback will be invoked in handleMainLoopError when this error is caught
    return { shouldContinue: false, shouldStop: true, error: streamError };
  }

  /**
   * Handle stream error delta
   */
  handleStreamError(error: unknown, options: ErrorHandlerOptions): ErrorHandlerResult {
    const { model, loopState } = options;

    // Extract error details
    const errorContext = createErrorContext(model, {
      iteration: loopState.currentIteration,
      messageCount: loopState.messages.length,
      phase: 'stream-processing',
    });

    const { errorDetails } = extractAndFormatError(error, errorContext);

    // Handle specific error types
    if (NoSuchToolError.isInstance(error)) {
      return this.handleNoSuchToolError(error, options);
    }

    if (InvalidToolInputError.isInstance(error)) {
      return this.handleInvalidToolInputError(error, options);
    }

    // Check for tool validation errors
    const errorMessage = errorDetails.message;
    if (
      errorMessage.includes('tool call validation failed') ||
      errorMessage.includes('was not in request.tools')
    ) {
      return this.handleToolValidationError(errorMessage, options);
    }

    // Try HTTP error handling
    const httpResult = this.handleHttpError(error, options);
    if (httpResult.shouldStop) {
      return httpResult;
    }

    // Unknown error - stop execution
    return this.handleUnknownError(error, options);
  }

  /**
   * Check if should stop due to too many consecutive errors
   */
  shouldStopOnConsecutiveErrors(consecutiveErrors: number, options: ErrorHandlerOptions): boolean {
    if (consecutiveErrors >= this.maxConsecutiveToolErrors) {
      const { tools, loopState } = options;
      const availableTools = Object.keys(tools);

      logger.error(
        `Too many consecutive tool errors (${consecutiveErrors}) at iteration ${loopState.currentIteration}`
      );

      const consecutiveErrorMessage: UserModelMessage = {
        role: 'user',
        content: `Too many consecutive tool errors (${consecutiveErrors}). Available tools: ${availableTools.join(', ')}. Please carefully review which tools are available and use them correctly, or complete your response without using tools.`,
      };
      loopState.messages.push(consecutiveErrorMessage);

      return true;
    }

    return false;
  }

  handleMainLoopError(error: unknown, model: string, onError?: (error: Error) => void): Error {
    const { errorDetails, formattedError } = extractAndFormatError(error, {
      model,
      phase: 'main-loop',
    });

    logger.error('Agent error:', formattedError);

    const loopError = new Error(`Agent failed (${errorDetails.name}): ${errorDetails.message}`);

    onError?.(loopError);
    return loopError;
  }
}
