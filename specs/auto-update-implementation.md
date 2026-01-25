# TalkCody Auto-Update Implementation

This document summarizes the complete auto-update functionality implementation for TalkCody.

## Overview

The auto-update system enables TalkCody to automatically check for, download, and install updates. It uses Tauri's built-in updater plugin with cryptographic signature verification for security.

## Architecture

```
┌─────────────────┐
│   TalkCody App  │
│    (v0.1.x)     │
└────────┬────────┘
         │
         │ 1. Check for update
         │ GET /api/updates/{target}/{arch}/{version}
         ↓
┌─────────────────────┐
│   Update API Server │
│ api.talkcody.com    │
└────────┬────────────┘
         │
         │ 2. Fetch latest.json & manifest.json
         ↓
┌─────────────────────┐
│   Cloudflare R2     │
│  - latest.json      │
│  - manifest.json    │
│  - Installer files  │
│  - Signature files  │
└────────┬────────────┘
         │
         │ 3. Return update info
         ↓
┌─────────────────┐
│  Update Dialog  │
│  - Download     │
│  - Verify sig   │
│  - Install      │
│  - Restart      │
└─────────────────┘
```

## Implementation

### Backend (Rust/Tauri)

**Files:**
- `src-tauri/Cargo.toml` - `tauri-plugin-updater` dependency
- `src-tauri/src/lib.rs` - Updater plugin initialization
- `src-tauri/capabilities/default.json` - `updater:default` permission
- `src-tauri/tauri.conf.json` - Updater configuration

**Configuration (`tauri.conf.json`):**
```json
{
  "plugins": {
    "updater": {
      "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
      "endpoints": [
        "https://api.talkcody.com/api/updates/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  },
  "bundle": {
    "createUpdaterArtifacts": true
  }
}
```

### Frontend (React/TypeScript)

**Core Files:**
| File | Description |
|------|-------------|
| `src/services/update-service.ts` | Core update service with check, download, install logic |
| `src/hooks/use-updater.ts` | React hook for update state management |
| `src/components/update-dialog.tsx` | Modal dialog for update flow with progress |
| `src/components/update-notification.tsx` | Toast notifications for update events |

### API Server (Cloudflare Workers)

**File:** `apps/api/src/routes/updates.ts`

**Endpoints:**

| Endpoint | Description |
|----------|-------------|
| `GET /api/updates/:target/:arch/:currentVersion` | Check for updates |
| `GET /api/updates/latest` | Get latest version info |

**Update Check Response:**
- HTTP 200 + JSON: Update available
- HTTP 204: No update available
- HTTP 404/500: Error

**Response Format (when update available):**
```json
{
  "version": "0.1.16",
  "notes": "Release v0.1.16",
  "pub_date": "2025-12-10T00:00:00Z",
  "url": "https://cdn.talkcody.com/releases/v0.1.16/talkcody_0.1.16_aarch64.app.tar.gz",
  "signature": "dW50cnVzdGVkIGNvbW1lbnQ6..."
}
```

### Release Workflow

**Files:**
- `.github/workflows/release.yml` - Main release workflow
- `.github/scripts/release.sh` - Unified release script

**Supported Platforms:**
| Platform | Architecture | Artifact |
|----------|--------------|----------|
| macOS | aarch64 | `.app.tar.gz` |
| macOS | x86_64 | `.app.tar.gz` |
| Linux | x86_64 | `.AppImage` |
| Windows | x86_64 | `.msi` |

**Release Process:**
1. Tag a new version: `git tag v0.1.x && git push origin v0.1.x`
2. GitHub Actions builds for all platforms
3. Artifacts signed with `TAURI_SIGNING_PRIVATE_KEY`
4. Files uploaded to Cloudflare R2:
   - `releases/v{version}/{artifact}`
   - `releases/v{version}/{artifact}.sig`
   - `releases/v{version}/manifest.json`
   - `latest.json`

**Manifest Format (`manifest.json`):**
```json
{
  "version": "0.1.16",
  "pub_date": "2025-12-10T00:00:00Z",
  "notes": "Release v0.1.16",
  "platforms": {
    "darwin-aarch64": {
      "url": "https://cdn.talkcody.com/releases/v0.1.16/talkcody_0.1.16_aarch64.app.tar.gz",
      "signature": "...",
      "download_url": "https://cdn.talkcody.com/releases/v0.1.16/talkcody_0.1.16_aarch64.app.tar.gz"
    },
    "linux-x86_64": {
      "url": "https://cdn.talkcody.com/releases/v0.1.16/talkcody_0.1.16_amd64.AppImage",
      "signature": "...",
      "download_url": "..."
    }
  }
}
```

## Features

### Automatic Updates
- Check for updates on app startup
- Periodic background checks (every 12 hours)
- Silent background download when update available
- Non-intrusive toast notifications
- Prompt to restart after installation

### Manual Updates
- "Check for Updates" button in Settings > About
- Display current version
- Force check at any time

