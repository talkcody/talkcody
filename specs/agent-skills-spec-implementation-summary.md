# Agent Skills Spec Implementation Summary (Current Code)

This document summarizes what is actually implemented in the current codebase.

## Implemented Components
- **Spec types**: `src/types/agent-skills-spec.ts` defines frontmatter, directory structure, and disclosure levels.
- **Validator**: `src/services/skills/agent-skill-validator.ts` enforces name/description/compatibility/metadata constraints.
- **Parser**: `src/services/skills/skill-md-parser.ts` parses and generates `SKILL.md` with YAML frontmatter.
- **File-based skill service**: `src/services/skills/agent-skill-service.ts` manages spec-compliant skills under `appDataDir()/skills`.
- **Prompt injection**: `src/services/prompt/providers/skills-provider.ts` injects an XML list of available skills.
- **Active skills config**: `src/services/active-skills-config-service.ts` persists active skill IDs in `active-skills.json`.
- **UI integration**: `src/stores/skills-store.ts` merges agent skills (file-based) with DB skills for display.

## Not Implemented / Out of Date
- There is no `SkillDiscoveryService`, `skill-migration-service`, or migration dialog in the current codebase.
- Marketplace integration in `SkillService` is stubbed and throws "not implemented" errors.
- The prompt provider mentions `get_skill` tooling, but there is no `getSkill` tool implementation under `src/lib/tools`.

## Current Design Flaw
The prompt layer references a `get_skill` tool that does not exist, which can mislead agents into calling a non-existent tool and cause failed tool executions.

## Further Optimization
Add a minimal `getSkill` tool (or update prompt instructions to use `readFile` only) so the tool surface and prompts are consistent.
