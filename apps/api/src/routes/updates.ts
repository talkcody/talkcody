import { Hono } from 'hono';
import { getReleasesBucket } from '../services/releases-bucket';
import type { HonoContext } from '../types/context';

const updates = new Hono<HonoContext>();

/**
 * Compare two semantic versions
 * Returns true if latest > current
 */
function isNewerVersion(latest: string, current: string): boolean {
  const latestParts = latest.split('.').map(Number);
  const currentParts = current.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const latestPart = latestParts[i] || 0;
    const currentPart = currentParts[i] || 0;

    if (latestPart > currentPart) return true;
    if (latestPart < currentPart) return false;
  }

  return false;
}

/**
 * GET /api/updates/:target/:arch/:currentVersion
 * Check for application updates
 *
 * Example: /api/updates/darwin/aarch64/0.1.0
 *
 * Returns:
 * - HTTP 200 + JSON: Update available
 * - HTTP 204: No update available
 * - HTTP 500: Server error
 */
updates.get('/:target/:arch/:currentVersion', async (c) => {
  const { target, arch, currentVersion } = c.req.param();

  try {
    // Validate parameters
    if (!target || !arch || !currentVersion) {
      return c.json({ error: 'Missing required parameters' }, 400);
    }

    // Access R2 bucket from environment
    const bucket = getReleasesBucket(c.env);
    if (!bucket) {
      console.error('RELEASES_BUCKET not configured');
      return c.json({ error: 'Update service not configured' }, 500);
    }

    const latestObject = await bucket.get('latest.json');

    if (!latestObject) {
      console.error('latest.json not found in R2');
      return c.json({ error: 'No releases available' }, 404);
    }

    const latestData = (await latestObject.json()) as {
      version: string;
      pub_date: string;
      notes: string;
      manifest_url: string;
    };

    // Compare versions
    if (!isNewerVersion(latestData.version, currentVersion)) {
      // No update available
      return c.body(null, 204);
    }

    const manifestPath = `releases/v${latestData.version}/manifest.json`;
    const manifestObject = await bucket.get(manifestPath);

    if (!manifestObject) {
      console.error(`Manifest not found: ${manifestPath}`);
      return c.json({ error: 'Manifest not found' }, 404);
    }

    const manifest = (await manifestObject.json()) as {
      version: string;
      pub_date: string;
      notes: string;
      platforms: Record<
        string,
        {
          url: string;
          signature: string;
          download_url?: string;
        }
      >;
    };

    // Get platform-specific update info
    const platformKey = `${target}-${arch}`;
    const platformData = manifest.platforms[platformKey];

    if (!platformData) {
      console.error(`Platform not found: ${platformKey}`);
      return c.json({ error: 'Platform not supported' }, 404);
    }

    // Return update information in Tauri updater format
    return c.json({
      version: manifest.version,
      notes: manifest.notes || latestData.notes,
      pub_date: manifest.pub_date || latestData.pub_date,
      url: platformData.url,
      signature: platformData.signature,
    });
  } catch (error) {
    console.error('Error checking for updates:', error);
    return c.json(
      {
        error: 'Failed to check for updates',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      500
    );
  }
});

/**
 * GET /api/updates/latest
 * Get latest version information (for informational purposes)
 */
updates.get('/latest', async (c) => {
  try {
    const bucket = getReleasesBucket(c.env);
    if (!bucket) {
      return c.json({ error: 'Update service not configured' }, 500);
    }

    const latestObject = await bucket.get('latest.json');

    if (!latestObject) {
      return c.json({ error: 'No releases available' }, 404);
    }

    const latestData = await latestObject.json();
    return c.json(latestData);
  } catch (error) {
    console.error('Error fetching latest version:', error);
    return c.json({ error: 'Failed to fetch latest version' }, 500);
  }
});

export default updates;
