# HTTP Request Architecture

This document describes all modules that make HTTP requests in TalkCody.

## Core Principle

In the Tauri WebView environment, native `fetch` is restricted by CORS and cannot directly access external APIs or local services (like Ollama). Therefore, all HTTP requests must be made through the Tauri Rust backend to bypass CORS.

## Core Module

### 1. `src/lib/tauri-fetch.ts`

The core HTTP request module, providing two fetch functions:

#### 1.1 `simpleFetch` - Simple HTTP Requests (Recommended for most scenarios)

```typescript
// Simple HTTP request - waits for complete response before returning
export async function simpleFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response>
```

**Features**:
- Makes HTTP requests through Tauri Rust backend's `proxy_fetch` command
- Waits for complete response body before returning, avoiding race conditions
- Bypasses WebView CORS restrictions
- Falls back to native `fetch` for FormData, Blob, ArrayBuffer (unsupported body types)
- **Use cases**: GET/POST/PUT/DELETE requests that return complete responses

**Usage Example**:
```typescript
import { simpleFetch } from '@/lib/tauri-fetch';

// Simple GET request
const response = await simpleFetch('https://api.example.com/data');
const data = await response.json();

// POST request
const response = await simpleFetch('https://api.example.com/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ key: 'value' }),
});
```

#### 1.2 `streamFetch` - Streaming Response (AI SDK only)

```typescript
// Singleton instance for streaming fetch
export const streamFetch: TauriFetchFunction
```

**Features**:
- Makes HTTP requests through Tauri Rust backend's `stream_fetch` command
- Supports true streaming response (receives data chunks in real-time via Tauri events)
- Supports AbortSignal for request cancellation
- 60-second no-data timeout protection
- **Use cases**: SSE (Server-Sent Events), chunked transfer encoding responses, AI chat completions

**Usage Example**:
```typescript
import { streamFetch } from '@/lib/tauri-fetch';

// AI SDK Provider configuration (requires streaming response)
const provider = createOpenAI({
  apiKey,
  fetch: streamFetch as typeof fetch,
});
```

### How to Choose simpleFetch vs streamFetch

| Scenario | Function | Reason |
|----------|----------|--------|
| API data fetching (GET/POST) | `simpleFetch` | Waits for complete response, avoids race conditions |
| AI SDK Provider configuration | `streamFetch` | Needs to stream tokens incrementally |
| SSE event streams | `streamFetch` | Needs real-time chunk processing |
| File upload/download | `simpleFetch` | Complete response is more reliable |
| Webhook/API calls | `simpleFetch` | Simple requests don't need streaming |

---

## AI Provider Module

### 2. `src/providers/provider_config.ts`

All AI Provider configurations and factory functions. Each provider correctly configures `fetch: streamFetch` to support streaming responses.

| Provider | SDK | Base URL |
|----------|-----|----------|
| `aiGateway` | `@ai-sdk/gateway` | Vercel AI Gateway |
| `openRouter` | `@openrouter/ai-sdk-provider` | OpenRouter API |
| `openai` | `@ai-sdk/openai` | OpenAI API |
| `anthropic` | `@ai-sdk/anthropic` | Anthropic API |
| `deepseek` | `@ai-sdk/openai-compatible` | `https://api.deepseek.com` |
| `zhipu` | `@ai-sdk/openai-compatible` | `https://open.bigmodel.cn` |
| `MiniMax` | `@ai-sdk/openai-compatible` | `https://api.minimaxi.com` |
| `google` | `@ai-sdk/google` | Google AI |
| `ollama` | `@ai-sdk/openai-compatible` | `http://127.0.0.1:11434` |
| `lmstudio` | `@ai-sdk/openai-compatible` | `http://127.0.0.1:1234` |

### 3. `src/services/ai-provider-service.ts`

AI Provider management service, responsible for:
- Creating provider instances based on API Key configuration
- Parsing `modelKey@provider` format model identifiers
- Auto-selecting the best provider

---

## Business Service Modules

### 4. `src/services/api-client.ts`

Generic API client that wraps backend API requests. Internally uses `simpleFetch`.

