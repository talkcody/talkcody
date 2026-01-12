/**
 * Utilities for OS detection and download link generation
 */

import { CONFIG } from './config';

export type Platform = 'mac-apple-silicon' | 'mac-intel' | 'windows' | 'linux' | 'unknown';

export interface DownloadInfo {
  platform: Platform;
  displayName: string;
  downloadUrl: string;
  available: boolean;
}

/**
 * Detect if the current Mac is Apple Silicon using WebGL
 * This method works across Safari, Firefox, and Chrome
 * Reference: https://stackoverflow.com/questions/65146751/detecting-apple-silicon-mac-in-javascript
 */
function isAppleSilicon(): boolean | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      return null; // WebGL not available, cannot determine
    }

    const webgl = gl as WebGLRenderingContext;

    // Method 1: Check WebGL renderer info
    const debugInfo = webgl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const renderer = webgl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string;
      console.log('[Platform Detection] WebGL Renderer:', renderer);

      // If renderer contains Intel, it's definitely Intel Mac
      if (renderer.toLowerCase().includes('intel')) {
        return false;
      }

      // Apple Silicon shows specific chip names like "Apple M1", "Apple M2", "Apple M3", "Apple M4"
      if (renderer.match(/Apple M\d/)) {
        return true;
      }

      // "Apple GPU" in Safari is ambiguous - need additional check below
    }

    // Method 2: Check for WebGL extension support
    // Apple Silicon supports WEBGL_compressed_texture_s3tc_srgb, Intel Macs don't
    const extensions = webgl.getSupportedExtensions() || [];
    if (extensions.includes('WEBGL_compressed_texture_s3tc_srgb')) {
      console.log('[Platform Detection] WEBGL_compressed_texture_s3tc_srgb supported - Apple Silicon');
      return true;
    }

    // If we got here without finding Intel or the sRGB extension, likely Intel
    return false;
  } catch (e) {
    console.error('[Platform Detection] WebGL detection failed:', e);
    return null; // Cannot determine
  }
}

/**
 * Detect user's operating system and architecture
 * Uses WebGL-based detection for reliable Apple Silicon vs Intel Mac detection
 */
export function detectPlatform(): Platform {
  if (typeof window === 'undefined') {
    return 'unknown';
  }

  const userAgent = window.navigator.userAgent.toLowerCase();
  const platform = window.navigator.platform.toLowerCase();

  console.log('[Platform Detection]', { platform, userAgent });

  // Check for macOS
  if (platform.includes('mac') || userAgent.includes('mac')) {
    // Use WebGL-based detection for Apple Silicon vs Intel
    const appleSilicon = isAppleSilicon();
    if (appleSilicon === true) {
      console.log('[Platform Detection] Detected: Apple Silicon (via WebGL)');
      return 'mac-apple-silicon';
    } else if (appleSilicon === false) {
      console.log('[Platform Detection] Detected: Intel Mac (via WebGL)');
      return 'mac-intel';
    }

    // Fallback: default to Apple Silicon (most new Macs are Apple Silicon)
    console.log('[Platform Detection] Defaulting to: Apple Silicon');
    return 'mac-apple-silicon';
  }

  // Check for Windows
  if (platform.includes('win') || userAgent.includes('windows')) {
    return 'windows';
  }

  // Check for Linux
  if (platform.includes('linux') || userAgent.includes('linux')) {
    return 'linux';
  }

  return 'unknown';
}

/**
 * Get download information for a specific platform
 */
export function getDownloadInfo(platform: Platform): DownloadInfo {
  const platformInfo: Record<Platform, DownloadInfo> = {
    'mac-apple-silicon': {
      platform: 'mac-apple-silicon',
      displayName: 'macOS (Apple Silicon)',
      downloadUrl: CONFIG.downloads['darwin-aarch64'] || '#',
      available: !!CONFIG.downloads['darwin-aarch64'],
    },
    'mac-intel': {
      platform: 'mac-intel',
      displayName: 'macOS (Intel)',
      downloadUrl: CONFIG.downloads['darwin-x86_64'] || '#',
      available: !!CONFIG.downloads['darwin-x86_64'],
    },
    'windows': {
      platform: 'windows',
      displayName: 'Windows',
      downloadUrl: CONFIG.downloads['windows-x86_64'] || '#',
      available: !!CONFIG.downloads['windows-x86_64'],
    },
    'linux': {
      platform: 'linux',
      displayName: 'Linux',
      downloadUrl: CONFIG.downloads['linux-x86_64'] || '#',
      available: !!CONFIG.downloads['linux-x86_64'],
    },
    'unknown': {
      platform: 'unknown',
      displayName: 'Download',
      downloadUrl: '/docs/introduction/client-downloads',
      available: true,
    },
  };

  return platformInfo[platform];
}

/**
 * Get smart download button text based on detected platform
 */
export function getDownloadButtonText(platform: Platform, lang: 'en' | 'zh' = 'en'): string {
  const info = getDownloadInfo(platform);

  if (!info.available) {
    return lang === 'en' ? 'View Downloads' : '查看下载';
  }

  if (platform === 'unknown') {
    return lang === 'en' ? 'Download' : '下载';
  }

  const prefix = lang === 'en' ? 'Download for' : '下载';
  return `${prefix} ${info.displayName}`;
}

/**
 * Get all available platforms for download page
 */
export function getAllPlatforms(): DownloadInfo[] {
  return [
    getDownloadInfo('mac-apple-silicon'),
    getDownloadInfo('mac-intel'),
    getDownloadInfo('windows'),
    getDownloadInfo('linux'),
  ];
}
