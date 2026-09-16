import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { testDbConnection } from '../server/db';

async function run() {
  console.log('=== Neon PostgreSQL Connection Test ===');
  const dbUrl = process.env.DATABASE_URL?.trim();
  if (!dbUrl) {
    console.log('[Status] DATABASE_URL environment variable is not set in this shell.');
    console.log('Configure DATABASE_URL in your environment or .env file:');
    console.log('Configure DATABASE_URL securely in the server environment (do not paste the secret into source code).');
    return;
  }

  const masked = dbUrl.replace(/:([^:@]+)@/, ':****@');
  console.log(`Testing target: ${masked}`);

  const result = await testDbConnection();
  if (result.ok) {
    console.log('✓ Neon PostgreSQL connection successful!');
    console.log(`  Query: SELECT 1`);
    console.log(`  Latency: ${result.latencyMs}ms`);
    console.log(`  Version: ${result.serverVersion || 'PostgreSQL'}`);
    console.log(`  Server time: ${result.timestamp}`);
  } else {
    console.error('✗ Connection test failed:');
    console.error(`  ${result.error || result.message}`);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unexpected test error:', err);
  process.exit(1);
});