```typescript
class ApiClient {
  async fetch(endpoint: string, options: ApiClientOptions): Promise<Response>
  async get(endpoint: string, options?): Promise<Response>
  async post(endpoint: string, body: unknown, options?): Promise<Response>
  async put(endpoint: string, body: unknown, options?): Promise<Response>
  async patch(endpoint: string, body: unknown, options?): Promise<Response>
  async delete(endpoint: string, options?): Promise<Response>
}
```

### 5. `src/services/auth-service.ts`

User authentication service.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `checkAuth()` | `GET /api/auth/me` | Check login status |

### 6. `src/services/model-sync-service.ts`

Model configuration sync service.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `pullFromCloud()` | `GET /api/user/settings` | Pull cloud configuration |
| `pushToCloud()` | `PUT /api/user/settings` | Push local configuration |

### 7. `src/services/custom-model-service.ts`

Custom model service for fetching provider's available model list.

```typescript
// Uses invoke to call proxy_fetch directly (non-streaming)
const response = await invoke<ProxyResponse>('proxy_fetch', { request: proxyRequest });
```

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `fetchProviderModels()` | Provider `/v1/models` | Get model list |

### 8. `src/services/r2-storage-service.ts`

R2 storage service for skill package upload/download.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `uploadSkillPackage()` | `POST /api/skills/packages/upload` | Upload skill package |
| `downloadSkillPackage()` | `GET /api/skills/packages/{skillId}/{version}/download` | Download skill package |
| `deleteSkillPackage()` | `DELETE /api/skills/packages/{skillId}/{version}` | Delete skill package |
| `listSkillVersions()` | `GET /api/skills/packages/{skillId}/versions` | List package versions |

### 9. `src/services/ai-transcription-service.ts`

AI audio transcription service.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `transcribeWithOpenRouter()` | `https://openrouter.ai/api/v1/chat/completions` | OpenRouter transcription |
| `transcribeWithOpenAI()` | `https://api.openai.com/v1/audio/transcriptions` | OpenAI Whisper transcription |
| `transcribeWithGoogle()` | `https://generativelanguage.googleapis.com/v1beta/models/...` | Google Gemini transcription |

### 10. `src/services/elevenlabs-token-service.ts`

ElevenLabs Token generation service.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `generateElevenLabsToken()` | `https://api.elevenlabs.io/v1/single-use-token/realtime_scribe` | Get single-use token |

### 11. `src/services/skills/skill-service.ts`

Skill service for resolving remote URL documentation.

```typescript
// resolveDocumentation() method
case 'url':
  const response = await simpleFetch(doc.url);
```

---

## Hooks Module

### 12. `src/hooks/use-marketplace.ts`

Agent Marketplace Hook. Uses `simpleFetch` for data fetching.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `fetchAgents()` | `GET /api/marketplace/agents` | Get Agent list |
| `fetchCategories()` | `GET /api/marketplace/categories` | Get categories |
| `fetchTags()` | `GET /api/marketplace/tags` | Get tags |
| `fetchFeaturedAgents()` | `GET /api/marketplace/agents/featured` | Get featured Agents |
| `fetchAgentBySlug()` | `GET /api/marketplace/agents/{slug}` | Get Agent details |

### 13. `src/hooks/use-marketplace-skills.ts`

Skills Marketplace Hook. Uses `simpleFetch` for data fetching.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `fetchSkills()` | `GET /api/skills-marketplace/skills` | Get skill list |
| `fetchCategories()` | `GET /api/skills-marketplace/categories` | Get categories |
| `fetchTags()` | `GET /api/skills-marketplace/tags` | Get tags |
| `fetchFeaturedSkills()` | `GET /api/skills-marketplace/skills/featured` | Get featured skills |
| `fetchSkillBySlug()` | `GET /api/skills-marketplace/skills/{slug}` | Get skill details |

---

## Utility Functions

### 14. `src/lib/utils.ts`

General utility functions.

```typescript
// Fetch with timeout using simpleFetch to bypass CORS
export const fetchWithTimeout = async (
  resource: RequestInfo,
  options: FetchWithTimeoutOptions = {}
): Promise<Response>
```

Uses `simpleFetch` internally with `AbortSignal.timeout` for automatic request cancellation.

