#!/usr/bin/env bun
// Test runner that sets DATABASE_URL to DATABASE_URL_TEST
// This ensures the API uses the test database during tests

// Get the test database URL and auth token
const testDatabaseUrl =
  Bun.env.TURSO_DATABASE_URL_TEST ||
  process.env.TURSO_DATABASE_URL_TEST ||
  Bun.env.DATABASE_URL_TEST ||
  process.env.DATABASE_URL_TEST;
const testAuthToken =
  Bun.env.TURSO_AUTH_TOKEN_TEST ||
  process.env.TURSO_AUTH_TOKEN_TEST ||
  Bun.env.AUTH_TOKEN_TEST ||
  process.env.AUTH_TOKEN_TEST;
const productionDatabaseUrl =
  Bun.env.TURSO_DATABASE_URL ||
  process.env.TURSO_DATABASE_URL ||
  Bun.env.DATABASE_URL ||
  process.env.DATABASE_URL;

if (!testDatabaseUrl) {
  console.error('❌ ERROR: TURSO_DATABASE_URL_TEST environment variable is required');
  console.error('Please set TURSO_DATABASE_URL_TEST in your .env file');
  process.exit(1);
}

if (!testAuthToken) {
  console.error('❌ ERROR: TURSO_AUTH_TOKEN_TEST environment variable is required');
  console.error('Please set TURSO_AUTH_TOKEN_TEST in your .env file');
  process.exit(1);
}

// SAFETY CHECK 1: Verify test and production URLs are different
if (productionDatabaseUrl && testDatabaseUrl === productionDatabaseUrl) {
  console.error('❌ SAFETY CHECK FAILED: Production and test database URLs are identical!');
  console.error('Production and test databases must be different.');
  console.error('Please check your .env file configuration.');
  process.exit(1);
}

// SAFETY CHECK 2: Verify test database URL contains 'test' keyword
const testDbName = testDatabaseUrl.split('/').pop()?.split('?')[0] || '';
const testHostname = testDatabaseUrl.split('@')[1]?.split('/')[0] || '';

if (!testDbName.toLowerCase().includes('test') && !testHostname.toLowerCase().includes('test')) {
  console.warn('⚠️  WARNING: Test database URL does not contain "test" keyword');
  console.warn(`Database: ${testDbName}`);
  console.warn(`Hostname: ${testHostname}`);
  console.warn('Consider renaming your test database to include "test" for safety');
}

// Override TURSO_DATABASE_URL with TURSO_DATABASE_URL_TEST for this test run
Bun.env.TURSO_DATABASE_URL = testDatabaseUrl;
process.env.TURSO_DATABASE_URL = testDatabaseUrl;
Bun.env.TURSO_AUTH_TOKEN = testAuthToken;
process.env.TURSO_AUTH_TOKEN = testAuthToken;

// Also set legacy DATABASE_URL for backward compatibility
Bun.env.DATABASE_URL = testDatabaseUrl;
process.env.DATABASE_URL = testDatabaseUrl;

// Set TEST_MODE flag to indicate we're running tests
Bun.env.TEST_MODE = 'true';
process.env.TEST_MODE = 'true';

console.log('🔧 Test environment configured');
console.log(`📊 Using test database: ${testDatabaseUrl.split('@')[1]?.split('/')[1] || 'test'}`);
console.log('✅ Safety checks passed\n');

// Initialize database schema before running tests
console.log('📝 Initializing database schema...');
const initProcess = Bun.spawn(['bun', 'run', 'src/test/init-schema.ts'], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: {
    ...process.env,
    TURSO_DATABASE_URL_TEST: testDatabaseUrl,
    TURSO_AUTH_TOKEN_TEST: testAuthToken,
  },
});

const initExitCode = await initProcess.exited;
if (initExitCode !== 0) {
  console.error('❌ Failed to initialize database schema');
  process.exit(initExitCode);
}
console.log('✅ Database schema initialized\n');

// Run the tests - run all test files matching the pattern
const testProcess = Bun.spawn(
  [
    'bun',
    'test',
    'src/test/marketplace.test.ts',
    'src/test/skills-marketplace.test.ts',
    'src/test/auth-service.test.ts',
    'src/test/s3-bucket.test.ts',
  ],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    env: {
      ...process.env,
      TURSO_DATABASE_URL: testDatabaseUrl,
      TURSO_AUTH_TOKEN: testAuthToken,
      DATABASE_URL: testDatabaseUrl,
      TEST_MODE: 'true',
    },
  }
);

const exitCode = await testProcess.exited;
process.exit(exitCode);
