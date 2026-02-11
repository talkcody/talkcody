// Upload service for handling file uploads to Cloudflare R2

import type { R2Bucket } from '../types/env';

export class UploadService {
  private cdnBaseUrl = 'https://cdn.talkcody.com';

  /**
   * Upload avatar image to R2
   * @param userId - User ID
   * @param file - File to upload
   * @param bucket - R2 bucket instance
   * @param publicBaseUrl - Public base URL for accessing uploaded files (e.g., CDN)
   * @returns CDN URL to the uploaded file
   */
  async uploadAvatar(
    userId: string,
    file: File,
    bucket: R2Bucket,
    publicBaseUrl?: string
  ): Promise<string> {
    // Extract file extension
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';

    // Define R2 key (path)
    const key = `users/${userId}/avatar.${ext}`;

    // Delete old avatar files for this user
    await this.deleteOldAvatars(userId, bucket);

    // Read file data
    const arrayBuffer = await file.arrayBuffer();

    // Upload to R2
    await bucket.put(key, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000', // Cache for 1 year
      },
    });

    const baseUrl = publicBaseUrl ?? this.cdnBaseUrl;
    return `${baseUrl}/${key}`;
  }

  /**
   * Delete all old avatar files for a user
   * @param userId - User ID
   * @param bucket - R2 bucket instance
   */
  private async deleteOldAvatars(userId: string, bucket: R2Bucket): Promise<void> {
    const prefix = `users/${userId}/`;

    // List all files in user directory
    const listed = await bucket.list({ prefix });

    // Delete files that contain 'avatar' in the name
    for (const object of listed.objects) {
      if (object.key.includes('avatar')) {
        await bucket.delete(object.key);
      }
    }
  }

  /**
   * Delete avatar by user ID
   * @param userId - User ID
   * @param bucket - R2 bucket instance
   */
  async deleteAvatar(userId: string, bucket: R2Bucket): Promise<void> {
    await this.deleteOldAvatars(userId, bucket);
  }
}

export const uploadService = new UploadService();
