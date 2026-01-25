# TalkCody Auto-Update API Setup Guide

This guide explains how to set up the update API endpoint for TalkCody's auto-update functionality.

## Overview

TalkCody is configured to check for updates from:
```
https://api.talkcody.com/update/{{target}}/{{arch}}/{{current_version}}
```

The updater will make requests like:
- `https://api.talkcody.com/update/darwin/aarch64/0.1.0`
- `https://api.talkcody.com/update/darwin/x86_64/0.1.0`

## API Response Format

### When Update is Available (HTTP 200)

Return JSON with the following structure:

```json
{
  "version": "0.2.0",
  "notes": "Bug fixes and new features",
  "pub_date": "2025-01-15T10:00:00Z",
  "url": "https://github.com/talkcody/talkcody/releases/download/v0.2.0/talkcody_0.2.0_aarch64.app.tar.gz",
  "signature": "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUldROG4xa1gzdk9zSnRsZXorcytkdy9Eb3dCY0xQeUl3SUZPT3BPNGlMcDNGanhoUm5Fd3pIOVMK..."
}
```

### When No Update is Available (HTTP 204)

Return HTTP 204 No Content with an empty body.

## Implementation Options

### Option 1: Using your apps/api Service

Create an endpoint in `/Users/kks/mygit/talkcody/apps/api` that:

1. Parses the request path to extract `target`, `arch`, and `current_version`
2. Fetches the latest release from GitHub API or your database
3. Compares versions (semantic versioning)
4. Returns appropriate response

Example implementation (Node.js/Express):

```javascript
app.get('/update/:target/:arch/:currentVersion', async (req, res) => {
  const { target, arch, currentVersion } = req.params;

  try {
    // Fetch latest release from GitHub
    const response = await fetch(
      'https://api.github.com/repos/kangkaisen/talkcody/releases/latest'
    );
    const release = await response.json();

    const latestVersion = release.tag_name.replace('v', '');

    // Compare versions
    if (isNewerVersion(latestVersion, currentVersion)) {
      // Find the appropriate asset
      const assetName = `talkcody_${latestVersion}_${arch}.app.tar.gz`;
      const asset = release.assets.find(a => a.name === assetName);
      const sigAsset = release.assets.find(a => a.name === `${assetName}.sig`);

      if (!asset || !sigAsset) {
        return res.status(404).json({ error: 'Update assets not found' });
      }

      // Fetch signature content
      const sigResponse = await fetch(sigAsset.browser_download_url);
      const signature = await sigResponse.text();

      return res.json({
        version: latestVersion,
        notes: release.body || 'See release notes on GitHub',
        pub_date: release.published_at,
        url: asset.browser_download_url,
        signature: signature.trim()
      });
    }

    // No update available
    return res.status(204).send();

  } catch (error) {
    console.error('Update check error:', error);
    return res.status(500).json({ error: 'Failed to check for updates' });
  }
});

function isNewerVersion(latest, current) {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (latestParts[i] > currentParts[i]) return true;
    if (latestParts[i] < currentParts[i]) return false;
  }
  return false;
}
```

### Option 2: Using Cloudflare R2 + Workers

1. **Store update manifests in R2:**
   - Create a bucket in Cloudflare R2
   - Upload version-specific manifests: `v0.2.0-darwin-aarch64.json`, `v0.2.0-darwin-x86_64.json`
   - Store a `latest.json` file with the current version info

2. **Create a Cloudflare Worker:**

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    // Parse: /update/darwin/aarch64/0.1.0
    if (pathParts[0] === 'update' && pathParts.length === 4) {
      const [_, target, arch, currentVersion] = pathParts;

      try {
        // Fetch latest manifest from R2
        const key = `latest-${target}-${arch}.json`;
        const object = await env.BUCKET.get(key);

        if (!object) {
          return new Response('Not found', { status: 404 });
        }

        const manifest = await object.json();

        // Compare versions
        if (isNewerVersion(manifest.version, currentVersion)) {
          return new Response(JSON.stringify(manifest), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }

        // No update available
        return new Response(null, { status: 204 });

      } catch (error) {
        return new Response('Internal error', { status: 500 });
      }
    }

    return new Response('Not found', { status: 404 });
  }
};
```

3. **Update workflow to upload manifests:**
   - Add step in GitHub Actions to upload manifest to R2 using Wrangler or R2 API

### Option 3: Static JSON with Redirects

If you want the simplest approach:

1. Host a static `latest.json` file
2. Configure your update endpoint to redirect based on target/arch:
   ```
   /update/darwin/aarch64/* → https://cdn.talkcody.com/latest.json
   ```

## Setting Up GitHub Secrets

Your release workflow needs the private key. Set it in GitHub:

1. Go to your repository settings → Secrets and variables → Actions
2. Add or update these secrets:
   - `TAURI_PRIVATE_KEY`: The contents of `~/.tauri/talkcody.key`
   - `TAURI_KEY_PASSWORD`: Leave empty if you used empty password

To get the private key content:
```bash
cat ~/.tauri/talkcody.key
```

## Testing the Update Flow

1. **Test the endpoint manually:**
   ```bash
   curl https://api.talkcody.com/update/darwin/aarch64/0.1.0
   ```

2. **Test in the app:**
   - Build a version with a lower version number
   - Open Settings → About → Check for Updates
   - Verify the update dialog appears

3. **Test automatic updates:**
   - Launch the app
   - Wait for automatic check (should happen on startup)
   - Verify toast notification appears

## Version Management

The current version is set in:
- `src-tauri/tauri.conf.json` → `"version": "0.1.0"`

When releasing a new version:
1. Update the version in `tauri.conf.json`
2. Commit the change
3. Create and push a git tag: `git tag v0.2.0 && git push origin v0.2.0`
4. GitHub Actions will automatically build and create the release
5. Your update API will serve the new version to existing users

## Security Considerations

1. **Signature Verification**: The updater automatically verifies signatures using the public key
2. **HTTPS Only**: Updates must be served over HTTPS (enforced by Tauri)
3. **GitHub Releases**: Using GitHub releases as the source provides built-in integrity
4. **Private Key Security**: Never commit the private key; store it securely in GitHub Secrets

## Troubleshooting

### Updates not detected
- Check the API endpoint is accessible
- Verify the response format matches exactly
- Check version comparison logic
- View logs in `~/Library/Logs/com.kangkaisen.talkcody/talkcody.log`

### Signature verification fails
- Ensure the signature file content is included correctly
- Verify the public key in `tauri.conf.json` matches the private key used for signing
- Check that artifacts were signed during build

### Download fails
- Verify the URL in the manifest is accessible
- Check file permissions on your CDN/storage
- Ensure CORS headers are set correctly if using a CDN

## Next Steps

1. Implement the update API endpoint (choose one of the options above)
2. Set up the GitHub secrets if not already done
3. Create a test release to verify the workflow
4. Test the update flow end-to-end
5. Deploy the API endpoint to production

## Example Update Flow

1. User opens TalkCody v0.1.0
2. App checks: `GET https://api.talkcody.com/update/darwin/aarch64/0.1.0`
3. API returns v0.2.0 details
4. Toast notification: "Update Available - Version 0.2.0"
5. User clicks "Update"
6. Download progress shows
7. After download: "Update Ready - Restart Now"
8. User clicks restart
9. App relaunches with v0.2.0
