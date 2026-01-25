# Docs Static Export (Current Code)

This document reflects the current docs setup and what is actually implemented.

## Current Implementation
- Docs use Next.js with Fumadocs, configured in `docs/next.config.mjs`.
- Static export is **not enabled** (`output: 'export'` is not set).
- Search is implemented as a server route: `docs/app/api/search/route.ts` using `createFromSource`.
- `RootProvider` in `docs/app/[lang]/layout.tsx` does not configure a custom static search dialog.

## Current Design Flaw
The docs currently rely on an API route for search, which prevents full static export and forces server execution for search requests.

## Further Optimization
If static export is desired, migrate search to a static client search dialog and remove the API route, then enable `output: 'export'` and `images.unoptimized` in `docs/next.config.mjs`.
