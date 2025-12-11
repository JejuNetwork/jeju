#!/usr/bin/env bun
/**
 * @fileoverview Multi-Chain OIF Deployment Script
 * 
 * Deploys Open Intents Framework contracts to all supported chains:
 * - Sepolia (L1)
 * - Base Sepolia
 * - Arbitrum Sepolia
 * - Optimism Sepolia
 * - BSC Testnet
 * - Jeju Testnet (when RPC is live)
 * 
 * Usage:
 *   bun run scripts/deploy/oif-multichain.ts [--chain <chainId>] [--all] [--verify]
 */

import { ethers } from 'ethers';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('deploy-oif-multichain');

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  oracleType: 'simple' | 'superchain' | 'hyperlane';
  explorerUrl?: string;
  explorerApiKey?: string;
}

const TESTNET_CHAINS: ChainConfig[] = [
  {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    oracleType: 'simple',
    explorerUrl: 'https://sepolia.etherscan.io',
  },
  {
    chainId: 84532,
    name: 'Base Sepolia',
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    oracleType: 'simple',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    oracleType: 'simple',
    explorerUrl: 'https://sepolia.arbiscan.io',
  },
  {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
    oracleType: 'superchain',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
  },
  {
    chainId: 97,
    name: 'BSC Testnet',
    rpcUrl: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    oracleType: 'simple',
    explorerUrl: 'https://testnet.bscscan.com',
  },
  {
    chainId: 420690,
    name: 'Jeju Testnet',
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    oracleType: 'superchain',
    explorerUrl: 'https://testnet-explorer.jeju.network',
  },
];

const CONTRACTS_DIR = resolve(process.cwd(), 'packages/contracts');
const DEPLOYMENTS_FILE = resolve(CONTRACTS_DIR, 'deployments/oif-testnet.json');

interface DeploymentResult {
  solverRegistry: string;
  inputSettler: string;
  outputSettler: string;
  oracle: string;
}

async function checkChainConnectivity(chain: ChainConfig): Promise<boolean> {
  try {
    const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
    const network = await provider.getNetwork();
    return Number(network.chainId) === chain.chainId;
  } catch {
    return false;
  }
}

async function checkDeployerBalance(chain: ChainConfig, minBalance = 0.05): Promise<{ hasBalance: boolean; balance: string }> {
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) return { hasBalance: false, balance: '0' };
  
  const provider = new ethers.JsonRpcProvider(chain.rpcUrl);
  const wallet = new ethers.Wallet(pk);
  const balance = await provider.getBalance(wallet.address);
  const ethBalance = Number(ethers.formatEther(balance));
  
  return {
    hasBalance: ethBalance >= minBalance,
    balance: ethBalance.toFixed(4),
  };
}

async function deployToChain(chain: ChainConfig, verify: boolean): Promise<DeploymentResult> {
  logger.info(`\nDeploying OIF to ${chain.name} (Chain ID: ${chain.chainId})...`);
  
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
  
  // Build forge command
  const args = [
    'script', 'script/DeployOIF.s.sol',
    '--rpc-url', chain.rpcUrl,
    '--broadcast',
    '--json',
  ];
  
  // Add verification if requested
  if (verify && chain.explorerUrl) {
    args.push('--verify');
  }
  
  // Set environment for oracle type
  const env = {
    ...process.env,
    PRIVATE_KEY: pk,
    ORACLE_TYPE: chain.oracleType,
  };
  
  logger.info(`Oracle type: ${chain.oracleType}`);
  
  const proc = Bun.spawn(['forge', ...args], {
    cwd: CONTRACTS_DIR,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    logger.error(`Deployment failed: ${stderr || stdout}`);
    throw new Error(`Deployment to ${chain.name} failed`);
  }
  
  // Parse deployment output
  const addresses = parseDeploymentOutput(stdout + stderr);
  
  logger.success(`Deployed to ${chain.name}:`);
  logger.info(`  SolverRegistry: ${addresses.solverRegistry}`);
  logger.info(`  InputSettler: ${addresses.inputSettler}`);
  logger.info(`  OutputSettler: ${addresses.outputSettler}`);
  logger.info(`  Oracle: ${addresses.oracle}`);
  
  return addresses;
}

function parseDeploymentOutput(output: string): DeploymentResult {
  const result: DeploymentResult = {
    solverRegistry: '',
    inputSettler: '',
    outputSettler: '',
    oracle: '',
  };
  
  // Try JSON parsing first
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('deployedTo')) {
      // Would need to map contract names from JSON
    }
  }
  
  // Fallback to regex parsing of console output
  const patterns = [
    { key: 'solverRegistry', pattern: /SolverRegistry deployed to:\s*(0x[a-fA-F0-9]{40})/i },
    { key: 'inputSettler', pattern: /InputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/i },
    { key: 'outputSettler', pattern: /OutputSettler deployed to:\s*(0x[a-fA-F0-9]{40})/i },
    { key: 'oracle', pattern: /(Simple|Hyperlane|Superchain)?Oracle deployed to:\s*(0x[a-fA-F0-9]{40})/i },
  ];
  
  for (const { key, pattern } of patterns) {
    const match = output.match(pattern);
    if (match) {
      result[key as keyof DeploymentResult] = match[match.length - 1];
    }
  }
  
  return result;
}

