#!/usr/bin/env bun

/**
 * @deprecated Use 'jeju deploy zkbridge-setup --phala' instead
 * 
 * Phala TEE Setup Script
 *
 * Provisions a Phala TEE endpoint for secure attestation.
 * Uses Phala Cloud's TEE-as-a-Service API.
 *
 * Requirements:
 * - Wallet with some PHA tokens (for gas)
 * - Or API key from Phala dashboard
 *
 * Usage:
 *   jeju deploy zkbridge-setup --phala
 *
 * Environment variables (checked in order):
 * - PHALA_API_KEY: Direct API key
 * - DEPLOYER_PRIVATE_KEY: Wallet for signing
 * - EVM_PRIVATE_KEY: Fallback wallet
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseArgs } from 'util';
import { createWalletClient, type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// =============================================================================
// CONFIGURATION
// =============================================================================

const PHALA_CLOUD_API = 'https://cloud.phala.network/api/v1';
const _PHALA_ATTESTATION_API = 'https://attestation.phala.network/api/v1';

interface PhalaConfig {
  apiKey?: string;
  walletPrivateKey?: Hex;
  network: 'mainnet' | 'testnet' | 'local';
}

interface TEEInstance {
  instanceId: string;
  endpoint: string;
  publicKey: string;
  enclaveId: string;
  status: 'pending' | 'running' | 'stopped';
}

// =============================================================================
// ENV LOADING
// =============================================================================

function loadEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};

  const content = readFileSync(path, 'utf-8');
  const env: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex);
    let value = trimmed.slice(eqIndex + 1);

    // Remove quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function findConfig(): PhalaConfig {
  // Check multiple .env locations
  const envPaths = [
    join(process.cwd(), '.env'),
    join(process.cwd(), '..', '..', '.env'), // babylon root
    join(process.cwd(), '..', '..', '.env.local'), // babylon .env.local
    join(process.cwd(), '..', '..', '..', '.env'), // jeju root
    join(process.cwd(), '..', '..', '..', '.env.local'), // jeju .env.local
  ];

  let apiKey: string | undefined;
  let walletKey: Hex | undefined;

  for (const envPath of envPaths) {
    const env = loadEnvFile(envPath);

    // Check for API key
    if (!apiKey && env.PHALA_API_KEY) {
      apiKey = env.PHALA_API_KEY;
      console.log(`Found PHALA_API_KEY in ${envPath}`);
    }

    // Check for wallet
    if (!walletKey) {
      const key =
        env.DEPLOYER_PRIVATE_KEY ||
        env.EVM_PRIVATE_KEY ||
        env.AGENT0_PRIVATE_KEY;
      if (key && key.startsWith('0x') && key.length === 66) {
        walletKey = key as Hex;
        console.log(`Found wallet key in ${envPath}`);
      }
    }
  }

  // Also check process.env
  apiKey = apiKey || process.env.PHALA_API_KEY;
  if (!walletKey) {
    const envKey =
      process.env.DEPLOYER_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
    if (envKey && envKey.startsWith('0x') && envKey.length === 66) {
      walletKey = envKey as Hex;
    }
  }

  return {
    apiKey,
    walletPrivateKey: walletKey,
    network: (process.env.PHALA_NETWORK || 'testnet') as
      | 'mainnet'
      | 'testnet'
      | 'local',
  };
}

// =============================================================================
// PHALA API CLIENT
// =============================================================================

class PhalaCloudClient {
  private config: PhalaConfig;
  private authToken: string | null = null;

  constructor(config: PhalaConfig) {
    this.config = config;
  }

  async authenticate(): Promise<void> {
    if (this.config.apiKey) {
      this.authToken = this.config.apiKey;
      console.log('✅ Authenticated with API key');
      return;
    }

    if (this.config.walletPrivateKey) {
      // Authenticate via wallet signature
      const account = privateKeyToAccount(this.config.walletPrivateKey);
      const message = `Phala TEE Authentication\nTimestamp: ${Date.now()}`;

      const walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: http(),
      });

      const signature = await walletClient.signMessage({ message });

      const response = await fetch(`${PHALA_CLOUD_API}/auth/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: account.address,
          message,
          signature,
        }),
      });

      if (!response.ok) {
        throw new Error(`Wallet auth failed: ${response.status}`);
      }

      const data = (await response.json()) as { token: string };
      this.authToken = data.token;
      console.log(`✅ Authenticated with wallet ${account.address}`);
      return;
    }

    throw new Error(
      'No authentication method available. Set PHALA_API_KEY or DEPLOYER_PRIVATE_KEY'
    );
  }

  async createTEEInstance(): Promise<TEEInstance> {
    if (!this.authToken) {
      await this.authenticate();
    }

    console.log('📦 Creating TEE instance...');

    // For testnet/local, use a simulated endpoint
    if (this.config.network === 'local') {
      return {
        instanceId: `local-${Date.now()}`,
        endpoint: 'http://localhost:8090',
        publicKey: '0x' + '00'.repeat(33),
        enclaveId: 'local-enclave',
        status: 'running',
      };
    }

    const response = await fetch(`${PHALA_CLOUD_API}/tee/instances`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.authToken}`,
      },
      body: JSON.stringify({
        name: 'evmsol-bridge-tee',
        type: 'attestation',
        config: {
          enableAttestation: true,
          enableBatching: true,
          maxBatchSize: 100,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Failed to create TEE instance: ${response.status} - ${error}`
      );
    }

    const instance = (await response.json()) as TEEInstance;
    console.log(`✅ Created TEE instance: ${instance.instanceId}`);

    return instance;
  }

  async waitForReady(
    instanceId: string,
    timeoutMs: number = 60000
  ): Promise<TEEInstance> {
    console.log('⏳ Waiting for TEE instance to be ready...');
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(
        `${PHALA_CLOUD_API}/tee/instances/${instanceId}`,
        {
          headers: {
            Authorization: `Bearer ${this.authToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to check instance status: ${response.status}`);
      }

      const instance = (await response.json()) as TEEInstance;

      if (instance.status === 'running') {
        console.log(`✅ TEE instance ready at ${instance.endpoint}`);
        return instance;
      }

      await Bun.sleep(2000);
    }

    throw new Error('Timeout waiting for TEE instance');
  }

  async getAttestation(endpoint: string): Promise<{
    quote: string;
    mrEnclave: string;
    signature: string;
  }> {
    console.log('🔐 Requesting attestation...');

    const response = await fetch(`${endpoint}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: '0x' + '00'.repeat(32) }),
    });

    if (!response.ok) {
      throw new Error(`Attestation request failed: ${response.status}`);
    }

    return (await response.json()) as {
      quote: string;
      mrEnclave: string;
      signature: string;
    };
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'test-only': { type: 'boolean', default: false },
      'save-env': { type: 'boolean', default: true },
      network: { type: 'string', default: 'testnet' },
    },
  });

  console.log('\n🔷 Phala TEE Setup\n');
  console.log('─'.repeat(60));

  // Load configuration
  const config = findConfig();
  config.network =
    (values.network as 'mainnet' | 'testnet' | 'local') || config.network;

  console.log(`Network: ${config.network}`);
  console.log(`Has API key: ${Boolean(config.apiKey)}`);
  console.log(`Has wallet: ${Boolean(config.walletPrivateKey)}`);
  console.log('─'.repeat(60));

  if (!config.apiKey && !config.walletPrivateKey) {
    console.log('\n⚠️  No authentication configured.');
    console.log('\nTo use Phala TEE, either:');
    console.log('  1. Get an API key from https://cloud.phala.network');
    console.log('  2. Set DEPLOYER_PRIVATE_KEY in .env');
    console.log('\nFor now, using local mock mode...\n');

    config.network = 'local';
  }

  const client = new PhalaCloudClient(config);

  // Test authentication
  if (config.network !== 'local') {
    await client.authenticate();
  }

  // Create or get TEE instance
  let instance: TEEInstance;

  if (values['test-only']) {
    // Just test existing endpoint
    const endpoint = process.env.PHALA_ENDPOINT;
    if (!endpoint) {
      console.log(
        'No PHALA_ENDPOINT set. Run without --test-only to create one.'
      );
      return;
    }

    console.log(`Testing existing endpoint: ${endpoint}`);
    const attestation = await client.getAttestation(endpoint);
    console.log('✅ Attestation received:');
    console.log(`   mrEnclave: ${attestation.mrEnclave.slice(0, 20)}...`);
    return;
  }

  if (config.network === 'local') {
    // Local mock instance
    instance = {
      instanceId: 'local-mock',
      endpoint: 'http://localhost:8090',
      publicKey: '0x' + '02' + '00'.repeat(32),
      enclaveId: 'local-mock-enclave',
      status: 'running',
    };
    console.log('\n📋 Using local mock TEE instance');
  } else {
    // Create real instance
    instance = await client.createTEEInstance();

    // Wait for it to be ready
    if (instance.status !== 'running') {
      instance = await client.waitForReady(instance.instanceId);
    }

    // Verify with attestation
    const attestation = await client.getAttestation(instance.endpoint);
    console.log('\n🔐 Verified TEE attestation:');
    console.log(`   mrEnclave: ${attestation.mrEnclave.slice(0, 20)}...`);
  }

  // Save to .env if requested
  if (values['save-env']) {
    const envPath = join(process.cwd(), '..', '..', '.env');

    const envEntry = `\n# Phala TEE (auto-generated)\nPHALA_ENDPOINT=${instance.endpoint}\nPHALA_INSTANCE_ID=${instance.instanceId}\n`;

    if (existsSync(envPath)) {
      const content = readFileSync(envPath, 'utf-8');
      if (!content.includes('PHALA_ENDPOINT')) {
        appendFileSync(envPath, envEntry);
        console.log(`\n✅ Added PHALA_ENDPOINT to ${envPath}`);
      } else {
        console.log(
          `\n⚠️  PHALA_ENDPOINT already in ${envPath}, not overwriting`
        );
      }
    } else {
      writeFileSync(envPath, envEntry);
      console.log(`\n✅ Created ${envPath} with PHALA_ENDPOINT`);
    }
  }

  console.log('\n─'.repeat(60));
  console.log('📋 TEE Configuration:');
  console.log(`   Instance ID: ${instance.instanceId}`);
  console.log(`   Endpoint:    ${instance.endpoint}`);
  console.log(`   Enclave ID:  ${instance.enclaveId}`);
  console.log(`   Status:      ${instance.status}`);
  console.log('─'.repeat(60));

  console.log('\n✅ Phala TEE setup complete!\n');
  console.log('To use in your code:');
  console.log(
    '  import { createPhalaClient } from "@babylon/experimental-evmsol"'
  );
  console.log('  const client = createPhalaClient();');
  console.log('  await client.initialize();');
  console.log('');
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
