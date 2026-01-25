# Agent Skills Specification V2 (Current Code)

This document summarizes how TalkCody implements the Agent Skills Specification today.

## Overview
TalkCody supports the Agent Skills Specification via file-based skills stored under the app data directory and a parser/validator for `SKILL.md`. It also supports a separate database-backed skill system for marketplace-style skills, which is distinct from the file-based spec.

## Specification Alignment
- Types follow the spec in `src/types/agent-skills-spec.ts` (frontmatter, directory structure, disclosure levels).
- Validation rules are enforced in `src/services/skills/agent-skill-validator.ts`.
- Parsing/generation of `SKILL.md` is in `src/services/skills/skill-md-parser.ts`.

## File-Based Skills (Spec-Compliant)
- Stored under `appDataDir()/skills`.
- Each skill is a directory containing `SKILL.md` and optional `scripts/`, `references/`, and `assets/`.
- `AgentSkillService` manages create/list/load/update/delete for these skills.

## Discovery/Injection
- `SkillsProvider` injects available skills into prompts as XML with name/description/location.
- Only system skills and user-activated skills are included.
- Full skill content is loaded on demand by reading `SKILL.md`.

## Coexistence With Marketplace Skills
- Database-backed skills are represented by `Skill` (`src/types/skill.ts`) and stored in `skills` tables.
- `SkillService` handles CRUD for database skills; marketplace integration stubs exist but are not implemented.
- UI merges file-based Agent Skills with database skills for display (`skills-store`).

## Current Design Flaw
Two parallel skill systems exist (file-based Agent Skills vs database skills) with overlapping UI models. This increases complexity and risks inconsistent behaviors (for example, activation and persistence paths diverge).

## Further Optimization
Consolidate the UI and activation flow around a single skill source of truth, or introduce a unified abstraction layer that normalizes both skill types with consistent persistence and activation rules.
