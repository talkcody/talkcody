# Deep Research Agent (Current Code)

This document describes what exists today related to deep research. There is no dedicated Deep Research agent implemented in the current codebase.

## Current Implementation
- There is no system agent named "Deep Research" in `src/services/agents/agent-registry.ts`.
- The only built-in capability relevant to research is the `webSearch` tool (`src/lib/tools/web-search-tool.tsx`).
- `webSearch` uses a fallback chain in `src/lib/web-search/index.ts`: TalkCody internal search -> Tavily -> Serper -> MiniMax (MCP) -> GLM (MCP) -> Exa.
- There is no evidence store, citation model, or research pipeline in services or stores.

## Related Components
- `webSearch` tool returns `WebSearchResult[]` with `title`, `url`, and `content` (`src/lib/web-search/types.ts`).
- Provider-specific search adapters live under `src/lib/web-search/*`.

## Current Design Flaw
There is no dedicated research agent or orchestration layer. Research is limited to raw `webSearch` results without evidence tracking, source de-duplication, or citation mapping.

## Further Optimization
Introduce a purpose-built research agent and a minimal evidence store (IDs, URL, snippets) that can be referenced in outputs. This would enable citations and structured reports while reusing the existing `webSearch` tool.
