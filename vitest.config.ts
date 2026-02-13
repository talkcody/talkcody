import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@talkcody/shared': path.resolve(__dirname, './packages/shared/src'),
      // Bypass monaco-editor ESM resolution issues in tests
      'monaco-editor': path.resolve(__dirname, './src/test/mocks/monaco-editor.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    reporters: ['verbose'],
    silent: false,
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 10000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      'build',
      '.bun',
      '~/.bun',
      '**/node_modules/**',
      '**/.bun/**',
      '**/~/.bun/**',
      'apps/**/node_modules/**',
      'packages/**/node_modules/**',
      '**/e2e/**', // Playwright e2e tests should be run separately
      // Database tests that require bun:sqlite - run with `bun test:db` instead
      'src/test/infrastructure/infrastructure-adapters.test.ts',
      'src/test/infrastructure/infrastructure-ipc.test.ts',
      'src/services/database/**/*.real-db.test.ts',
      'src/services/database/task-service.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/**/*.test.{ts,tsx}',
        'src/types/**',
        'src/components/ui/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
      thresholds: {
        lines: 15,
        functions: 15,
        branches: 15,
        statements: 15,
      },
      all: true,
    },
  },
});
