#!/usr/bin/env bun
/**
 * @fileoverview Deploy CrossChainPaymaster to L2 Chains
 * 
 * Deploys the EIL CrossChainPaymaster contract to supported L2 chains.
 * Prerequisites:
 * - L1StakeManager must be deployed on L1
 * - Deployer must have ETH on target L2 chain
 * 
 * Usage:
 *   bun run scripts/deploy/eil-paymaster.ts --chain 84532        # Base Sepolia
 *   bun run scripts/deploy/eil-paymaster.ts --chain 11155420     # Optimism Sepolia
 *   bun run scripts/deploy/eil-paymaster.ts --all                # All configured L2s
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getChainId, type Address, type Chain } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { waitForTransactionReceipt, getBalance, readContract } from 'viem/actions';
import { parseAbi } from 'viem';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('deploy-eil-paymaster');

const CONTRACTS_DIR = resolve(process.cwd(), 'packages/contracts');
const CONFIG_DIR = resolve(process.cwd(), 'packages/config');

// ERC-4337 EntryPoint v0.6 address (same on all chains)
const ENTRY_POINT_V06 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

interface L2ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  l1ChainId: number;
  type: 'op-stack' | 'nitro' | 'standard';
}

const L2_CHAINS: Record<string, L2ChainConfig> = {
  'base-sepolia': {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    l1ChainId: 11155111,
    type: 'op-stack',
  },
  'optimism-sepolia': {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
    l1ChainId: 11155111,
    type: 'op-stack',
  },
  'arbitrum-sepolia': {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    l1ChainId: 11155111,
    type: 'nitro',
  },
  'jeju-testnet': {
    chainId: 420690,
    name: 'Testnet',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    l1ChainId: 11155111,
    type: 'op-stack',
  },
};

function loadEILConfig(): { hub: { l1StakeManager: string; chainId: number } } | null {
  const eilPath = resolve(CONFIG_DIR, 'eil.json');
  if (!existsSync(eilPath)) return null;
  const eil = JSON.parse(readFileSync(eilPath, 'utf-8'));
  return eil.testnet || null;
}

function loadContractsConfig(): Record<string, unknown> {
  const contractsPath = resolve(CONFIG_DIR, 'contracts.json');
  return JSON.parse(readFileSync(contractsPath, 'utf-8'));
}

function saveContractsConfig(contracts: Record<string, unknown>): void {
  const contractsPath = resolve(CONFIG_DIR, 'contracts.json');
  writeFileSync(contractsPath, JSON.stringify(contracts, null, 2));
}

async function checkChainConnectivity(rpcUrl: string, expectedChainId: number): Promise<boolean> {
  const chain: Chain = { id: expectedChainId, name: 'Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const chainId = await getChainId(publicClient);
  return chainId === expectedChainId;
}

async function deployPaymaster(
  chain: L2ChainConfig,
  l1StakeManager: string,
  privateKey: string
): Promise<{ success: boolean; address?: string; txHash?: string; error?: string }> {
  logger.info(`\nDeploying CrossChainPaymaster to ${chain.name} (${chain.chainId})...`);

  // Check connectivity
  const connected = await checkChainConnectivity(chain.rpcUrl, chain.chainId);
  if (!connected) {
    return { success: false, error: `Cannot connect to ${chain.name} RPC` };
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const chainConfig: Chain = { id: chain.chainId, name: chain.name, nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [chain.rpcUrl] } } };
  const publicClient = createPublicClient({ chain: chainConfig, transport: http(chain.rpcUrl) });

  // Check balance
  const balance = await getBalance(publicClient, { address: account.address });
  if (balance < parseEther('0.01')) {
    return { 
      success: false, 
      error: `Insufficient balance on ${chain.name}: ${formatEther(balance)} ETH` 
    };
  }

  logger.info(`  Deployer: ${account.address}`);
  logger.info(`  Balance: ${formatEther(balance)} ETH`);
  logger.info(`  L1StakeManager: ${l1StakeManager}`);
  logger.info(`  EntryPoint: ${ENTRY_POINT_V06}`);

  // Deploy using forge create
  const args = [
    'create',
    'src/eil/CrossChainPaymaster.sol:CrossChainPaymaster',
    '--rpc-url', chain.rpcUrl,
    '--private-key', privateKey,
    '--broadcast',
    '--json',
    '--constructor-args', ENTRY_POINT_V06, l1StakeManager, chain.chainId.toString(),
  ];

  logger.info(`  Running forge deploy...`);

  const proc = Bun.spawn(['forge', ...args], {
    cwd: CONTRACTS_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    logger.error(`Deployment failed: ${stderr || stdout}`);
    return { success: false, error: `Forge deployment failed: ${stderr.slice(0, 200)}` };
  }

  // Parse deployment address from output
  let deployedAddress = '';
  let txHash = '';

  // Try JSON parsing
  const lines = (stdout + stderr).split('\n');
  for (const line of lines) {
    if (line.includes('deployedTo')) {
      const json = JSON.parse(line);
      deployedAddress = json.deployedTo;
      txHash = json.transactionHash || '';
      break;
    }
  }

  // Fallback to regex
  if (!deployedAddress) {
    const match = (stdout + stderr).match(/Deployed to: (0x[a-fA-F0-9]{40})/);
    if (match) deployedAddress = match[1];
    
    const txMatch = (stdout + stderr).match(/Transaction hash: (0x[a-fA-F0-9]{64})/);
    if (txMatch) txHash = txMatch[1];
  }

  if (!deployedAddress) {
    return { success: false, error: 'Could not parse deployment address' };
  }

  logger.success(`  Deployed to: ${deployedAddress}`);
  if (txHash) logger.info(`  Transaction: ${txHash}`);

  return { success: true, address: deployedAddress, txHash };
}

async function registerPaymasterOnL1(
  l1RpcUrl: string,
  l1StakeManager: string,
  l2ChainId: number,
  paymasterAddress: string,
  privateKey: string
): Promise<boolean> {
  logger.info(`\nRegistering paymaster on L1StakeManager for chain ${l2ChainId}...`);

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const l1Chain: Chain = { id: 1, name: 'L1', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [l1RpcUrl] } } };
  const publicClient = createPublicClient({ chain: l1Chain, transport: http(l1RpcUrl) });
  const walletClient = createWalletClient({ account, chain: l1Chain, transport: http(l1RpcUrl) });

  const STAKE_MANAGER_ABI = parseAbi([
    'function registerL2Paymaster(uint256 chainId, address paymaster) external',
    'function l2Paymasters(uint256 chainId) external view returns (address)',
    'function owner() external view returns (address)',
  ]);

  // Check if already registered
  const existing = await readContract(publicClient, {
    address: l1StakeManager as Address,
    abi: STAKE_MANAGER_ABI,
    functionName: 'l2Paymasters',
    args: [BigInt(l2ChainId)],
  });
  if (existing.toLowerCase() === paymasterAddress.toLowerCase()) {
    logger.info(`  Already registered`);
    return true;
  }

  // Check ownership
  const owner = await readContract(publicClient, {
    address: l1StakeManager as Address,
    abi: STAKE_MANAGER_ABI,
    functionName: 'owner',
  });
  if (owner.toLowerCase() !== account.address.toLowerCase()) {
    logger.error(`  Not owner of L1StakeManager (owner: ${owner})`);
    return false;
  }

  // Register
  const hash = await walletClient.writeContract({
    address: l1StakeManager as Address,
    abi: STAKE_MANAGER_ABI,
    functionName: 'registerL2Paymaster',
    args: [BigInt(l2ChainId), paymasterAddress as Address],
    account,
  });
  logger.info(`  Transaction: ${hash}`);
  
  await waitForTransactionReceipt(publicClient, { hash });
  logger.success(`  Registered successfully`);

  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const allChains = args.includes('--all');
  const chainArg = args.indexOf('--chain');
  const specificChainId = chainArg !== -1 ? parseInt(args[chainArg + 1]) : null;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         EIL CrossChainPaymaster Deployment                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  logger.info(`Deployer: ${account.address}\n`);

  // Load EIL config
  const eilConfig = loadEILConfig();
  if (!eilConfig?.hub?.l1StakeManager) {
    logger.error('L1StakeManager not configured in packages/config/eil.json');
    process.exit(1);
  }

  logger.info(`L1StakeManager: ${eilConfig.hub.l1StakeManager}`);
  logger.info(`L1 Hub Chain: ${eilConfig.hub.chainId}\n`);

  // Determine target chains
  let targetChains: L2ChainConfig[] = [];

  if (specificChainId) {
    const chain = Object.values(L2_CHAINS).find(c => c.chainId === specificChainId);
    if (!chain) {
      logger.error(`Unknown chain ID: ${specificChainId}`);
      console.log('Available chains:');
      Object.entries(L2_CHAINS).forEach(([key, c]) => {
        console.log(`  ${c.chainId}: ${c.name} (${key})`);
      });
      process.exit(1);
    }
    targetChains = [chain];
  } else if (allChains) {
    targetChains = Object.values(L2_CHAINS);
  } else {
    console.log('Available L2 chains:');
    Object.entries(L2_CHAINS).forEach(([key, c]) => {
      console.log(`  ${c.chainId}: ${c.name} (${key})`);
    });
    console.log('\nUsage:');
    console.log('  bun run scripts/deploy/eil-paymaster.ts --chain 84532');
    console.log('  bun run scripts/deploy/eil-paymaster.ts --all');
    process.exit(0);
  }

  // Deploy to each chain
  const contracts = loadContractsConfig();
  const results: Array<{ chain: L2ChainConfig; success: boolean; address?: string; error?: string }> = [];

  for (const chain of targetChains) {
    const result = await deployPaymaster(chain, eilConfig.hub.l1StakeManager, privateKey);
    results.push({ chain, ...result });

    if (result.success && result.address) {
      // Update contracts.json
      const chainKey = chain.chainId === 84532 ? 'baseSepolia' 
        : chain.chainId === 11155420 ? 'optimismSepolia'
        : chain.chainId === 421614 ? 'arbitrumSepolia'
        : 'testnet';

      if (contracts.external?.[chainKey]) {
        (contracts.external as Record<string, Record<string, unknown>>)[chainKey].eil = {
          ...(contracts.external as Record<string, Record<string, Record<string, unknown>>>)[chainKey].eil,
          crossChainPaymaster: result.address,
        };
      }

      // Register on L1
      const l1RpcUrl = 'https://ethereum-sepolia-rpc.publicnode.com';
      await registerPaymasterOnL1(
        l1RpcUrl,
        eilConfig.hub.l1StakeManager,
        chain.chainId,
        result.address,
        privateKey
      );
    }
  }

  // Save updated contracts
  saveContractsConfig(contracts);
  logger.info('\nUpdated packages/config/contracts.json');

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('DEPLOYMENT SUMMARY\n');

  for (const r of results) {
    if (r.success) {
      logger.success(`${r.chain.name}: ${r.address}`);
    } else {
      logger.error(`${r.chain.name}: ${r.error}`);
    }
  }

  const successCount = results.filter(r => r.success).length;
  console.log(`\n${successCount}/${results.length} chains deployed successfully`);

  if (successCount > 0) {
    console.log('\nNext steps:');
    console.log('1. Configure token support on each paymaster');
    console.log('2. Register XLPs: bun run scripts/register-xlp.ts --network testnet --stake 1.0');
    console.log('3. Deposit XLP liquidity: bun run scripts/register-xlp.ts --deposit --chain <chainId> --amount 0.5');
  }

  process.exit(successCount === results.length ? 0 : 1);
}

main().catch(err => {
  logger.error(`Deployment failed: ${err.message}`);
  process.exit(1);
});
