# Dynamic Model Loading System Documentation

## Overview

This system implements dynamic loading and automatic updates of model configurations, replacing the previously hardcoded `MODEL_CONFIGS`. The system supports both server-synced models and user-defined custom models.

## Architecture

### Storage Hierarchy
```
1. Memory Cache (Memory)
   ↓ (cache miss)
2. Local File Cache (~/.talkcody/models-cache.json)
   ↓ (not exists/corrupted)
3. Built-in Default Config (packages/shared/src/data/models-config.json)
```

### Model Merging Strategy
The system merges two sources of model configurations:
- **Server/Cached Config**: Models synced from the API or bundled defaults
- **Custom Models**: User-defined models from `~/.talkcody/custom-models.json`

Custom models take precedence and can override server models with the same key.

### Update Mechanism
- **On Startup**: Asynchronously checks version without blocking UI
- **Background Timer**: Checks for updates every hour
- **Manual Trigger**: Users can manually refresh models

## File Structure

### Shared Package
```
packages/shared/src/
└── data/
    └── models-config.json           # Model config data source (single source of truth)
```

### Client
```
src/
├── lib/
│   ├── model-loader.ts              # JSON loader with caching & merging
│   └── models.ts                    # Model definitions & utility functions
├── services/
│   ├── model-sync-service.ts        # Remote sync service
│   ├── model-service.ts             # Main model service with provider integration
│   └── custom-model-service.ts      # Custom model management
└── types/
    └── models.ts                    # TypeScript type definitions
```

### API Server
```
apps/api/src/
├── services/
│   └── models-service.ts            # Model service (reads from shared package)
└── routes/
    └── models.ts                    # API routes
```

## Data Model

### ModelConfig Interface
```typescript
interface ModelConfig {
  name: string;                          // Display name
  imageInput?: boolean;                  // Supports image input
  imageOutput?: boolean;                 // Supports image generation
  audioInput?: boolean;                  // Supports audio input
  providers: string[];                   // Available providers
  providerMappings?: Record<string, string>;  // Provider-specific model IDs
  pricing?: { input: string; output: string }; // Per-token pricing
  context_length?: number;               // Max context window
}
```

### ModelsConfiguration Interface
```typescript
interface ModelsConfiguration {
  version: string;          // ISO 8601 timestamp for version comparison
  models: Record<string, ModelConfig>;
}
```

## API Endpoints

### 1. GET `/api/models/version`
Returns the current model configuration version.

**Response:**
```json
{
  "version": "2025-12-03T09:04:36.255Z"
}
```

### 2. GET `/api/models/configs`
Returns the complete model configuration.

**Response:**
```json
{
  "version": "2025-12-03T09:04:36.255Z",
  "models": {
    "gpt-5-mini": {
      "name": "GPT-5 Mini",
      "imageInput": true,
      "providers": ["aiGateway", "openai", "openRouter"],
      "providerMappings": {
        "openai": "gpt-5-mini",
        "aiGateway": "openai/gpt-5-mini",
        "openRouter": "openai/gpt-5-mini"
      },
      "pricing": {
        "input": "0.00000025",
        "output": "0.000002"
      },
      "context_length": 400000
    }
  }
}
```

### 3. GET `/api/models/:modelKey`
Returns a specific model configuration.

### 4. GET `/api/models`
Returns all model keys and count.

**Response:**
```json
{
  "count": 25,
  "models": ["gpt-5-mini", "claude-opus-4.5", ...]
}
```

## Core Components

### ModelLoader (`src/lib/model-loader.ts`)

Handles loading and caching of model configurations:

- **load()**: Loads config with fallback chain (memory → file → default), merges with custom models
- **update(config)**: Saves new config to file cache, clears memory cache
- **getVersion()**: Returns current version string
- **clearCache()**: Clears memory cache for hot-reload
- **validateConfig(config)**: Validates configuration structure

### ModelSyncService (`src/services/model-sync-service.ts`)

Handles version checking and automatic updates:

- **initialize()**: Starts background sync on app startup
- **checkForUpdates()**: Compares versions and downloads if newer
- **startBackgroundSync()**: Starts hourly update checks
- **stopBackgroundSync()**: Stops background sync
- **manualRefresh()**: Triggers manual update check

### ModelService (`src/services/model-service.ts`)

Main service integrating sync and provider logic:

- **initialize()**: Initializes sync service
- **getAvailableModels()**: Returns models filtered by available API keys
- **getBestProviderForModel(modelKey)**: Finds best provider based on priority
- **isModelAvailable(modelIdentifier)**: Checks if model can be used
- **refreshModels()**: Triggers manual refresh
- **getSyncStatus()**: Returns sync status

### models.ts (`src/lib/models.ts`)

Exports model utilities and maintains `MODEL_CONFIGS`:

- **MODEL_CONFIGS**: Dynamic model configurations object
- **ensureModelsInitialized()**: Ensures models are loaded before use
- **refreshModelConfigs()**: Hot-reloads configs after update
- **getProvidersForModel(model)**: Returns available providers
- **getContextLength(model)**: Returns context window size
- **supportsImageInput/Output(model)**: Capability checks