### Update UI
- Update dialog with version comparison
- Release notes display
- Download progress with percentage
- Bytes downloaded/total display
- Error handling with retry option
- Restart now/later options

### State Management
- Track checking/downloading/downloaded states
- Progress tracking during download
- Error state with user-friendly messages
- Persistent last check time in localStorage

## Core Components

### UpdateService (`src/services/update-service.ts`)

Singleton service handling update operations:

```typescript
class UpdateService {
  checkForUpdate(): Promise<Update | null>
  downloadAndInstall(update: Update, onProgress?: UpdateProgressCallback): Promise<void>
  checkAndUpdate(onProgress?: UpdateProgressCallback): Promise<boolean>
  restartApp(): Promise<void>
  getUpdateInfo(update: Update): UpdateInfo
  isCheckingForUpdate(): boolean
  isDownloadingUpdate(): boolean
}
```

### useUpdater Hook (`src/hooks/use-updater.ts`)

React hook for managing update state:

```typescript
interface UseUpdaterReturn {
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  error: string | null;
  update: Update | null;
  progress: DownloadProgress | null;
  checkForUpdate: () => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  restartApp: () => Promise<void>;
  dismissError: () => void;
}

// Usage
const updater = useUpdater({
  checkOnMount: true,   // Check on component mount
  periodicCheck: true,  // Check every 12 hours
});
```

### UpdateNotification (`src/components/update-notification.tsx`)

Component for automatic update checking and notifications:

```tsx
<UpdateNotification
  checkOnMount={true}   // Check on startup
  periodicCheck={true}  // Check every 12h
/>
```

Behavior:
1. Checks for updates on mount (if enabled)
2. Auto-downloads in background when update found
3. Shows toast notification when download completes
4. User can restart immediately or later

### UpdateDialog (`src/components/update-dialog.tsx`)

Modal dialog for manual update flow:
- Shows version comparison
- Displays release notes
- Progress bar during download
- Restart/Later buttons after completion

## Security

### Signing Keys
- Private key: `~/.tauri/talkcody.key`
- Public key: `~/.tauri/talkcody.key.pub`
- Public key configured in `tauri.conf.json`

### Security Features
- All updates are cryptographically signed (minisign)
- Signature verification happens automatically
- HTTPS-only update delivery
- No way to bypass signature checks
- Signature files stored alongside artifacts in R2

## Configuration

### Update Check Frequency

Edit `src/hooks/use-updater.ts`:
```typescript
const PERIODIC_CHECK_INTERVAL = 12 * 60 * 60 * 1000; // 12 hours
```

### Update Endpoint

Edit `src-tauri/tauri.conf.json`:
```json
{
  "plugins": {
    "updater": {
      "endpoints": [
        "https://api.talkcody.com/api/updates/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

## Setup Guide

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `TAURI_SIGNING_PRIVATE_KEY` | Minisign private key for signing |
| `CLOUDFLARE_API_TOKEN` | API token for R2 access |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |

### Cloudflare R2 Setup

1. Create R2 bucket named `talkcody`
2. Configure public access via custom domain (cdn.talkcody.com)
3. Ensure wrangler has proper credentials

### Version Release Checklist

- [ ] Update version in `src-tauri/tauri.conf.json`
- [ ] Update `CHANGELOG.md` with changes
- [ ] Commit: `git commit -m "chore: bump version to x.y.z"`
- [ ] Create tag: `git tag vx.y.z`
- [ ] Push tag: `git push origin vx.y.z`
- [ ] GitHub Actions builds and uploads automatically
- [ ] Verify R2 files uploaded correctly
- [ ] Test update from previous version

## Troubleshooting

### Updates Not Detected

```bash
# Check API endpoint
curl https://api.talkcody.com/api/updates/darwin/aarch64/0.1.0

# Check latest.json
curl https://cdn.talkcody.com/latest.json

# Check app logs
tail -f ~/Library/Logs/com.kangkaisen.talkcody/talkcody.log | grep -i update
```

### Signature Verification Fails

- Verify public key in `tauri.conf.json` matches private key
- Ensure `TAURI_SIGNING_PRIVATE_KEY` secret is set correctly
- Check `.sig` file exists in R2 alongside artifact

### Download Fails

- Verify artifact URL is accessible
- Check CORS headers on CDN
- Ensure file permissions allow public access

### "No Update Available" When Newer Version Exists

- Check version comparison logic (semantic versioning)
- Verify `latest.json` has correct version
- Test API endpoint manually

## File Structure

```
src/
├── services/
│   └── update-service.ts        # Core update logic
├── hooks/
│   └── use-updater.ts           # React state management
├── components/
│   ├── update-dialog.tsx        # Manual update UI
│   └── update-notification.tsx  # Auto-update notifications
└── app.tsx                      # UpdateNotification integration

apps/api/src/
└── routes/
    └── updates.ts               # Update check API

src-tauri/
├── tauri.conf.json              # Updater configuration
└── Cargo.toml                   # Plugin dependency

.github/
├── workflows/
│   └── release.yml              # Release automation
└── scripts/
    └── release.sh               # R2 upload script
```