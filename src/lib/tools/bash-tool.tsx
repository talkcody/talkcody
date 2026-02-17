import { z } from 'zod';
import { BashToolDoing } from '@/components/tools/bash-tool-doing';
import { BashToolResult } from '@/components/tools/bash-tool-result';
import { createTool } from '@/lib/create-tool';
import { logger } from '@/lib/logger';

import type { BashResult } from '@/services/bash-executor';
import { bashExecutor } from '@/services/bash-executor';

export const bashTool = createTool({
  name: 'bash',
  description: `Execute shell commands safely on the system.

This tool allows you to run shell commands with built-in safety restrictions. Choose commands based on the Platform info in the environment context:

**Platform-specific command reference:**

| Task | macOS/Linux | Windows |
|------|-------------|---------|
| List files | ls -la | dir |
| Find files | find, fd | dir /s, where |
| Search content | grep, rg | findstr |
| Show file | cat, head, tail | type |
| Current directory | pwd | cd |
| Environment vars | env, export | set |
| Process list | ps aux | tasklist |
| Kill process | kill | taskkill |
| Network info | ifconfig, ip | ipconfig |
| Download file | curl, wget | curl, Invoke-WebRequest |
| Archive | tar, zip | tar, Compress-Archive |
| Package manager | brew (mac), apt (linux) | winget, choco |

The command will be executed in the current working directory.

**Background execution:**
Use \`run_in_background: true\` to run long-running commands in the background. The command will continue running even if it produces no output for an extended period. Use this for:
- Development servers
- Long-running build processes
- Continuous processes

Output can be read using \`cat\` or \`tail -f\` on the output file path returned in the result.`,
  inputSchema: z.object({
    command: z
      .string()
      .describe(
        'The bash command to execute. Supports $RESOURCE/ prefix for bundled resources (e.g., $RESOURCE/ppt-references/scripts/merge-to-pptx.ts)'
      ),
    runInBackground: z
      .boolean()
      .optional()
      .default(false)
      .describe('Run command in background and return task ID'),
  }),
  canConcurrent: false,
  execute: async ({ command, runInBackground }, context): Promise<BashResult> => {
    logger.info('Executing bash command', {
      command,
      taskId: context.taskId,
    });

    if (runInBackground) {
      return await bashExecutor.executeInBackground(command, context.taskId, context.toolId);
    }
    return await bashExecutor.execute(command, context.taskId, context.toolId);
  },
  renderToolDoing: ({ command }) => <BashToolDoing command={command} />,
  renderToolResult: (result) => (
    <BashToolResult
      output={result?.output}
      error={result?.error}
      outputFilePath={result?.outputFilePath}
      errorFilePath={result?.errorFilePath}
      success={result?.success ?? false}
      exitCode={result?.exit_code}
      idleTimedOut={result?.idle_timed_out}
      timedOut={result?.timed_out}
      pid={result?.pid}
      taskId={result?.taskId}
      isBackground={result?.isBackground}
    />
  ),
});
