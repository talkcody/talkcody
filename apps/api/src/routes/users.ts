// User routes
import { Hono } from 'hono';
import { authMiddleware, getAuth } from '../middlewares/auth';
import { getReleasesBucket, getUploadsPublicBaseUrl } from '../services/releases-bucket';
import { uploadService } from '../services/upload-service';
import { userService } from '../services/user-service';
import type { HonoContext } from '../types/context';

const users = new Hono<HonoContext>();

/**
 * Get user profile by ID
 * GET /api/users/:userId
 */
users.get('/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');

    const profile = await userService.getUserProfile(userId);

    if (!profile) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user: profile });
  } catch (error) {
    console.error('Get user profile error:', error);
    return c.json({ error: 'Failed to get user profile' }, 500);
  }
});

/**
 * Get user statistics
 * GET /api/users/:userId/stats
 */
users.get('/:userId/stats', async (c) => {
  try {
    const userId = c.req.param('userId');

    const stats = await userService.getUserStats(userId);

    return c.json({ stats });
  } catch (error) {
    console.error('Get user stats error:', error);
    return c.json({ error: 'Failed to get user statistics' }, 500);
  }
});

/**
 * Get user's published agents
 * GET /api/users/:userId/agents?limit=20&offset=0
 */
users.get('/:userId/agents', async (c) => {
  try {
    const userId = c.req.param('userId');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const offset = parseInt(c.req.query('offset') || '0', 10);

    const result = await userService.getUserAgents(userId, { limit, offset });

    return c.json(result);
  } catch (error) {
    console.error('Get user agents error:', error);
    return c.json({ error: 'Failed to get user agents' }, 500);
  }
});

/**
 * Update current user's profile (requires authentication)
 * PATCH /api/users/me
 * Body: { name?, bio?, website?, avatarUrl? }
 */
users.patch('/me', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const data = await c.req.json();

    const user = await userService.updateUserProfile(userId, data);

    return c.json({ user });
  } catch (error) {
    console.error('Update user profile error:', error);
    // Return the actual error message to help debug the issue
    const errorMessage = error instanceof Error ? error.message : 'Failed to update user profile';
    return c.json({ error: errorMessage }, 500);
  }
});

/**
 * Get current user's profile (requires authentication)
 * GET /api/users/me
 */
users.get('/me', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);

    const profile = await userService.getUserProfile(userId);

    if (!profile) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({ user: profile });
  } catch (error) {
    console.error('Get current user profile error:', error);
    return c.json({ error: 'Failed to get user profile' }, 500);
  }
});

/**
 * Upload avatar image (requires authentication)
 * POST /api/users/me/avatar
 * Body: multipart/form-data with 'avatar' file
 */
users.post('/me/avatar', authMiddleware, async (c) => {
  try {
    const { userId } = getAuth(c);
    const body = await c.req.parseBody();
    const file = body.avatar;

    if (!file || !(file instanceof File)) {
      return c.json({ error: 'No file provided' }, 400);
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      return c.json({ error: 'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed' }, 400);
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return c.json({ error: 'File too large. Maximum size is 5MB' }, 400);
    }

    // Get R2 bucket from environment
    const bucket = getReleasesBucket(c.env);
    if (!bucket) {
      return c.json({ error: 'Storage service not available' }, 503);
    }

    // Upload to R2
    const avatarUrl = await uploadService.uploadAvatar(
      userId,
      file,
      bucket,
      getUploadsPublicBaseUrl(c.env)
    );

    // Update user's avatar URL
    const user = await userService.updateUserProfile(userId, { avatarUrl });

    return c.json({ user, avatarUrl });
  } catch (error) {
    console.error('Upload avatar error:', error);
    return c.json({ error: 'Failed to upload avatar' }, 500);
  }
});

export default users;
