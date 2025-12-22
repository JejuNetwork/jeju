#!/usr/bin/env bun
/**
 * Factory CDN Deployment Script
 * 
 * Deploys the Factory frontend to the decentralized CDN via DWS.
 * This ensures 100% decentralized hosting via IPFS + JNS.
 * 
 * Usage:
 *   bun run scripts/deploy-cdn.ts
 *   bun run scripts/deploy-cdn.ts --domain factory.jeju --jns factory.jeju
 */

import { parseArgs } from 'util';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================================================
// Configuration
// ============================================================================

const DWS_URL = process.env.DWS_URL || 'http://localhost:4030';
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'http://localhost:9545';

interface DeployConfig {
  domain: string;
  jnsName: string;
  buildDir: string;
  warmup: boolean;
  invalidate: boolean;
}

// ============================================================================
// Deploy Functions
// ============================================================================

async function build(): Promise<void> {
  console.log('[Factory Deploy] Building Next.js app...');
  
  // Build with static export for IPFS hosting
  execSync('bun run build', { 
    stdio: 'inherit',
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: '1',
    }
  });
  
  console.log('[Factory Deploy] Build complete');
}

async function deployToCDN(config: DeployConfig): Promise<{
  siteId: string;
  cdnUrl: string;
  contentHash: string;
}> {
  console.log(`[Factory Deploy] Deploying to CDN: ${config.domain}`);
  
  if (!PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required');
  }

  // Generate auth headers
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const timestamp = Date.now().toString();
  const nonce = Math.random().toString(36).slice(2);
  
  const signature = await account.signMessage({
    message: `DWS Auth\nTimestamp: ${timestamp}\nNonce: ${nonce}`,
  });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-jeju-address': account.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-nonce': nonce,
    'x-jeju-signature': signature,
  };

  // Deploy via DWS CDN API
  const response = await fetch(`${DWS_URL}/cdn/deploy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      domain: config.domain,
      buildDir: config.buildDir,
      jnsName: config.jnsName,
      framework: 'next',
      warmup: config.warmup,
      invalidate: config.invalidate,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`CDN deployment failed: ${error}`);
  }

  return response.json();
}

async function updateJNS(jnsName: string, contentHash: string): Promise<void> {
  console.log(`[Factory Deploy] Updating JNS: ${jnsName} -> ${contentHash}`);
  
  if (!PRIVATE_KEY) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required');
  }

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  
  // Define chain for viem clients
  const chain = {
    id: 31337,
    name: 'jeju-localnet',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [RPC_URL] },
    },
  } as const;
  
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });

  // JNS Registry ABI (minimal)
  const JNS_REGISTRY_ABI = [
    {
      name: 'setContentHash',
      type: 'function',
      inputs: [
        { name: 'name', type: 'string' },
        { name: 'contentHash', type: 'bytes32' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const;

  const jnsRegistryAddress = process.env.JNS_REGISTRY_ADDRESS as Address;
  if (!jnsRegistryAddress) {
    console.warn('[Factory Deploy] JNS_REGISTRY_ADDRESS not set, skipping JNS update');
    return;
  }

  // Convert IPFS CID to bytes32 (simplified - real implementation would use proper encoding)
  const contentHashBytes = `0x${Buffer.from(contentHash).toString('hex').padEnd(64, '0')}` as `0x${string}`;

  const hash = await walletClient.writeContract({
    address: jnsRegistryAddress,
    abi: JNS_REGISTRY_ABI,
    functionName: 'setContentHash',
    args: [jnsName, contentHashBytes],
    chain,
  });

  console.log(`[Factory Deploy] JNS update tx: ${hash}`);
  
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[Factory Deploy] JNS updated: ${jnsName}.jeju`);
}

async function verifyDeployment(cdnUrl: string): Promise<boolean> {
  console.log(`[Factory Deploy] Verifying deployment at ${cdnUrl}...`);
  
  // Wait a bit for CDN propagation
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const response = await fetch(cdnUrl);
  if (!response.ok) {
    console.error('[Factory Deploy] Verification failed: site not accessible');
    return false;
  }

  const html = await response.text();
  if (!html.includes('Factory')) {
    console.error('[Factory Deploy] Verification failed: unexpected content');
    return false;
  }

  console.log('[Factory Deploy] Verification successful!');
  return true;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      domain: { type: 'string', default: 'factory.jejunetwork.org' },
      jns: { type: 'string', default: 'factory.jeju' },
      'skip-build': { type: 'boolean', default: false },
      'skip-warmup': { type: 'boolean', default: false },
      'skip-jns': { type: 'boolean', default: false },
      'skip-verify': { type: 'boolean', default: false },
    },
  });

  const config: DeployConfig = {
    domain: values.domain as string,
    jnsName: values.jns as string,
    buildDir: join(process.cwd(), 'out'), // Next.js static export dir
    warmup: !values['skip-warmup'],
    invalidate: true,
  };

  console.log('╔════════════════════════════════════════════════╗');
  console.log('║        Factory CDN Deployment (100% Dex)       ║');
  console.log('╠════════════════════════════════════════════════╣');
  console.log(`║ Domain:    ${config.domain.padEnd(35)}║`);
  console.log(`║ JNS:       ${config.jnsName.padEnd(35)}║`);
  console.log(`║ DWS:       ${DWS_URL.padEnd(35)}║`);
  console.log('╚════════════════════════════════════════════════╝');

  // Step 1: Build
  if (!values['skip-build']) {
    await build();
  }

  // Verify build output exists
  if (!existsSync(config.buildDir)) {
    // Fallback to .next for non-static export
    config.buildDir = join(process.cwd(), '.next');
    if (!existsSync(config.buildDir)) {
      throw new Error('Build output not found. Run build first.');
    }
  }

  // Step 2: Deploy to CDN
  const deployment = await deployToCDN(config);
  console.log(`[Factory Deploy] Deployed!`);
  console.log(`  Site ID:      ${deployment.siteId}`);
  console.log(`  CDN URL:      ${deployment.cdnUrl}`);
  console.log(`  Content Hash: ${deployment.contentHash}`);

  // Step 3: Update JNS
  if (!values['skip-jns'] && deployment.contentHash) {
    await updateJNS(config.jnsName, deployment.contentHash);
  }

  // Step 4: Verify
  if (!values['skip-verify']) {
    const verified = await verifyDeployment(deployment.cdnUrl);
    if (!verified) {
      process.exit(1);
    }
  }

  console.log('\n✅ Factory deployed successfully!');
  console.log(`\n   Access via:`);
  console.log(`   • CDN:     ${deployment.cdnUrl}`);
  console.log(`   • JNS:     https://${config.jnsName}.eth`);
  console.log(`   • Gateway: https://factory.jejunetwork.org`);
}

main().catch((err) => {
  console.error('[Factory Deploy] Error:', err);
  process.exit(1);
});

