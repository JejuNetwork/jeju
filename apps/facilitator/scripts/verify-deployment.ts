#!/usr/bin/env bun
/**
 * Deployment Verification Script
 * Verifies that the facilitator contract is deployed and functioning correctly
 * 
 * Usage:
 *   bun run scripts/verify-deployment.ts [--network jeju-testnet] [--address 0x...]
 */

import { createPublicClient, http, type Address } from 'viem';
import { CHAIN_CONFIGS } from '../src/lib/chains';
import { X402_FACILITATOR_ABI } from '../src/lib/contracts';

const network = process.argv.find(arg => arg.startsWith('--network='))?.split('=')[1] || 'jeju-testnet';
const address = process.argv.find(arg => arg.startsWith('--address='))?.split('=')[1] as Address | undefined;

async function verifyDeployment() {
  const chainConfig = CHAIN_CONFIGS[network];
  if (!chainConfig) {
    console.error(`❌ Unknown network: ${network}`);
    console.error(`Available networks: ${Object.keys(CHAIN_CONFIGS).join(', ')}`);
    process.exit(1);
  }

  const facilitatorAddress = address || chainConfig.facilitatorAddress;
  if (!facilitatorAddress || facilitatorAddress === '0x0000000000000000000000000000000000000000') {
    console.error(`❌ Facilitator address not configured for ${network}`);
    console.error(`Set --address=0x... or configure in CHAIN_CONFIGS`);
    process.exit(1);
  }

  console.log(`\n🔍 Verifying facilitator deployment on ${network}`);
  console.log(`   Address: ${facilitatorAddress}`);
  console.log(`   RPC: ${chainConfig.rpcUrl}\n`);

  const publicClient = createPublicClient({
    transport: http(chainConfig.rpcUrl),
  });

  try {
    // Check if contract exists
    const code = await publicClient.getBytecode({ address: facilitatorAddress });
    if (!code || code === '0x') {
      console.error(`❌ No contract code found at ${facilitatorAddress}`);
      process.exit(1);
    }
    console.log(`✅ Contract code found`);

    // Check stats
    const stats = await publicClient.readContract({
      address: facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'getStats',
    });
    console.log(`✅ Contract readable`);
    console.log(`   Total settlements: ${stats[0]}`);
    console.log(`   Total volume: ${stats[1]}`);
    console.log(`   Protocol fee: ${stats[2]} bps`);
    console.log(`   Fee recipient: ${stats[3]}`);

    // Check protocol fee
    const feeBps = await publicClient.readContract({
      address: facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'protocolFeeBps',
    });
    console.log(`✅ Protocol fee configured: ${feeBps} bps`);

    // Check fee recipient
    const feeRecipient = await publicClient.readContract({
      address: facilitatorAddress,
      abi: X402_FACILITATOR_ABI,
      functionName: 'feeRecipient',
    });
    console.log(`✅ Fee recipient: ${feeRecipient}`);

    // Check chain ID matches
    const chainId = await publicClient.getChainId();
    if (chainId !== chainConfig.chainId) {
      console.warn(`⚠️  Chain ID mismatch: expected ${chainConfig.chainId}, got ${chainId}`);
    } else {
      console.log(`✅ Chain ID matches: ${chainId}`);
    }

    console.log(`\n✅ Deployment verification complete!\n`);
  } catch (error) {
    console.error(`❌ Verification failed:`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

verifyDeployment().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