function updateDeploymentsFile(chainId: number, addresses: DeploymentResult) {
  let deployments: Record<string, unknown> = {};
  
  if (existsSync(DEPLOYMENTS_FILE)) {
    deployments = JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf-8'));
  }
  
  if (!deployments.chains) {
    deployments.chains = {};
  }
  
  const chains = deployments.chains as Record<string, Record<string, unknown>>;
  if (!chains[chainId.toString()]) {
    chains[chainId.toString()] = {};
  }
  
  chains[chainId.toString()].status = 'deployed';
  chains[chainId.toString()].contracts = addresses;
  chains[chainId.toString()].deployedAt = new Date().toISOString();
  
  deployments.lastUpdated = new Date().toISOString();
  
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(deployments, null, 2));
  logger.info(`Updated ${DEPLOYMENTS_FILE}`);
}

async function main() {
  const args = process.argv.slice(2);
  const deployAll = args.includes('--all');
  const verify = args.includes('--verify');
  const chainIdArg = args.indexOf('--chain');
  const specificChainId = chainIdArg !== -1 ? parseInt(args[chainIdArg + 1]) : null;
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         Multi-Chain OIF Deployment                             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  // Check private key
  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) {
    logger.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }
  
  const wallet = new ethers.Wallet(pk);
  logger.info(`Deployer: ${wallet.address}\n`);
  
  // Check chain connectivity and balances
  console.log('Checking chains...\n');
  
  const deployableChains: ChainConfig[] = [];
  
  for (const chain of TESTNET_CHAINS) {
    // Skip if specific chain requested and this isn't it
    if (specificChainId && chain.chainId !== specificChainId) continue;
    
    const connected = await checkChainConnectivity(chain);
    const { hasBalance, balance } = await checkDeployerBalance(chain);
    
    const statusIcon = connected && hasBalance ? '✅' : connected ? '⚠️' : '❌';
    console.log(`${statusIcon} ${chain.name} (${chain.chainId})`);
    console.log(`   RPC: ${connected ? 'Connected' : 'Not reachable'}`);
    console.log(`   Balance: ${balance} ETH ${hasBalance ? '' : '(need 0.05+)'}`);
    
    if (connected && hasBalance) {
      deployableChains.push(chain);
    }
  }
  
  console.log('\n' + '═'.repeat(60) + '\n');
  
  if (deployableChains.length === 0) {
    logger.error('No chains available for deployment');
    console.log('\nTo deploy:');
    console.log('1. Ensure chains are reachable');
    console.log('2. Fund deployer wallet with testnet ETH');
    console.log('3. Run: bun run scripts/deploy/oif-multichain.ts --all');
    process.exit(1);
  }
  
  if (!deployAll && !specificChainId) {
    console.log('Available for deployment:');
    deployableChains.forEach(c => console.log(`  - ${c.name} (${c.chainId})`));
    console.log('\nRun with --all to deploy to all, or --chain <chainId> for specific chain');
    process.exit(0);
  }
  
  // Deploy to each chain
  const results: Array<{ chain: ChainConfig; success: boolean; addresses?: DeploymentResult; error?: string }> = [];
  
  for (const chain of deployableChains) {
    try {
      const addresses = await deployToChain(chain, verify);
      updateDeploymentsFile(chain.chainId, addresses);
      results.push({ chain, success: true, addresses });
    } catch (err) {
      results.push({ chain, success: false, error: (err as Error).message });
    }
  }
  
  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('DEPLOYMENT SUMMARY\n');
  
  for (const r of results) {
    if (r.success) {
      logger.success(`${r.chain.name}: Deployed`);
      if (r.addresses) {
        console.log(`   SolverRegistry: ${r.addresses.solverRegistry}`);
        console.log(`   InputSettler: ${r.addresses.inputSettler}`);
        console.log(`   OutputSettler: ${r.addresses.outputSettler}`);
      }
    } else {
      logger.error(`${r.chain.name}: Failed - ${r.error}`);
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`\n${successCount}/${results.length} chains deployed successfully`);
  
  if (successCount > 0) {
    console.log('\nNext steps:');
    console.log('1. Verify cross-chain liquidity: bun run scripts/verify-crosschain-liquidity.ts');
    console.log('2. Register solvers: bun run scripts/register-solver.ts');
    console.log('3. Configure attesters for cross-chain oracle');
  }
}

main().catch(err => {
  logger.error(`Deployment failed: ${err.message}`);
  process.exit(1);
});


