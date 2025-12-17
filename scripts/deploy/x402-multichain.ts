#!/usr/bin/env bun
/**
 * @fileoverview Multi-Chain x402 Facilitator Deployment Script
 * 
 * Deploys x402 Payment Protocol contracts to all supported chains:
 * - Jeju Testnet & Mainnet
 * - Base Sepolia & Mainnet
 * - Ethereum Sepolia & Mainnet
 * - Arbitrum Sepolia & Mainnet
 * - Optimism Sepolia & Mainnet
 * 
 * Usage:
 *   bun run scripts/deploy/x402-multichain.ts [--chain <chainId>] [--all] [--testnet] [--mainnet] [--verify]
 * 
 * @see https://x402.org - Coinbase x402 Protocol Specification
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Chain,
  type Address,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

const logger = new Logger({ prefix: 'deploy-x402' });

// ============ Types ============

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  network: 'testnet' | 'mainnet';
  explorerUrl?: string;
  explorerApiKey?: string;
  usdc: Address;
  eurc?: Address;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

interface DeploymentResult {
  x402Facilitator: Address;
  x402IntentBridge?: Address;
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
  {
    chainId: 11155111,
    name: 'Sepolia',
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com',
    network: 'testnet',
    explorerUrl: 'https://sepolia.etherscan.io',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 421614,
    name: 'Arbitrum Sepolia',
    rpcUrl: process.env.ARBITRUM_SEPOLIA_RPC_URL || 'https://sepolia-rollup.arbitrum.io/rpc',
    network: 'testnet',
    explorerUrl: 'https://sepolia.arbiscan.io',
    usdc: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 11155420,
    name: 'Optimism Sepolia',
    rpcUrl: process.env.OPTIMISM_SEPOLIA_RPC_URL || 'https://sepolia.optimism.io',
    network: 'testnet',
    explorerUrl: 'https://sepolia-optimism.etherscan.io',
    usdc: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 97,
    name: 'BSC Testnet',
    rpcUrl: process.env.BSC_TESTNET_RPC_URL || 'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    network: 'testnet',
    explorerUrl: 'https://testnet.bscscan.com',
    usdc: '0x337610d27c682E347C9cD60BD4b3b107C9d34dDd' as Address, // USDT on BSC testnet
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
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
    eurc: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    network: 'mainnet',
    explorerUrl: 'https://etherscan.io',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    eurc: '0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 42161,
    name: 'Arbitrum One',
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    network: 'mainnet',
    explorerUrl: 'https://arbiscan.io',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 10,
    name: 'Optimism',
    rpcUrl: process.env.OPTIMISM_RPC_URL || 'https://mainnet.optimism.io',
    network: 'mainnet',
    explorerUrl: 'https://optimistic.etherscan.io',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85' as Address,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  },
  {
    chainId: 56,
    name: 'BNB Chain',
    rpcUrl: process.env.BSC_RPC_URL || 'https://bsc-dataseed.bnbchain.org',
    network: 'mainnet',
    explorerUrl: 'https://bscscan.com',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d' as Address,
    nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  },
];

// ============ Paths ============

const CONTRACTS_DIR = resolve(process.cwd(), 'packages/contracts');
const DEPLOYMENTS_DIR = resolve(CONTRACTS_DIR, 'deployments');
const TESTNET_DEPLOYMENTS_FILE = resolve(DEPLOYMENTS_DIR, 'x402-testnet.json');
const MAINNET_DEPLOYMENTS_FILE = resolve(DEPLOYMENTS_DIR, 'x402-mainnet.json');

// ============ Protocol Fee Configuration ============

const PROTOCOL_FEE_BPS = 50; // 0.5% - standard for micropayments
const FEE_RECIPIENT = process.env.FEE_RECIPIENT || process.env.TREASURY_ADDRESS;

// ============ Helper Functions ============

function createViemChain(config: ChainConfig): Chain {
  return {
    id: config.chainId,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: { default: { http: [config.rpcUrl] } },
  };
}

async function checkChainConnectivity(chain: ChainConfig): Promise<boolean> {
  try {
    const viemChain = createViemChain(chain);
    const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
    const chainId = await publicClient.getChainId();
    return chainId === chain.chainId;
  } catch {
    return false;
  }
}

async function checkDeployerBalance(
  chain: ChainConfig,
  address: Address,
  minBalance = 0.01
): Promise<{ hasBalance: boolean; balance: string }> {
  try {
    const viemChain = createViemChain(chain);
    const publicClient = createPublicClient({ chain: viemChain, transport: http(chain.rpcUrl) });
    const balance = await publicClient.getBalance({ address });
    const ethBalance = Number(formatEther(balance));
    return {
      hasBalance: ethBalance >= minBalance,
      balance: ethBalance.toFixed(4),
    };
  } catch {
    return { hasBalance: false, balance: '0' };
  }
}

async function deployToChain(chain: ChainConfig, verify: boolean): Promise<DeploymentResult> {
  logger.info(`\nDeploying x402 to ${chain.name} (Chain ID: ${chain.chainId})...`);

  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');

  // Prepare supported tokens array
  const supportedTokens: Address[] = [chain.usdc];
  if (chain.eurc) {
    supportedTokens.push(chain.eurc);
  }

  // Filter out zero addresses
  const validTokens = supportedTokens.filter(
    (t) => t !== '0x0000000000000000000000000000000000000000'
  );

  // Build forge command
  const args = [
    'script',
    'script/DeployX402.s.sol:DeployX402',
    '--rpc-url',
    chain.rpcUrl,
    '--broadcast',
    '--json',
  ];

  if (verify && chain.explorerUrl) {
    args.push('--verify');
  }

  const feeRecipient = FEE_RECIPIENT || process.env.DEPLOYER_ADDRESS;
  if (!feeRecipient) throw new Error('FEE_RECIPIENT or TREASURY_ADDRESS required');

  const env = {
    ...process.env,
    PRIVATE_KEY: pk,
    FEE_RECIPIENT: feeRecipient,
    PROTOCOL_FEE_BPS: PROTOCOL_FEE_BPS.toString(),
    SUPPORTED_TOKENS: validTokens.join(','),
    CHAIN_ID: chain.chainId.toString(),
  };

  logger.info(`Fee recipient: ${feeRecipient}`);
  logger.info(`Protocol fee: ${PROTOCOL_FEE_BPS / 100}%`);
  logger.info(`Supported tokens: ${validTokens.length}`);

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
  logger.info(`  X402Facilitator: ${addresses.x402Facilitator}`);
  if (addresses.x402IntentBridge) {
    logger.info(`  X402IntentBridge: ${addresses.x402IntentBridge}`);
  }

  return {
    ...addresses,
    supportedTokens: validTokens,
    deployedAt: new Date().toISOString(),
    txHash: '0x0' as Hash, // Would be parsed from forge output
  };
}

function parseDeploymentOutput(output: string): Pick<DeploymentResult, 'x402Facilitator' | 'x402IntentBridge'> {
  const result: Pick<DeploymentResult, 'x402Facilitator' | 'x402IntentBridge'> = {
    x402Facilitator: '0x0' as Address,
  };

  const patterns = [
    {
      key: 'x402Facilitator',
      pattern: /X402Facilitator deployed to:\s*(0x[a-fA-F0-9]{40})/i,
    },
    {
      key: 'x402IntentBridge',
      pattern: /X402IntentBridge deployed to:\s*(0x[a-fA-F0-9]{40})/i,
    },
  ];

  for (const { key, pattern } of patterns) {
    const match = output.match(pattern);
    if (match) {
      result[key as keyof typeof result] = match[1] as Address;
    }
  }

  // Try to extract from JSON lines
  const lines = output.split('\n');
  for (const line of lines) {
    if (line.includes('"deployedTo"')) {
      try {
        const json = JSON.parse(line);
        if (json.contractName === 'X402Facilitator') {
          result.x402Facilitator = json.deployedTo;
        } else if (json.contractName === 'X402IntentBridge') {
          result.x402IntentBridge = json.deployedTo;
        }
      } catch {
        // Continue with regex parsing
      }
    }
  }

  return result;
}

function updateDeploymentsFile(
  chainId: number,
  chainName: string,
  addresses: DeploymentResult,
  isMainnet: boolean
) {
  const filePath = isMainnet ? MAINNET_DEPLOYMENTS_FILE : TESTNET_DEPLOYMENTS_FILE;

  // Ensure directory exists
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  let deployments: Record<string, Record<string, unknown>> = { chains: {} };

  if (existsSync(filePath)) {
    deployments = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!deployments.chains) {
      deployments.chains = {};
    }
  }

  const chains = deployments.chains as Record<string, Record<string, unknown>>;

  chains[chainId.toString()] = {
    name: chainName,
    status: 'deployed',
    x402Facilitator: addresses.x402Facilitator,
    x402IntentBridge: addresses.x402IntentBridge,
    supportedTokens: addresses.supportedTokens,
    deployedAt: addresses.deployedAt,
    txHash: addresses.txHash,
    protocolFeeBps: PROTOCOL_FEE_BPS,
  };

  deployments.lastUpdated = new Date().toISOString();
  deployments.version = '1.0.0';

  writeFileSync(filePath, JSON.stringify(deployments, null, 2));
  logger.info(`Updated ${filePath}`);
}

function updateConfigContracts(chainId: number, facilitatorAddress: Address, isMainnet: boolean) {
  const configPath = resolve(process.cwd(), 'packages/config/contracts.json');

  if (!existsSync(configPath)) {
    logger.warn('contracts.json not found, skipping config update');
    return;
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  // Find the right section based on chain ID
  const chainKeyMap: Record<number, { section: string; key: string }> = {
    420690: { section: 'testnet', key: 'payments' },
    420691: { section: 'mainnet', key: 'payments' },
    84532: { section: 'external.baseSepolia', key: 'x402Facilitator' },
    8453: { section: 'external.base', key: 'x402Facilitator' },
    11155111: { section: 'external.sepolia', key: 'x402Facilitator' },
    1: { section: 'external.ethereum', key: 'x402Facilitator' },
    421614: { section: 'external.arbitrumSepolia', key: 'x402Facilitator' },
    42161: { section: 'external.arbitrum', key: 'x402Facilitator' },
    11155420: { section: 'external.optimismSepolia', key: 'x402Facilitator' },
    10: { section: 'external.optimism', key: 'x402Facilitator' },
  };

  const mapping = chainKeyMap[chainId];
  if (!mapping) {
    logger.warn(`No config mapping for chain ${chainId}`);
    return;
  }

  // Navigate to the right section
  const pathParts = mapping.section.split('.');
  let current: Record<string, unknown> = config;

  for (const part of pathParts) {
    if (!current[part]) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  if (mapping.key === 'payments') {
    (current as Record<string, string>).x402Facilitator = facilitatorAddress;
  } else {
    current[mapping.key] = facilitatorAddress;
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2));
  logger.info(`Updated contracts.json for chain ${chainId}`);
}

// ============ Main ============

async function main() {
  const args = process.argv.slice(2);
  const deployAll = args.includes('--all');
  const deployTestnet = args.includes('--testnet');
  const deployMainnet = args.includes('--mainnet');
  const verify = args.includes('--verify');
  const chainIdArg = args.indexOf('--chain');
  const specificChainId = chainIdArg !== -1 ? parseInt(args[chainIdArg + 1]) : null;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║         x402 Multi-Chain Deployment                            ║');
  console.log('║         Coinbase Payment Protocol                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const pk = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) {
    logger.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  logger.info(`Deployer: ${account.address}`);
  logger.info(`Protocol Fee: ${PROTOCOL_FEE_BPS / 100}%\n`);

  // Determine which chains to deploy to
  let chains: ChainConfig[] = [];

  if (specificChainId) {
    const chain = [...TESTNET_CHAINS, ...MAINNET_CHAINS].find((c) => c.chainId === specificChainId);
    if (chain) chains = [chain];
  } else if (deployTestnet || (!deployMainnet && !deployAll)) {
    chains = TESTNET_CHAINS;
  } else if (deployMainnet) {
    chains = MAINNET_CHAINS;
  } else if (deployAll) {
    chains = [...TESTNET_CHAINS, ...MAINNET_CHAINS];
  }

  // Check chain connectivity and balances
  console.log('Checking chains...\n');

  const deployableChains: ChainConfig[] = [];

  for (const chain of chains) {
    const connected = await checkChainConnectivity(chain);
    const { hasBalance, balance } = await checkDeployerBalance(chain, account.address);

    const statusIcon = connected && hasBalance ? '✅' : connected ? '⚠️' : '❌';
    const networkBadge = chain.network === 'mainnet' ? '🔴' : '🟡';

    console.log(`${statusIcon} ${networkBadge} ${chain.name} (${chain.chainId})`);
    console.log(`   RPC: ${connected ? 'Connected' : 'Not reachable'}`);
    console.log(`   Balance: ${balance} ETH ${hasBalance ? '' : '(need 0.01+)'}`);
    console.log(`   USDC: ${chain.usdc}`);

    if (connected && hasBalance) {
      deployableChains.push(chain);
    }
  }

  console.log('\n' + '═'.repeat(60) + '\n');

  if (deployableChains.length === 0) {
    logger.error('No chains available for deployment');
    console.log('\nTo deploy:');
    console.log('1. Ensure chains are reachable');
    console.log('2. Fund deployer wallet with ETH');
    console.log('3. Run: bun run scripts/deploy/x402-multichain.ts --testnet');
    process.exit(1);
  }

  if (!deployAll && !deployTestnet && !deployMainnet && !specificChainId) {
    console.log('Available for deployment:');
    deployableChains.forEach((c) => {
      const badge = c.network === 'mainnet' ? '🔴' : '🟡';
      console.log(`  ${badge} ${c.name} (${c.chainId})`);
    });
    console.log('\nRun with:');
    console.log('  --testnet    Deploy to all testnets');
    console.log('  --mainnet    Deploy to all mainnets');
    console.log('  --all        Deploy to all chains');
    console.log('  --chain <id> Deploy to specific chain');
    console.log('  --verify     Verify on block explorer');
    process.exit(0);
  }

  // Deploy to each chain
  const results: Array<{
    chain: ChainConfig;
    success: boolean;
    addresses?: DeploymentResult;
    error?: string;
  }> = [];

  for (const chain of deployableChains) {
    try {
      const addresses = await deployToChain(chain, verify);
      updateDeploymentsFile(chain.chainId, chain.name, addresses, chain.network === 'mainnet');
      updateConfigContracts(chain.chainId, addresses.x402Facilitator, chain.network === 'mainnet');
      results.push({ chain, success: true, addresses });
    } catch (err) {
      results.push({ chain, success: false, error: (err as Error).message });
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(60));
  console.log('DEPLOYMENT SUMMARY\n');

  for (const r of results) {
    const badge = r.chain.network === 'mainnet' ? '🔴' : '🟡';
    if (r.success) {
      logger.success(`${badge} ${r.chain.name}: Deployed`);
      if (r.addresses) {
        console.log(`   X402Facilitator: ${r.addresses.x402Facilitator}`);
        if (r.addresses.x402IntentBridge) {
          console.log(`   X402IntentBridge: ${r.addresses.x402IntentBridge}`);
        }
      }
    } else {
      logger.error(`${badge} ${r.chain.name}: Failed - ${r.error}`);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(`\n${successCount}/${results.length} chains deployed successfully`);

  if (successCount > 0) {
    console.log('\nNext steps:');
    console.log('1. Update Helm values: packages/deployment/kubernetes/helm/x402-facilitator/values.yaml');
    console.log('2. Deploy x402 service: helm upgrade --install x402 ./x402-facilitator');
    console.log('3. Test payment: bun run scripts/shared/x402-client.ts --test');
  }
}

main().catch((err) => {
  logger.error(`Deployment failed: ${err.message}`);
  process.exit(1);
});

