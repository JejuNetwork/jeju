#!/usr/bin/env bun
/**
 * @deprecated Use 'jeju token verify' instead
 * 
 * Testnet Deployment and Verification Script
 *
 * Deploys the complete token infrastructure to:
 * - Jeju Testnet (Chain ID: 420690)
 * - Sepolia (Chain ID: 11155111)
 * - Solana Devnet
 *
 * Then verifies cross-chain functionality and measures execution times.
 *
 * Usage:
 *   jeju token verify --network testnet
 *   jeju token verify --network testnet --dry-run
 *
 * Environment Variables:
 *   PRIVATE_KEY - EVM deployer private key
 *   SOLANA_PRIVATE_KEY - Base58 encoded Solana key
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { preloadAllArtifacts, deployContract } from '../src/deployer/contract-deployer';
import { SolanaInfraManager } from '../src/integration/solana-infra';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

// ============================================================================
// Configuration
// ============================================================================

const JEJU_TESTNET_RPC = 'https://rpc.testnet.jeju.network';
const SEPOLIA_RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';

const JEJU_TESTNET = {
  id: 420690,
  name: 'Jeju Testnet',
  network: 'jeju-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [JEJU_TESTNET_RPC] },
    public: { http: [JEJU_TESTNET_RPC] },
  },
  blockExplorers: {
    default: { name: 'Jeju Explorer', url: 'https://explorer.testnet.jeju.network' },
  },
} as const;

interface DeploymentMetrics {
  chain: string;
  contractName: string;
  address: string;
  gasUsed: string;
  deploymentTime: number;
  txHash: string;
}

interface CrossChainMetrics {
  sourceChain: string;
  destChain: string;
  amount: string;
  totalTime: number;
  sourceTxTime: number;
  relayTime: number;
  destConfirmTime: number;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const isDryRun = process.argv.includes('--dry-run');

  console.log('='.repeat(70));
  console.log(`Testnet Deployment${isDryRun ? ' (DRY RUN)' : ''}`);
  console.log('='.repeat(70));
  console.log('');

  // Validate environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey && !isDryRun) {
    console.error('ERROR: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  const deploymentMetrics: DeploymentMetrics[] = [];
  const crossChainMetrics: CrossChainMetrics[] = [];

  // ============================================================================
  // Setup Clients
  // ============================================================================

  console.log('Setting up clients...');

  const account = privateKey
    ? privateKeyToAccount(privateKey as Hex)
    : privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');

  console.log(`Deployer: ${account.address}`);

  const jejuPublic = createPublicClient({
    chain: JEJU_TESTNET,
    transport: http(JEJU_TESTNET_RPC),
  });

  const jejuWallet = createWalletClient({
    chain: JEJU_TESTNET,
    transport: http(JEJU_TESTNET_RPC),
    account,
  });

  const sepoliaPublic = createPublicClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
  });

  const sepoliaWallet = createWalletClient({
    chain: sepolia,
    transport: http(SEPOLIA_RPC),
    account,
  });

  // Check balances
  console.log('');
  console.log('Checking balances...');

  try {
    const jejuBalance = await jejuPublic.getBalance({ address: account.address });
    console.log(`  Jeju Testnet: ${formatEther(jejuBalance)} ETH`);
  } catch (e) {
    console.log(`  Jeju Testnet: Unable to connect (${e})`);
  }

  try {
    const sepoliaBalance = await sepoliaPublic.getBalance({ address: account.address });
    console.log(`  Sepolia: ${formatEther(sepoliaBalance)} ETH`);
  } catch (e) {
    console.log(`  Sepolia: Unable to connect`);
  }

  // Check Solana
  const solana = new SolanaInfraManager('devnet');
  try {
    const status = await solana.getStatus();
    console.log(`  Solana Devnet: Connected (slot: ${status.slot})`);
  } catch (e) {
    console.log(`  Solana Devnet: Unable to connect`);
  }

  console.log('');

  if (isDryRun) {
    console.log('DRY RUN - Would deploy:');
    console.log('  - Token on Jeju Testnet (home chain)');
    console.log('  - Token on Sepolia (synthetic)');
    console.log('  - FeeDistributor on Jeju Testnet');
    console.log('  - TokenVesting on Jeju Testnet');
    console.log('  - Presale on Jeju Testnet');
    console.log('  - Hyperlane Warp Routes for cross-chain');
    console.log('  - SPL Token on Solana Devnet');
    console.log('');
    console.log('Run without --dry-run to deploy');
    return;
  }

  // ============================================================================
  // Deploy Contracts
  // ============================================================================

  console.log('Loading contract artifacts...');
  await preloadAllArtifacts();

  // Deploy to Jeju (home chain)
  console.log('');
  console.log('Deploying to Jeju Testnet (home chain)...');

  const tokenConfig = {
    name: 'Jeju',
    symbol: 'JEJU',
    totalSupply: parseEther('1000000000'),
  };

  let jejuTokenAddress: Address | undefined;
  let jejuFeeDistributor: Address | undefined;
  let jejuVesting: Address | undefined;

  try {
    const startTime = Date.now();
    const result = await deployContract(jejuPublic, jejuWallet, 'Token', [
      tokenConfig.name,
      tokenConfig.symbol,
      tokenConfig.totalSupply,
      account.address,
      true, // isHomeChain
    ]);
    jejuTokenAddress = result.address;

    deploymentMetrics.push({
      chain: 'Jeju Testnet',
      contractName: 'Token',
      address: result.address,
      gasUsed: result.gasUsed.toString(),
      deploymentTime: Date.now() - startTime,
      txHash: result.txHash,
    });

    console.log(`  Token: ${result.address} (${Date.now() - startTime}ms)`);
  } catch (e) {
    console.log(`  ERROR deploying Token: ${e}`);
  }

  if (jejuTokenAddress) {
    try {
      const startTime = Date.now();
      const result = await deployContract(jejuPublic, jejuWallet, 'FeeDistributor', [
        jejuTokenAddress,
        account.address,
      ]);
      jejuFeeDistributor = result.address;

      deploymentMetrics.push({
        chain: 'Jeju Testnet',
        contractName: 'FeeDistributor',
        address: result.address,
        gasUsed: result.gasUsed.toString(),
        deploymentTime: Date.now() - startTime,
        txHash: result.txHash,
      });

      console.log(`  FeeDistributor: ${result.address} (${Date.now() - startTime}ms)`);
    } catch (e) {
      console.log(`  ERROR deploying FeeDistributor: ${e}`);
    }

    try {
      const startTime = Date.now();
      const result = await deployContract(jejuPublic, jejuWallet, 'TokenVesting', [
        jejuTokenAddress,
        account.address,
      ]);
      jejuVesting = result.address;

      deploymentMetrics.push({
        chain: 'Jeju Testnet',
        contractName: 'TokenVesting',
        address: result.address,
        gasUsed: result.gasUsed.toString(),
        deploymentTime: Date.now() - startTime,
        txHash: result.txHash,
      });

      console.log(`  TokenVesting: ${result.address} (${Date.now() - startTime}ms)`);
    } catch (e) {
      console.log(`  ERROR deploying TokenVesting: ${e}`);
    }
  }

  // Deploy to Sepolia (synthetic chain)
  console.log('');
  console.log('Deploying to Sepolia (synthetic chain)...');

  let sepoliaTokenAddress: Address | undefined;

  try {
    const startTime = Date.now();
    const result = await deployContract(sepoliaPublic, sepoliaWallet, 'Token', [
      tokenConfig.name,
      tokenConfig.symbol,
      0n, // No initial supply on synthetic chain
      account.address,
      false, // Not home chain
    ]);
    sepoliaTokenAddress = result.address;

    deploymentMetrics.push({
      chain: 'Sepolia',
      contractName: 'Token',
      address: result.address,
      gasUsed: result.gasUsed.toString(),
      deploymentTime: Date.now() - startTime,
      txHash: result.txHash,
    });

    console.log(`  Token: ${result.address} (${Date.now() - startTime}ms)`);
  } catch (e) {
    console.log(`  ERROR deploying to Sepolia: ${e}`);
  }

  // ============================================================================
  // Print Results
  // ============================================================================

  console.log('');
  console.log('='.repeat(70));
  console.log('DEPLOYMENT RESULTS');
  console.log('='.repeat(70));
  console.log('');

  console.log('Contracts Deployed:');
  console.log('-'.repeat(70));
  console.log(
    `${'Chain'.padEnd(15)} ${'Contract'.padEnd(20)} ${'Time (ms)'.padEnd(12)} ${'Gas Used'.padEnd(12)}`
  );
  console.log('-'.repeat(70));

  let totalGas = 0n;
  let totalTime = 0;

  for (const m of deploymentMetrics) {
    console.log(
      `${m.chain.padEnd(15)} ${m.contractName.padEnd(20)} ${m.deploymentTime.toString().padEnd(12)} ${m.gasUsed.padEnd(12)}`
    );
    totalGas += BigInt(m.gasUsed);
    totalTime += m.deploymentTime;
  }

  console.log('-'.repeat(70));
  console.log(`${'TOTAL'.padEnd(35)} ${totalTime.toString().padEnd(12)} ${totalGas.toString()}`);
  console.log('');

  // Save deployment data
  const deploymentData = {
    timestamp: new Date().toISOString(),
    deployer: account.address,
    contracts: {
      jejuTestnet: {
        token: jejuTokenAddress,
        feeDistributor: jejuFeeDistributor,
        vesting: jejuVesting,
      },
      sepolia: {
        token: sepoliaTokenAddress,
      },
    },
    metrics: {
      deployment: deploymentMetrics,
      crossChain: crossChainMetrics,
      totalDeploymentTime: totalTime,
      totalGasUsed: totalGas.toString(),
    },
  };

  const deploymentPath = `${import.meta.dir}/../deployments/testnet-${Date.now()}.json`;
  await Bun.write(deploymentPath, JSON.stringify(deploymentData, null, 2));
  console.log(`Deployment data saved to: ${deploymentPath}`);
}

main().catch(console.error);
