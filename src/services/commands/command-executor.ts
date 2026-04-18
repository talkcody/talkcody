// src/services/commands/command-executor.ts

import { z } from 'zod';
import { logger } from '@/lib/logger';
import type { Command, CommandContext, CommandResult, ParsedCommand } from '@/types/command';
import { CommandEventType } from '@/types/command';
import { commandRegistry } from './command-registry';

/**
 * Command Executor - responsible for parsing, validating, and executing commands
 */
class CommandExecutor {
  /**
   * Parse a command input string into command and arguments
   */
  parseCommand(input: string): ParsedCommand {
    // Remove leading/trailing whitespace
    const trimmedInput = input.trim();

    // Remove leading slash if present
    const cleanInput = trimmedInput.startsWith('/') ? trimmedInput.slice(1) : trimmedInput;

    if (!cleanInput) {
      return {
        command: null,
        commandName: '',
        args: {},
        rawArgs: '',
        isValid: false,
        errors: ['Empty command'],
      };
    }

    // Split command name from arguments
    const spaceIndex = cleanInput.indexOf(' ');
    const commandName = spaceIndex === -1 ? cleanInput : cleanInput.substring(0, spaceIndex);
    const rawArgs = spaceIndex === -1 ? '' : cleanInput.substring(spaceIndex + 1).trim();

    // Find command in registry
    const command = commandRegistry.getByName(commandName);

    if (!command) {
      return {
        command: null,
        commandName,
        args: {},
        rawArgs,
        isValid: false,
        errors: [`Unknown command: ${commandName}`],
      };
    }

    // Parse arguments
    const { args, errors } = this.parseArguments(command, rawArgs);

    return {
      command,
      commandName,
      args,
      rawArgs,
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Execute a parsed command
   */
  async executeCommand(
    parsedCommand: ParsedCommand,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!(parsedCommand.isValid && parsedCommand.command)) {
      return {
        success: false,
        error: parsedCommand.errors?.join(', ') || 'Invalid command',
      };
    }

    const { command, args } = parsedCommand;

    try {
      // Check if command is enabled
      if (!command.enabled) {
        return {
          success: false,
          error: `Command '${command.name}' is currently disabled`,
        };
      }

      // Validate context requirements
      const contextValidation = this.validateContext(command, context);
      if (!contextValidation.valid) {
        return {
          success: false,
          error: contextValidation.error,
        };
      }

      // Execute the command
      logger.info(`Executing command: ${command.name}`, { args, context });

      const result = await command.executor(args, context);

      // Emit execution event
      this.emitCommandEvent(CommandEventType.COMMAND_EXECUTED, command, context, result);

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Command execution failed for '${command.name}':`, error);

      // Emit failure event
      this.emitCommandEvent(
        CommandEventType.COMMAND_FAILED,
        command,
        context,
        undefined,
        error as Error
      );

      return {
        success: false,
        error: `Command execution failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Execute a command from raw input string
   */
  async executeFromInput(input: string, context: CommandContext): Promise<CommandResult> {
    const parsedCommand = this.parseCommand(input);
    return this.executeCommand(parsedCommand, context);
  }

  /**
   * Check if input looks like a command
   */
  isCommand(input: string): boolean {
    const trimmed = input.trim();
    return trimmed.startsWith('/') && trimmed.length > 1;
  }

  /**
   * Get command suggestions for autocomplete
   */
  getCommandSuggestions(partialInput: string, limit = 5) {
    // Remove leading slash and get command name part
    const cleanInput = partialInput.startsWith('/') ? partialInput.slice(1) : partialInput;

    const spaceIndex = cleanInput.indexOf(' ');
    const commandQuery = spaceIndex === -1 ? cleanInput : cleanInput.substring(0, spaceIndex);

    return commandRegistry.search(commandQuery, limit);
  }

  /**
   * Parse command arguments using the command's parameter schema
   */
  private parseArguments(
    command: Command,
    rawArgs: string
  ): {
    args: Record<string, unknown>;
    errors: string[];
  } {
    const errors: string[] = [];
    const args: Record<string, unknown> = {};

    if (rawArgs) {
      args._raw = rawArgs;
    }

    // If no parameters defined, just return raw args as single argument
    if (!command.parameters || command.parameters.length === 0) {
      return { args, errors };
    }

    // Simple argument parsing - split by spaces and map to parameters
    // This is a basic implementation; more sophisticated parsing could be added
    const argTokens = rawArgs ? rawArgs.split(/\s+/) : [];

    for (let i = 0; i < command.parameters.length; i++) {
      const param = command.parameters[i];
      if (!param) continue;

      const token = argTokens[i];

      if (!token && param.required) {
        errors.push(`Missing required parameter: ${param.name}`);
      } else if (token) {
        // Basic type conversion
        let value: unknown = token;

        switch (param.type) {
          case 'number': {
            const numValue = Number(token);
            if (Number.isNaN(numValue)) {
              errors.push(`Parameter '${param.name}' must be a number`);
            } else {
              value = numValue;
            }
            break;
          }
          case 'boolean':
            value = token.toLowerCase() === 'true' || token === '1';
            break;
          default:
            // Keep as string
            break;
        }

        args[param.name] = value;
      } else if (param.defaultValue !== undefined) {
        args[param.name] = param.defaultValue;
      }
    }

    // If there are extra arguments, store them as _extra
    if (argTokens.length > command.parameters.length) {
      args._extra = argTokens.slice(command.parameters.length);
    }

    // Validate using Zod schema if provided
    if (command.parametersSchema) {
      try {
        const validatedArgs = command.parametersSchema.parse(args) as Record<string, unknown>;
        return { args: validatedArgs, errors };
      } catch (error) {
        if (error instanceof z.ZodError) {
          const zodErrors = error.issues.map((err) => `${err.path.join('.')}: ${err.message}`);
          errors.push(...zodErrors);
        } else {
          errors.push('Parameter validation failed');
        }
      }
    }

    return { args, errors };
  }

  /**
   * Validate that the context meets the command's requirements
   */
  private validateContext(
    command: Command,
    context: CommandContext
  ): {
    valid: boolean;
    error?: string;
  } {
    if (command.requiresRepository && !context.repositoryPath) {
      return {
        valid: false,
        error: `Command '${command.name}' requires an open repository`,
      };
    }

    if (command.requiresTask && !context.taskId) {
      return {
        valid: false,
        error: `Command '${command.name}' requires an active task`,
      };
    }

    return { valid: true };
  }

  /**
   * Emit command events to the registry
   */
  private emitCommandEvent(
    type: CommandEventType,
    command: Command,
    context?: CommandContext,
    result?: CommandResult,
    error?: Error
  ): void {
    // For now, just log the event
    // Later this could integrate with the registry's event system
    logger.info(`Command Event [${type}]:`, {
      command: command.name,
      context,
      result,
      error,
    });
  }
}

// Export singleton instance
export const commandExecutor = new CommandExecutor();
