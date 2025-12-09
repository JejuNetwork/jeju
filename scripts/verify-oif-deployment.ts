#!/usr/bin/env bun
/**
 * OIF Deployment Verification Script
 * 
 * Verifies that OIF contracts are properly deployed and configured.
 * 
 * Usage:
 *   bun run scripts/verify-oif-deployment.ts [network]
 */

import { createPublicClient, http, type Address } from 'viem';
import { mainnet, sepolia, arbitrum, optimism } from 'viem/chains';
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const CONTRACTS_DIR = path.join(import.meta.dirname, '../packages/contracts');
const DEPLOYMENTS_DIR = path.join(CONTRACTS_DIR, 'deployments');

// ABIs for verification
const SOLVER_REGISTRY_ABI = [
  { type: 'function', name: 'minStake', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'getStats', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], stateMutability: 'view' },
] as const;

const INPUT_SETTLER_ABI = [
  { type: 'function', name: 'chainId', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
  { type: 'function', name: 'paused', inputs: [], outputs: [{ type: 'bool' }], stateMutability: 'view' },
] as const;

const OUTPUT_SETTLER_ABI = [
  { type: 'function', name: 'chainId', inputs: [], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
}

const CHAINS: Record<number, ChainConfig> = {
  1: { chainId: 1, name: 'Ethereum', rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com' },
  11155111: { chainId: 11155111, name: 'Sepolia', rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com' },
  42161: { chainId: 42161, name: 'Arbitrum', rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc' },
  10: { chainId: 10, name: 'Optimism', rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io' },
  420690: { chainId: 420690, name: 'Jeju Testnet', rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network' },
  420691: { chainId: 420691, name: 'Jeju Mainnet', rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network' },
  1337: { chainId: 1337, name: 'Anvil', rpcUrl: 'http://localhost:8545' },
};

async function verifyContract(
  rpcUrl: string,
  address: string,
  abi: readonly object[],
  functionName: string
): Promise<{ exists: boolean; error?: string }> {
  if (!address || address === '0x0000000000000000000000000000000000000000') {
    return { exists: false, error: 'Not deployed (zero address)' };
  }

  const client = createPublicClient({
    transport: http(rpcUrl),
  });

  const code = await client.getCode({ address: address as Address });
  if (!code || code === '0x') {
    return { exists: false, error: 'No code at address' };
  }

  return { exists: true };
}

async function verifyChainDeployment(chainId: number, contracts: {
  solverRegistry?: string;
  inputSettler?: string;
  outputSettler?: string;
  oracle?: string;
}): Promise<{
  chainId: number;
  name: string;
  status: 'ok' | 'partial' | 'failed';
  contracts: Record<string, { address: string; status: string }>;
}> {
  const chain = CHAINS[chainId];
  if (!chain) {
    return {
      chainId,
      name: `Unknown Chain ${chainId}`,
      status: 'failed',
      contracts: {},
    };
  }

  const results: Record<string, { address: string; status: string }> = {};
  let allOk = true;
  let anyOk = false;

  // Verify SolverRegistry
  if (contracts.solverRegistry) {
    const result = await verifyContract(chain.rpcUrl, contracts.solverRegistry, SOLVER_REGISTRY_ABI, 'minStake');
    results.solverRegistry = {
      address: contracts.solverRegistry,
      status: result.exists ? '✅' : `❌ ${result.error}`,
    };
    if (result.exists) anyOk = true; else allOk = false;
  }

  // Verify InputSettler
  if (contracts.inputSettler) {
    const result = await verifyContract(chain.rpcUrl, contracts.inputSettler, INPUT_SETTLER_ABI, 'chainId');
    results.inputSettler = {
      address: contracts.inputSettler,
      status: result.exists ? '✅' : `❌ ${result.error}`,
    };
    if (result.exists) anyOk = true; else allOk = false;
  }

  // Verify OutputSettler
  if (contracts.outputSettler) {
    const result = await verifyContract(chain.rpcUrl, contracts.outputSettler, OUTPUT_SETTLER_ABI, 'chainId');
    results.outputSettler = {
      address: contracts.outputSettler,
      status: result.exists ? '✅' : `❌ ${result.error}`,
    };
    if (result.exists) anyOk = true; else allOk = false;
  }

  // Verify Oracle
  if (contracts.oracle) {
    const result = await verifyContract(chain.rpcUrl, contracts.oracle, [], '');
    results.oracle = {
      address: contracts.oracle,
      status: result.exists ? '✅' : `❌ ${result.error}`,
    };
    if (result.exists) anyOk = true; else allOk = false;
  }

  return {
    chainId,
    name: chain.name,
    status: allOk ? 'ok' : anyOk ? 'partial' : 'failed',
    contracts: results,
  };
}

async function main() {
  const network = process.argv[2] || 'testnet';

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              OIF DEPLOYMENT VERIFICATION                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`Network: ${network}`);
  console.log('');

  // Load deployment file
  const deploymentFile = path.join(DEPLOYMENTS_DIR, `oif-${network}.json`);
  if (!existsSync(deploymentFile)) {
    console.log(`❌ No deployment file found: ${deploymentFile}`);
    console.log(`   Run: bun run scripts/deploy-oif.ts ${network}`);
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
  console.log(`Deployment file: ${deploymentFile}`);
  console.log(`Status: ${deployment.status}`);
  console.log(`Timestamp: ${deployment.timestamp || 'N/A'}`);
  console.log('');

  // Verify each chain
  const chains = deployment.chains || {};
  const chainIds = Object.keys(chains).map(Number);

  if (chainIds.length === 0) {
    console.log('❌ No chains configured in deployment file');
    process.exit(1);
  }

  let allOk = true;
  for (const chainId of chainIds) {
    const chainData = chains[chainId.toString()];
    const contracts = chainData?.contracts || {};

    console.log(`--- ${CHAINS[chainId]?.name || `Chain ${chainId}`} ---`);

    const result = await verifyChainDeployment(chainId, contracts);

    for (const [name, data] of Object.entries(result.contracts)) {
      console.log(`  ${name}: ${data.address.slice(0, 10)}... ${data.status}`);
    }

    if (result.status !== 'ok') {
      allOk = false;
    }
    console.log('');
  }

  // Also check env variables
  console.log('--- Environment Variables ---');
  for (const chainId of chainIds) {
    const inputSettler = process.env[`OIF_INPUT_SETTLER_${chainId}`];
    const outputSettler = process.env[`OIF_OUTPUT_SETTLER_${chainId}`];
    const registry = process.env[`OIF_SOLVER_REGISTRY_${chainId}`];

    const hasAll = inputSettler && outputSettler;
    console.log(`  Chain ${chainId}: ${hasAll ? '✅ Configured' : '❌ Missing env vars'}`);
    if (!hasAll) {
      if (!inputSettler) console.log(`    - OIF_INPUT_SETTLER_${chainId} not set`);
      if (!outputSettler) console.log(`    - OIF_OUTPUT_SETTLER_${chainId} not set`);
    }
  }

  console.log('');
  console.log(allOk ? '✅ All contracts verified' : '⚠️ Some contracts missing or failed');

  process.exit(allOk ? 0 : 1);
}

main().catch(console.error);



