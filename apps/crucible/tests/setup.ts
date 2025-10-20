/**
 * Test Setup
 * 
 * Runs before all tests to set up environment
 */

import { config } from 'dotenv';
import path from 'path';

// Load environment variables from .env
config({ path: path.join(process.cwd(), '.env') });

// Ensure required env vars are set for tests
const requiredEnvVars = [
  'JEJU_L2_RPC',
  'IDENTITY_REGISTRY',
  'REPUTATION_REGISTRY',
  'GUARDIAN_ADDRESS_LOCALNET',
  'HACKER_WALLET_1',
  'CITIZEN_WALLET_1',
  'GUARDIAN_WALLET_1'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.warn(`⚠️  Warning: ${envVar} not set in environment`);
  }
}

// Set defaults for testing
process.env.NETWORK = process.env.NETWORK || 'localnet';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error'; // Quiet during tests

console.log('🧪 Test environment configured');
console.log(`   Network: ${process.env.NETWORK}`);
console.log(`   RPC: ${process.env.JEJU_L2_RPC}`);

