#!/usr/bin/env bun
/**
 * @fileoverview Multi-Chain Commerce Protocol Deployment Script
 * 
 * Deploys Coinbase Commerce Protocol contracts (AuthCaptureEscrow) to supported chains:
 * - Jeju Testnet & Mainnet
 * - Base Sepolia & Mainnet
 * 
 * Usage:
 *   bun run scripts/deploy/commerce.ts [--chain <chainId>] [--all] [--testnet] [--mainnet] [--verify]
 * 
 * @see Coinbase Commerce Onchain Payments Protocol
 */

import {
  createPublicClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { $ } from 'bun';

const logger = new Logger({ prefix: 'deploy-commerce' });

// ============ Types ============

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  network: 'testnet' | 'mainnet';
  explorerUrl?: string;
  usdc: Address;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

interface DeploymentResult {
  authCaptureEscrow: Address;
  supportedTokens: Address[];
  deployedAt: string;
  txHash: Hash;
}

// ============ Chain Configurations ============

const TESTNET_CHAINS: ChainConfig[] = [
  {
    chainId: 420690,
    name: 'Jeju Testnet',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
    network: 'testnet',
    explorerUrl: 'https://testnet-explorer.jejunetwork.org',
    usdc: '0x953F6516E5d2864cE7f13186B45dE418EA665EB2' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    network: 'testnet',
    explorerUrl: 'https://sepolia.basescan.org',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
];

const MAINNET_CHAINS: ChainConfig[] = [
  {
    chainId: 420691,
    name: 'Jeju',
    rpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jejunetwork.org',
    network: 'mainnet',
    explorerUrl: 'https://explorer.jejunetwork.org',
    usdc: '0x0000000000000000000000000000000000000000' as Address, // TBD
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 8453,
    name: 'Base',
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    network: 'mainnet',
    explorerUrl: 'https://basescan.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
];

// ============ Deployment ============

async function deployToChain(chain: ChainConfig, verify: boolean): Promise<DeploymentResult | null> {
  logger.info(`\n${'='.repeat(60)}`);
  logger.info(`Deploying Commerce to ${chain.name} (Chain ID: ${chain.chainId})`);
  logger.info(`${'='.repeat(60)}`);

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY not set');
    return null;
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  logger.info(`Deployer: ${account.address}`);

  // Check balance
  const publicClient = createPublicClient({
    transport: http(chain.rpcUrl),
  });

  const balance = await publicClient.getBalance({ address: account.address });
  logger.info(`Balance: ${formatEther(balance)} ${chain.nativeCurrency.symbol}`);

  const minBalance = parseEther('0.01');
  if (balance < minBalance) {
    logger.warn(`Insufficient balance on ${chain.name}. Need at least 0.01 ${chain.nativeCurrency.symbol}`);
    return null;
  }

  // Deploy using forge script
  const contractsDir = resolve(import.meta.dirname, '../../packages/contracts');
  const feeRecipient = process.env.FEE_RECIPIENT || account.address;
  const protocolFeeBps = process.env.PROTOCOL_FEE_BPS || '100'; // 1%
  const operatorAddress = process.env.OPERATOR_ADDRESS || account.address;
  const operatorFeeBps = process.env.OPERATOR_FEE_BPS || '50'; // 0.5%

  logger.info(`Fee Recipient: ${feeRecipient}`);
  logger.info(`Protocol Fee: ${protocolFeeBps} bps`);
  logger.info(`Operator: ${operatorAddress} (${operatorFeeBps} bps)`);

  const supportedTokens = chain.usdc !== '0x0000000000000000000000000000000000000000' 
    ? chain.usdc 
    : '';

  const envVars = {
    PRIVATE_KEY: privateKey,
    FEE_RECIPIENT: feeRecipient,
    PROTOCOL_FEE_BPS: protocolFeeBps,
    OPERATOR_ADDRESS: operatorAddress,
    OPERATOR_FEE_BPS: operatorFeeBps,
    SUPPORTED_TOKENS: supportedTokens,
  };

  const envString = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  try {
    logger.info('Running forge script...');
    
    const result = await $`cd ${contractsDir} && ${envString} forge script script/DeployCommerce.s.sol:DeployCommerce --rpc-url ${chain.rpcUrl} --broadcast --legacy 2>&1`.text();
    
    logger.info(result);

    // Parse deployed address from output
    const addressMatch = result.match(/AuthCaptureEscrow deployed to:\s*(0x[a-fA-F0-9]{40})/);
    if (!addressMatch) {
      logger.error('Could not find deployed address in output');
      return null;
    }

    const escrowAddress = addressMatch[1] as Address;
    logger.success(`AuthCaptureEscrow deployed: ${escrowAddress}`);

    // Parse tx hash
    const hashMatch = result.match(/Transaction hash:\s*(0x[a-fA-F0-9]{64})/);
    const txHash = (hashMatch?.[1] || '0x0000000000000000000000000000000000000000000000000000000000000000') as Hash;

    // Update contracts.json
    updateContractsJson(chain.chainId, escrowAddress);

    // Verify if requested
    if (verify && chain.explorerUrl) {
      logger.info('Verifying contract...');
      await verifyContract(chain, escrowAddress, contractsDir);
    }

    return {
      authCaptureEscrow: escrowAddress,
      supportedTokens: supportedTokens ? [chain.usdc] : [],
      deployedAt: new Date().toISOString(),
      txHash,
    };
  } catch (error) {
    logger.error(`Deployment failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function verifyContract(chain: ChainConfig, address: Address, contractsDir: string): Promise<void> {
  const apiKey = process.env[`${chain.name.toUpperCase().replace(/\s+/g, '_')}_ETHERSCAN_API_KEY`] 
    || process.env.ETHERSCAN_API_KEY;
  
  if (!apiKey) {
    logger.warn('No Etherscan API key found, skipping verification');
    return;
  }

  try {
    await $`cd ${contractsDir} && forge verify-contract ${address} src/commerce/AuthCaptureEscrow.sol:AuthCaptureEscrow --chain-id ${chain.chainId} --etherscan-api-key ${apiKey} 2>&1`.text();
    logger.success('Contract verified');
  } catch (error) {
    logger.warn(`Verification failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function updateContractsJson(chainId: number, escrowAddress: Address): void {
  const contractsPath = resolve(import.meta.dirname, '../../packages/config/contracts.json');
  
  try {
    const contracts = JSON.parse(readFileSync(contractsPath, 'utf-8'));
    
    // Find the right section based on chainId
    const chainMappings: Record<number, string[]> = {
      420690: ['local', 'testnet'],
      420691: ['mainnet'],
      84532: ['external', 'baseSepolia'],
      8453: ['external', 'base'],
    };
    
    const path = chainMappings[chainId];
    if (path) {
      let current = contracts;
      for (let i = 0; i < path.length - 1; i++) {
        current = current[path[i]];
      }
      const section = current[path[path.length - 1]];
      
      if (!section.payments) {
        section.payments = {};
      }
      section.payments.authCaptureEscrow = escrowAddress;
      
      writeFileSync(contractsPath, JSON.stringify(contracts, null, 2));
      logger.info(`Updated contracts.json with Commerce deployment`);
    }
  } catch (error) {
    logger.warn(`Failed to update contracts.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ CLI ============

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  
  const deployTestnet = args.includes('--testnet') || args.includes('--all');
  const deployMainnet = args.includes('--mainnet') || args.includes('--all');
  const verify = args.includes('--verify');
  
  const chainIdArg = args.indexOf('--chain');
  const specificChainId = chainIdArg !== -1 ? parseInt(args[chainIdArg + 1]) : null;
  
  if (!deployTestnet && !deployMainnet && !specificChainId) {
    logger.info('Usage: bun run scripts/deploy/commerce.ts [--testnet] [--mainnet] [--all] [--verify] [--chain <chainId>]');
    logger.info('');
    logger.info('Options:');
    logger.info('  --testnet   Deploy to all testnet chains');
    logger.info('  --mainnet   Deploy to all mainnet chains');
    logger.info('  --all       Deploy to all chains');
    logger.info('  --verify    Verify contracts on block explorer');
    logger.info('  --chain     Deploy to specific chain ID');
    logger.info('');
    logger.info('Environment Variables:');
    logger.info('  DEPLOYER_PRIVATE_KEY or PRIVATE_KEY - Deployer private key');
    logger.info('  FEE_RECIPIENT - Address to receive protocol fees');
    logger.info('  PROTOCOL_FEE_BPS - Protocol fee in basis points (default: 100)');
    logger.info('  OPERATOR_ADDRESS - Initial operator address');
    logger.info('  OPERATOR_FEE_BPS - Operator fee in basis points (default: 50)');
    return;
  }

  const results: Map<string, DeploymentResult | null> = new Map();

  // Deploy to specific chain
  if (specificChainId) {
    const chain = [...TESTNET_CHAINS, ...MAINNET_CHAINS].find(c => c.chainId === specificChainId);
    if (!chain) {
      logger.error(`Unknown chain ID: ${specificChainId}`);
      return;
    }
    results.set(chain.name, await deployToChain(chain, verify));
  }

  // Deploy to testnets
  if (deployTestnet) {
    for (const chain of TESTNET_CHAINS) {
      results.set(chain.name, await deployToChain(chain, verify));
    }
  }

  // Deploy to mainnets
  if (deployMainnet) {
    for (const chain of MAINNET_CHAINS) {
      results.set(chain.name, await deployToChain(chain, verify));
    }
  }

  // Summary
  logger.info('\n' + '='.repeat(60));
  logger.info('DEPLOYMENT SUMMARY');
  logger.info('='.repeat(60));
  
  for (const [chainName, result] of results) {
    if (result) {
      logger.success(`${chainName}: ${result.authCaptureEscrow}`);
    } else {
      logger.error(`${chainName}: FAILED`);
    }
  }
}

main().catch(console.error);