## Maintenance Guide

### How to Update Model Configurations

1. **Edit the data file**
   ```bash
   vim packages/shared/src/data/models-config.json
   ```

2. **Update version timestamp**
   ```json
   {
     "version": "2025-12-10T15:30:00Z",
     "models": {
       // Add or modify models...
     }
   }
   ```

3. **Deploy API**
   ```bash
   cd apps/api
   wrangler deploy
   ```

4. **Client auto-updates**
   - Automatically checks on next startup
   - Or background check every hour
   - Users can also manually refresh

### Adding a New Model

Add to `models-config.json`:

```json
{
  "models": {
    "new-model-key": {
      "name": "New Model Name",
      "imageInput": true,
      "providers": ["openai", "aiGateway", "openRouter"],
      "providerMappings": {
        "openai": "new-model",
        "aiGateway": "openai/new-model",
        "openRouter": "openai/new-model"
      },
      "pricing": {
        "input": "0.000001",
        "output": "0.000005"
      },
      "context_length": 128000
    }
  }
}
```

### Removing a Model

Simply remove the corresponding key-value pair from `models-config.json`.

## Client API Usage

### Initialization
```typescript
import { modelService } from '@/services/model-service';

// Called on app startup (triggers version check automatically)
await modelService.initialize();
```

### Manual Refresh
```typescript
// Manually trigger update check
const updated = await modelService.refreshModels();
if (updated) {
  console.log('Models updated successfully');
}
```

### Get Sync Status
```typescript
const status = modelService.getSyncStatus();
console.log('Is checking:', status.isChecking);
console.log('Background sync active:', status.hasBackgroundSync);
```

### Get Available Models
```typescript
// Get models filtered by configured API keys
const models = await modelService.getAvailableModels();
// Returns: [{ key, name, provider, providerName, imageInput, ... }]
```

### Ensure Models Initialized
```typescript
import { ensureModelsInitialized, MODEL_CONFIGS } from '@/lib/models';

// Wait for models to be loaded before accessing
await ensureModelsInitialized();
const config = MODEL_CONFIGS['gpt-5-mini'];
```

## Testing Guide

### Local Testing

1. **Start local API**
   ```bash
   cd apps/api
   bun run src/index.ts
   ```

2. **Configure environment variables**
   ```bash
   # .env file
   VITE_API_URL_LOCAL=http://localhost:3000
   ```

3. **Start client**
   ```bash
   bun run tauri dev
   ```

### Test Scenarios

#### 1. Test Default Config Loading
- Delete `~/.talkcody/models-cache.json`
- Start the app
- Verify it uses bundled `models-config.json`

#### 2. Test Version Update
- Modify API's `models-config.json` version
- Restart the app
- Check logs to confirm update

#### 3. Test Offline Mode
- Disconnect network or stop API service
- Start the app
- Verify it uses local cache

#### 4. Test Manual Refresh
- Call `modelService.refreshModels()`
- Verify update succeeds

#### 5. Test Custom Models Merging
- Add a model to `~/.talkcody/custom-models.json`
- Restart the app
- Verify custom model appears in available models

## Troubleshooting

### Model Loading Failure
```bash
# Check logs
tail -f ~/Library/Logs/com.kangkaisen.talkcody/talkcody.log

# Search for error messages
grep -i "model" ~/Library/Logs/com.kangkaisen.talkcody/talkcody.log
```

### Clear Local Cache
```bash
# Delete cache file
rm ~/.talkcody/models-cache.json
```

### API Connection Failure
```bash
# Check API URL configuration
echo $VITE_API_URL_PROD

# Test API endpoint
curl https://api.talkcody.com/api/models/version
```

## Security Considerations

- HTTPS transport for configuration
- JSON data validation (structure checking)
- Graceful degradation (use cache when network fails)
- Atomic writes (prevent file corruption)
- No secrets stored in model configs

## Performance Metrics

- **Startup time**: No increase (async loading)
- **Memory usage**: < 100KB (JSON configuration)
- **Network requests**:
  - Version check: < 1KB
  - Full configuration: < 50KB
- **Check frequency**: Once per hour

## Event System

The system dispatches a custom event when models are updated:

```typescript
// Listen for model updates
window.addEventListener('modelsUpdated', () => {
  // Refresh UI components that depend on model list
});
```

## Future Extensions

### Incremental Updates
Extend to download only changed model configurations:
```json
{
  "version": "2025-12-10T15:30:00Z",
  "delta": {
    "added": ["new-model"],
    "removed": ["old-model"],
    "modified": ["updated-model"]
  }
}
```

### A/B Testing
Return different configurations based on user ID:
```typescript
GET /api/models/configs?userId=xxx
```

### Multi-language Support
Extend model names to support multiple languages:
```json
{
  "name": {
    "en": "GPT-5 Mini",
    "zh": "GPT-5 Mini"
  }
}
```
