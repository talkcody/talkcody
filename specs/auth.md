# Authentication (Current Code)

This document describes the current authentication flows implemented in TalkCody.

## Overview
There are two distinct auth areas:
1. **TalkCody account auth** for app services (GitHub/Google OAuth).
2. **Provider OAuth** for LLM vendors (OpenAI, Claude, GitHub Copilot, Qwen Code).

## TalkCody Account Auth
- `authService` opens OAuth flows in the system browser (`/api/auth/github`, `/api/auth/google`).
- OAuth callback is received via deep link (`talkcody://auth/callback?token=...`).
- `useAuthStore.handleOAuthCallback` stores the token and fetches `/api/auth/me`.
- Token is persisted in app data (`talkcody-auth.json`) via `secureStorage`.

Key files:
- `src/services/auth-service.ts`
- `src/stores/auth-store.ts`
- `src/services/secure-storage.ts`
- `src/app.tsx` (deep link handling)

## API Client Behavior
- `apiClient` injects the stored token into requests.
- On `401`, it signs out and clears auth state.

## Provider OAuth
Provider-specific OAuth is separate from TalkCody account auth and stored in the settings database:
- **OpenAI OAuth**: OAuth code flow with local callback server (Tauri `oauth_callback_server.rs`) and optional manual code entry.
- **Claude OAuth**: OAuth code flow with PKCE and manual code entry.
- **GitHub Copilot**: Device Code flow with polling (no callback server).
- **Qwen Code**: Reads OAuth credentials from a local file path and auto-refreshes tokens.

Key files:
- `src/providers/oauth/*-oauth-service.ts`
- `src/providers/oauth/*-oauth-store.ts`
- `src/components/settings/*-oauth-login.tsx`
- `src-tauri/src/oauth_callback_server.rs`

## Current Design Flaw
TalkCody account auth stores the token in a plain JSON file under app data (not in platform keychain). This is less secure than provider OAuth tokens stored in the settings DB and increases risk if the app data directory is accessed.

## Further Optimization
Move TalkCody account tokens to a more secure store (OS keychain or encrypted storage) and unify token lifecycle handling (refresh/revoke where supported).
