# How to Add an LLM Provider

## Objective
Document the exact steps to add a new built-in LLM provider across Rust, TypeScript, UI, and model configuration sources.

## Decision Matrix (Before You Start)
Decide these up front so configs stay consistent across Rust and TS:

- Provider ID: stable, lowercase, no spaces (example: `newai`).
- Protocol: `OpenAiCompatible` or `Claude` in Rust.
- Auth type: `None`, `Bearer`, `ApiKey`, `OAuthBearer`, or `TalkCodyJwt`.
- Base URL(s): default, optional Coding Plan base, optional International base.
- OAuth support: `supports_oauth` (Rust) and `supportsOAuth` (TS).
- Models endpoint support: can it list models via `GET /v1/models`?
- Local provider: if it runs on localhost and uses `enabled` instead of an API key.

## Files Checklist

### Rust (backend)
- `src-tauri/src/llm/providers/provider_configs.rs` (register built-in provider)
- `src-tauri/src/llm/types.rs` (extend `ProtocolType` or `AuthType` if needed)
- `src-tauri/src/llm/providers/provider_registry.rs` (custom behavior wiring, if required)
- `src-tauri/src/llm/streaming/stream_handler.rs` (if request/response shape is custom)

### TypeScript (frontend)
- `src/providers/config/provider-config.ts` (provider registry for UI/logic)
- `src/providers/custom/custom-model-service.ts` (models endpoint map, local provider list)
- `src/components/settings/provider-icons.tsx` (provider icon mapping)
- `public/icons/providers/*` (new icon asset if not in simple-icons)
- `src/providers/config/oauth-config.ts` (OAuth registry, if applicable)
- `src/providers/oauth/*` (OAuth flows and stores, if applicable)
- `src/components/settings/api-keys-settings.tsx` (provider-specific settings UI)

### Models config (source of truth)
- `packages/shared/src/data/models-config.json` (default models list)

### Tests
- `src/providers/custom/custom-model-service-endpoints.test.ts` (models endpoint coverage)
- `src/lib/provider-utils.test.ts` (if provider-config is mocked)
- `src/services/custom-model-service.test.ts` (if provider-config is mocked)
- `src/services/model-service.test.ts` (if provider-config is mocked)
- `specs/rust-llm-testing.md` (record/replay tests for Rust providers)

## Step-by-Step

### 1) Add the provider in Rust
Edit `src-tauri/src/llm/providers/provider_configs.rs` and add a new `ProviderConfig` entry:

- `id`, `name`, `protocol`, `base_url`, `api_key_name`.
- `supports_oauth`, `supports_coding_plan`, `supports_international`.
- `coding_plan_base_url`, `international_base_url` if applicable.
- `headers` and `extra_body` if the provider requires custom request fields.
- `auth_type` that matches the provider auth scheme.

If the provider needs a new protocol or auth type, update `src-tauri/src/llm/types.rs`.

If requests or responses require special handling, wire it in the provider registry or stream handler:
- `src-tauri/src/llm/providers/provider_registry.rs`
- `src-tauri/src/llm/streaming/stream_handler.rs`

### 2) Update models configuration (Rust + TS share the same source)
The Rust backend loads models from these sources in order:

1. `models_config_json` in DB (may be written by the model sync job)
2. Bundled default: `packages/shared/src/data/models-config.json`
3. Custom user models (`custom-models.json` in app data)

To add a built-in provider, update the bundled default JSON:
- Add the provider ID to each model it supports under `providers`.
- Add provider-specific model IDs in `providerMappings` where needed.

Notes:
- The model sync job (`src-tauri/src/llm/models/model_sync.rs`) can override the DB config at runtime.
- The frontend reads models via `llm_get_models_config`, so the Rust source is the canonical path.

### 3) Add the provider in TypeScript config
Edit `src/providers/config/provider-config.ts` and add a provider entry:

- `id`, `name`, `apiKeyName`, `type`.
- Optional: `baseUrl`, `supportsOAuth`, `supportsCodingPlan`, `supportsInternational`.

Make sure TS flags match the Rust config (`supportsOAuth` vs `supports_oauth`, etc.).

### 4) Models endpoint + local provider handling
Edit `src/providers/custom/custom-model-service.ts`:

- Add a `PROVIDER_MODELS_ENDPOINTS` entry for the provider.
- If the provider does not support model listing, set the endpoint to `null`.
- If it is a local provider, add it to `LOCAL_PROVIDERS`.

### 5) UI icon and settings
- Add or map the provider icon in `src/components/settings/provider-icons.tsx`.
- If a custom icon is required, place it in `public/icons/providers/*` and map it.
- If the provider needs custom settings UI (extra inputs, toggles), update
  `src/components/settings/api-keys-settings.tsx`.

### 6) OAuth integration (if needed)
If `supportsOAuth` is true:

- Update `src/providers/config/oauth-config.ts` with the provider mapping.
- Add or extend OAuth service/store in `src/providers/oauth/*`.
- Ensure `src/hooks/use-oauth-status.ts` and `src/components/settings/oauth-provider-input.tsx`
  cover the new provider.

### 7) Update tests
- `src/providers/custom/custom-model-service-endpoints.test.ts`:
  - Add the provider to `supportedProviders` if it supports `/v1/models`.
  - Add it to `providersWithoutModelsEndpoint` or `nonAIProviders` if not.
- Update any test mocks referencing `PROVIDER_CONFIGS`.
- For Rust providers with custom behavior, record fixtures and add tests per
  `specs/rust-llm-testing.md`.

## Verification Checklist

### Automated
Run from repo root:

```bash
bun run test
bun run lint
bun run tsc
```

### Manual
- Provider appears in Settings with correct name and icon.
- API key or OAuth flow works.
- Model list fetch succeeds (or is explicitly unsupported).
- Streaming request works end-to-end (Rust backend).

## Common Pitfalls
- Missing `PROVIDER_MODELS_ENDPOINTS` entry causes test failures.
- Rust and TS configs out of sync (flags or base URLs).
- Model config updated in JSON but overridden by DB model sync.
- Provider ID mismatch between Rust, TS, and models config.