Used by the following modules:
- `src/lib/web-search.ts` - Tavily Search API
- `src/lib/utils/web-fetcher.ts` - Jina AI / Tavily Extract API

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (WebView)                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  AI Providers   │  │ Business Services│  │     Hooks       │ │
│  │                 │  │                  │  │                 │ │
│  │ - provider_config│ │ - api-client     │  │ - use-marketplace│
│  │ - ai-provider   │  │ - auth-service   │  │ - use-marketplace│
│  │                 │  │ - model-sync     │  │   -skills       │ │
│  │                 │  │ - r2-storage     │  │                 │ │
│  │   (streamFetch) │  │ - transcription  │  │   (simpleFetch)  │ │
│  │                 │  │ - skill-service  │  │                 │ │
│  └────────┬────────┘  │   (simpleFetch)   │  └────────┬────────┘ │
│           │           └────────┬─────────┘           │          │
│           │                    │                      │          │
│           └────────────────────┼──────────────────────┘          │
│                                │                                  │
│         ┌──────────────────────┴──────────────────────┐          │
│         │                                              │          │
│   ┌─────▼─────┐                              ┌────────▼────────┐ │
│   │streamFetch│                              │   simpleFetch    │ │
│   │(streaming)│                              │ (simple request) │ │
│   └─────┬─────┘                              └────────┬────────┘ │
│         │                                             │          │
├─────────┼─────────────────────────────────────────────┼──────────┤
│         │              Tauri IPC Bridge               │          │
│         │                                             │          │
│   ┌─────▼─────┐                              ┌────────▼────────┐ │
│   │stream_fetch│                             │   proxy_fetch   │ │
│   │  + events │                              │(complete response)│ │
│   └─────┬─────┘                              └────────┬────────┘ │
│         │                                             │          │
├─────────┴─────────────────────────────────────────────┴──────────┤
│                         Rust Backend                             │
│                    ┌───────────────────────┐                     │
│                    │    reqwest HTTP       │                     │
│                    │   (actual HTTP)       │                     │
│                    └───────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                    ┌───────────────────────┐
                    │    External APIs      │
                    │                       │
                    │ - OpenAI / Anthropic  │
                    │ - OpenRouter / Google │
                    │ - Ollama (localhost)  │
                    │ - TalkCody Backend    │
                    │ - Tavily / Jina AI    │
                    └───────────────────────┘
```

---

## Important Notes

1. **NEVER use native `fetch` in Tauri frontend** - Will encounter CORS issues
2. **Use `simpleFetch` for simple requests** - Avoids race conditions from streaming requests
3. **AI SDK providers must use `fetch: streamFetch`** - Requires streaming response support
4. **`fetchWithTimeout` uses `simpleFetch`** - Safe to use, bypasses CORS
5. **Streaming vs Non-streaming selection**:
   - If you need real-time data (AI chat) → `streamFetch`
   - If you only need final result (API call) → `simpleFetch`

---

## Related File List

| File Path | Fetch Used | Purpose |
|-----------|------------|---------|
| `src/lib/tauri-fetch.ts` | - | Core fetch implementation |
| `src/providers/provider_config.ts` | `streamFetch` | AI Provider configuration |
| `src/services/ai-provider-service.ts` | - | AI Provider management |
| `src/services/api-client.ts` | `simpleFetch` | Generic API client |
| `src/services/auth-service.ts` | `simpleFetch` | Authentication service |
| `src/services/model-sync-service.ts` | `simpleFetch` | Model sync service |
| `src/services/custom-model-service.ts` | `proxy_fetch` (invoke) | Custom model service |
| `src/services/r2-storage-service.ts` | `simpleFetch` | R2 storage service |
| `src/services/ai-transcription-service.ts` | `simpleFetch` | Audio transcription service |
| `src/services/elevenlabs-token-service.ts` | `simpleFetch` | ElevenLabs Token |
| `src/services/skills/skill-service.ts` | `simpleFetch` | Skill service |
| `src/lib/utils.ts` | `simpleFetch` | fetchWithTimeout utility |
| `src/lib/web-search.ts` | `fetchWithTimeout` | Tavily Search |
| `src/lib/utils/web-fetcher.ts` | `fetchWithTimeout` | Web content fetching |
| `src/hooks/use-marketplace.ts` | `simpleFetch` | Agent Marketplace |
| `src/hooks/use-marketplace-skills.ts` | `simpleFetch` | Skills Marketplace |

---