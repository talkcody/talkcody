// Tests for useMarketplaceSkills hook

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMarketplaceSkills } from './use-marketplace-skills';

vi.mock('sonner', async () => {
  const { mockToast } = await import('@/test/mocks');
  return mockToast;
});

describe('useMarketplaceSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('installSkill', () => {
    it('should resolve without backend tracking', async () => {
      const { result } = renderHook(() => useMarketplaceSkills());

      const slug = 'test-skill-slug';
      const version = '1.0.0';

      await expect(result.current.installSkill(slug, version)).resolves.toBeUndefined();
    });

    it('should resolve even when version is empty', async () => {
      const { result } = renderHook(() => useMarketplaceSkills());

      await expect(result.current.installSkill('test-skill-slug', '')).resolves.toBeUndefined();
    });
  });
});
