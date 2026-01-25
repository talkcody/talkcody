# Lint Implementation (Current Code)

This document describes the lint feature as implemented in the current TalkCody codebase.

## Overview
TalkCody runs Biome linting in the Tauri backend and renders diagnostics in Monaco. The frontend requests lint for saved files only and stores per-file diagnostics in a Zustand store for UI panels and editor markers.

## Current Implementation

### Frontend
- `src/services/lint-service.ts`: listens for `lint-result` events, caches results by file path for 5 seconds, and converts Rust diagnostics to Monaco markers.
- `src/hooks/use-lint-diagnostics.ts`: triggers lint on editor ready and after save (via `triggerLint()`), filters by severity, and applies markers if `showInEditor` is enabled.
- `src/stores/lint-store.ts`: stores per-file diagnostics and global counts, plus settings toggles (enabled, severity filters, UI visibility).
- `src/components/diagnostics/*`: problems panel, diagnostic items, and quick-fix menu UI.
- `src/utils/fix-applier.ts`: applies a small set of text edits (remove unused, convert to const, add ignore/comment) directly in Monaco.

### Backend (Tauri)
- `src-tauri/src/lint.rs`: executes `biome lint` via `bunx` or `npx`, parses JSON output, maps byte spans to line/column, and emits a `lint-result` event.
- `check_lint_runtime` reports whether `bun` or `node` is available; the settings UI warns if neither is installed.

## Data Flow
1. Editor ready or file saved triggers `useLintDiagnostics.triggerLint()`.
2. `lintService.runBiomeLint()` invokes `run_lint` with `{ filePath, rootPath, requestId }`.
3. Tauri runs Biome and emits `lint-result`.
4. Frontend caches, filters, updates store, and applies Monaco markers.

## Supported File Types
`js`, `jsx`, `ts`, `tsx`, `json`, `jsonc`, `css`, `html` (validated in `src-tauri/src/lint.rs`).

## Limitations
- Linting runs only on saved files; unsaved editor buffers are not linted.
- Quick fixes are limited to a few string-based patterns and do not use Biome autofix.
- The problems panel has refresh/auto-fix actions commented out.

## Current Design Flaw
The user-configurable delay (`settings.delay` / `LINT_DEBOUNCE_DELAY`) is not used by `useLintDiagnostics`. Lint triggers after a fixed 100ms timeout, so the settings value is effectively ignored and cannot throttle rapid saves.

## Further Optimization
Debounce lint runs using `settings.delay`, skip files larger than `LINT_MAX_FILE_SIZE`, and coalesce in-flight requests by file path + content hash to prevent stale diagnostics during rapid saves.
