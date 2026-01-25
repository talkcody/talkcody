# Path Resolution (Current Code)

This document describes how TalkCody resolves file paths across tasks and worktrees today.

## Overview
Path resolution is centralized in `getEffectiveWorkspaceRoot(taskId)` and `normalizeFilePath(root, filePath)`. Tools resolve a task-specific root (worktree or main project) and then normalize relative paths into absolute paths.

## Core Functions
- `getValidatedWorkspaceRoot()` (workspace-root-service): ensures the settings root matches the project root in the DB.
- `getEffectiveWorkspaceRoot(taskId)` (workspace-root-service): returns the worktree root for a task if mapped, otherwise the main project root.
- `normalizeFilePath(root, filePath)` (repository-utils): joins relative paths to the root and normalizes.

## Tool Usage (Examples)
- `readFile`, `writeFile`, `editFile`, `listFiles`, `glob`, and `codeSearch` call `getEffectiveWorkspaceRoot(context?.taskId)` and then normalize paths.
- `writeFile` and `editFile` enforce `isPathWithinProjectDirectory` for safety.

## Worktree Integration
- Worktree mapping is stored in `worktree-store` and used by `getEffectiveWorkspaceRoot`.
- When tasks are using worktrees, tools resolve paths within those worktrees; otherwise they operate on the main project root.

## Current Design Flaw
`readFile` resolves absolute paths without enforcing `isPathWithinProjectDirectory`, so a caller can read any absolute path on disk. Write/edit paths are protected, but read access is not constrained to the workspace.

## Further Optimization
Apply consistent path safety checks across **all** file tools (including read) and make `taskId` mandatory for path-resolving tools so worktree isolation cannot be bypassed by missing context.
