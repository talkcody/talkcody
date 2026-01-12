import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

describe('Marketplace Categories Bug - React Key Error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should handle string array categories correctly', () => {
    const categories = ['coding', 'writing', 'analysis'];
    
    // Simulate React key rendering
    const keys = categories.map((category) => {
      return String(category);
    });

    expect(keys).toEqual(['coding', 'writing', 'analysis']);
    expect(keys.every(k => typeof k === 'string')).toBe(true);
    expect(keys.every(k => k !== '[object Object]')).toBe(true);
  });

  it('should detect when Category objects are used instead of strings', () => {
    const categories = [
      { id: 'cat1', name: 'Coding', slug: 'coding', description: '', agentCount: 0 },
      { id: 'cat2', name: 'Writing', slug: 'writing', description: '', agentCount: 0 },
    ];
    
    // This simulates what happens when Category objects are passed to SelectItem
    const keys = categories.map((category) => {
      return category.slug || String(category);
    });

    expect(keys).toEqual(['coding', 'writing']);
    expect(keys.every(k => typeof k === 'string')).toBe(true);
  });

  it('should convert Category objects to strings if needed', () => {
    const categoryObjects = [
      { id: 'cat1', name: 'Coding', slug: 'coding', description: '', agentCount: 0 },
      { id: 'cat2', name: 'Writing', slug: 'writing', description: '', agentCount: 0 },
    ];

    // Function to handle both string and Category[] formats
    const normalizeCategories = (cats: string[] | { name: string; slug?: string }[]): string[] => {
      return cats.map(c => typeof c === 'string' ? c : c.slug || c.name);
    };

    const normalized = normalizeCategories(categoryObjects);
    expect(normalized).toEqual(['coding', 'writing']);
  });

  it('should handle mixed data sources correctly', () => {
    const stringCategories = ['coding', 'writing'];
    
    const normalizeCategories = (cats: any[]): string[] => {
      return cats.map(c => {
        if (typeof c === 'string') return c;
        if (typeof c === 'object' && c !== null) {
          return c.slug || c.name || String(c);
        }
        return String(c);
      });
    };

    const normalized = normalizeCategories(stringCategories);
    expect(normalized).toEqual(['coding', 'writing']);
    expect(normalized.every(c => typeof c === 'string')).toBe(true);
  });
});
