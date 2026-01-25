# Agent Skills Spec Migration Plan (Current Code)

This document reflects the current state and remaining gaps rather than a future plan.

## What Exists Today
- Agent Skills Specification types, validator, parser, and file-based service are implemented.
- File-based skills live under `appDataDir()/skills` and follow the spec layout.
- Active skills are stored in `active-skills.json` and injected via `SkillsProvider`.

## What Is Not Implemented
- No discovery service, migration service, or migration UI exists in the current codebase.
- Marketplace install/update/publish are stubs in `SkillService`.
- There is no `getSkill` tool despite prompt text referencing it.

## Current Design Flaw
The migration plan described in earlier documents assumes a legacy format and migration tooling that do not exist. This creates a gap between documented migration steps and actual code behavior.

## Further Optimization
If migration is needed in the future, add a real migration service and UI only after confirming a legacy skill format still exists. Otherwise, remove migration references entirely to reduce confusion.
