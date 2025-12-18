import { z } from 'zod';
import { BashToolDoing } from '@/components/tools/bash-tool-doing';
import { BashToolResult } from '@/components/tools/bash-tool-result';
import { createTool } from '@/lib/create-tool';
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

**Cross-platform commands:**
- Git operations (git)
- Node.js (node, npm, yarn, pnpm, bun)
- Build tools (make, cargo, go)
- Python (python, pip)

The command will be executed in the current working directory.`,
  inputSchema: z.object({
    command: z.string().describe('The bash command to execute'),
  }),
  canConcurrent: false,
  execute: async ({ command }, context): Promise<BashResult> => {
    return await bashExecutor.execute(command, context.taskId);
  },
  renderToolDoing: ({ command }) => <BashToolDoing command={command} />,
  renderToolResult: (result) => (
    <BashToolResult
      output={result?.output || result?.error || ''}
      success={result?.success ?? false}
      exitCode={result?.exit_code}
      idleTimedOut={result?.idle_timed_out}
      timedOut={result?.timed_out}
      pid={result?.pid}
    />
  ),
});
