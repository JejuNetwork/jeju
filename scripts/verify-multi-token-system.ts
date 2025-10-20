#!/usr/bin/env bun
/**
 * Verify Multi-Token System
 * 
 * Checks all paymasters are operational for all tokens
 * 
 * Usage:
 *   bun run scripts/verify-multi-token-system.ts
 */

import { createPublicClient, http } from 'viem';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getAllProtocolTokens } from './shared/protocol-tokens';

const PAYMASTER_ABI = [
  {
    type: 'function',
    name: 'isOperational',
    inputs: [],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'getStatus',
    inputs: [],
    outputs: [
      { name: 'entryPointBalance', type: 'uint256' },
      { name: 'vaultLiquidity', type: 'uint256' },
      { name: 'oracleFresh', type: 'bool' },
      { name: 'operational', type: 'bool' }
    ],
    stateMutability: 'view'
  }
] as const;

class MultiTokenVerifier {
  private client;
  private deployments: Record<string, any>;

  constructor() {
    const rpcUrl = process.env.JEJU_RPC_URL || 'http://localhost:9545';
    
    this.client = createPublicClient({
      transport: http(rpcUrl)
    });

    // Load deployments
    const deploymentPath = join(process.cwd(), 'contracts', 'deployments', 'localnet', 'multi-token-system.json');
    this.deployments = JSON.parse(readFileSync(deploymentPath, 'utf-8'));
  }

  async verify() {
    console.log('🔍 VERIFYING MULTI-TOKEN SYSTEM');
    console.log('='.repeat(70));
    console.log('');

    const tokens = getAllProtocolTokens();
    let allOperational = true;

    for (const token of tokens) {
      console.log(`📊 ${token.symbol} Paymaster`);
      console.log('-'.repeat(70));

      const paymasterKey = `${token.symbol.toLowerCase()}_paymaster`;
      const paymasterAddress = this.deployments[paymasterKey] as `0x${string}`;

      if (!paymasterAddress) {
        console.log('  ❌ Not deployed');
        allOperational = false;
        continue;
      }

      const isOperational = await this.client.readContract({
        address: paymasterAddress,
        abi: PAYMASTER_ABI,
        functionName: 'isOperational',
      });

      const status = await this.client.readContract({
        address: paymasterAddress,
        abi: PAYMASTER_ABI,
        functionName: 'getStatus',
      });

      console.log(`  Address: ${paymasterAddress}`);
      console.log(`  Operational: ${isOperational ? '✅' : '❌'}`);
      console.log(`  EntryPoint Balance: ${Number(status[0]) / 1e18} ETH`);
      console.log(`  Vault Liquidity: ${Number(status[1]) / 1e18} ETH`);
      console.log(`  Oracle Fresh: ${status[2] ? '✅' : '❌'}`);
      console.log('');

      if (!isOperational) allOperational = false;
    }

    console.log('='.repeat(70));
    if (allOperational) {
      console.log('✅ ALL PAYMASTERS OPERATIONAL');
    } else {
      console.log('❌ SOME PAYMASTERS NOT OPERATIONAL');
    }
    console.log('='.repeat(70));

    return allOperational;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const verifier = new MultiTokenVerifier();
  verifier.verify().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
}

export { MultiTokenVerifier };

