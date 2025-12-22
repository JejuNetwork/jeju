#!/usr/bin/env bun
/**
 * Deploy Federation Contracts
 * 
 * Deploys all federation infrastructure for cross-chain interop:
 * - NetworkRegistry: Hub for all federated networks
 * - RegistryHub: Meta-registry tracking all registries
 * - RegistrySyncOracle: Event-driven registry sync
 * - SolanaVerifier: Wormhole-based Solana verification
 * - CrossChainIdentitySync: Hyperlane-based identity sync
 * - FederatedIdentity: Cross-chain identity
 * - FederatedLiquidity: Cross-chain liquidity
 * - FederatedSolver: Cross-chain solver discovery
 * 
 * Usage:
 *   bun run scripts/deploy-federation.ts [--network localnet|testnet|mainnet]
 */

import { createPublicClient, createWalletClient, http, formatEther, parseEther, type Address, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { ConstructorArg, RawArtifactJson } from './shared/contract-types';

const NETWORK = process.argv.includes('--network') 
  ? process.argv[process.argv.indexOf('--network') + 1] 
  : 'localnet';

const CONTRACTS_DIR = join(import.meta.dir, '../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');
const DEPLOYMENTS_DIR = join(import.meta.dir, '../deployments');
const CONFIG_DIR = join(import.meta.dir, '../config');

// Load cross-chain configuration
interface CrossChainConfig {
  wormhole: Record<string, { core: string; chainId: number }>;
  hyperlane: Record<string, { mailbox: string; domain: number; igp: string }>;
  solanaPrograms: Record<string, string>;
  trustedEmitters: Record<string, { agentRegistry: string }>;
}

function loadCrossChainConfig(): CrossChainConfig {
  const configPath = join(CONFIG_DIR, 'cross-chain.json');
  if (!existsSync(configPath)) {
    throw new Error(`Cross-chain config not found: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

// Map network names to cross-chain config keys
const NETWORK_TO_CONFIG: Record<string, string> = {
  localnet: 'baseSepolia', // Use Base Sepolia config for localnet testing
  testnet: 'baseSepolia',
  mainnet: 'base',
};

interface FederationDeployment {
  networkRegistry: string;
  registryHub: string;
  registrySyncOracle: string;
  solanaVerifier: string;
  crossChainIdentitySync: string;
  federatedIdentity: string;
  federatedLiquidity: string;
  federatedSolver: string;
  deployedAt: string;
  deployer: string;
  chainId: number;
  wormholeCore: string;
  hyperlaneMailbox: string;
  hyperlaneDomain: number;
}

function getArtifact(contractName: string): { abi: Abi; bytecode: `0x${string}` } {
  const artifactPath = join(OUT_DIR, `${contractName}.sol`, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8')) as RawArtifactJson;
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  };
}

async function deployContract(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  contractName: string,
  args: ConstructorArg[] = []
): Promise<{ address: Address; abi: Abi }> {
  const { abi, bytecode } = getArtifact(contractName);
  
  console.log(`  Deploying ${contractName}...`);
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const address = receipt.contractAddress as Address;
  console.log(`  ✓ ${contractName}: ${address}`);
  
  return { address, abi };
}

async function main() {
  console.log(`\n🌐 Deploying Federation Contracts (${NETWORK})\n`);

  // Get RPC URL based on network
  const rpcUrls: Record<string, string> = {
    localnet: 'http://localhost:6546',
    testnet: process.env.TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
    mainnet: process.env.MAINNET_RPC_URL || 'https://rpc.jejunetwork.org',
  };

  const rpcUrl = rpcUrls[NETWORK];
  if (!rpcUrl) {
    throw new Error(`Unknown network: ${NETWORK}`);
  }

  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();
  
  // Get deployer wallet
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Default Anvil key
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, transport: http(rpcUrl) });
  
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Network: ${NETWORK} (chainId: ${chainId})`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${account.address}`);
  console.log(`Balance: ${formatEther(balance)}\n`);

  // Deploy contracts
  console.log('Deploying federation contracts...\n');

  // 1. NetworkRegistry
  const networkRegistry = await deployContract(walletClient, publicClient, 'NetworkRegistry', [account.address]);

  // 2. RegistryHub
  const registryHub = await deployContract(walletClient, publicClient, 'RegistryHub', [account.address]);

  // 3. RegistrySyncOracle
  const registrySyncOracle = await deployContract(walletClient, publicClient, 'RegistrySyncOracle', []);

  // 4. SolanaVerifier
  const solanaVerifier = await deployContract(walletClient, publicClient, 'SolanaVerifier', [
    account.address, // wormhole relayer (deployer for now)
    '0x0000000000000000000000000000000000000000000000000000000000000000', // trusted emitter
  ]);

  // 5. FederatedIdentity
  const federatedIdentity = await deployContract(walletClient, publicClient, 'FederatedIdentity', [
    BigInt(chainId),
    account.address, // oracle
    account.address, // governance
    networkRegistry.address,
    '0x0000000000000000000000000000000000000000', // local identity registry
  ]);

  // 6. FederatedLiquidity
  const federatedLiquidity = await deployContract(walletClient, publicClient, 'FederatedLiquidity', [
    BigInt(chainId),
    account.address, // oracle
    account.address, // governance
    networkRegistry.address,
    '0x0000000000000000000000000000000000000000', // local vault
  ]);

  // 7. FederatedSolver
  const federatedSolver = await deployContract(walletClient, publicClient, 'FederatedSolver', [
    BigInt(chainId),
    account.address, // oracle
    account.address, // governance
    networkRegistry.address,
    '0x0000000000000000000000000000000000000000', // local solver registry
  ]);

  // Save deployment addresses
  const deployment: FederationDeployment = {
    networkRegistry: networkRegistry.address,
    registryHub: registryHub.address,
    registrySyncOracle: registrySyncOracle.address,
    solanaVerifier: solanaVerifier.address,
    federatedIdentity: federatedIdentity.address,
    federatedLiquidity: federatedLiquidity.address,
    federatedSolver: federatedSolver.address,
    deployedAt: new Date().toISOString(),
    deployer: account.address,
    chainId,
  };

  // Ensure deployments directory exists
  const Bun = globalThis.Bun;
  if (Bun) {
    await Bun.write(
      join(DEPLOYMENTS_DIR, `federation-${NETWORK}.json`),
      JSON.stringify(deployment, null, 2)
    );
  } else {
    writeFileSync(
      join(DEPLOYMENTS_DIR, `federation-${NETWORK}.json`),
      JSON.stringify(deployment, null, 2)
    );
  }

  console.log('\n✅ Federation contracts deployed!\n');
  console.log('='.repeat(50));
  console.log('NetworkRegistry:     ', deployment.networkRegistry);
  console.log('RegistryHub:         ', deployment.registryHub);
  console.log('RegistrySyncOracle:  ', deployment.registrySyncOracle);
  console.log('SolanaVerifier:      ', deployment.solanaVerifier);
  console.log('FederatedIdentity:   ', deployment.federatedIdentity);
  console.log('FederatedLiquidity:  ', deployment.federatedLiquidity);
  console.log('FederatedSolver:     ', deployment.federatedSolver);
  console.log('='.repeat(50));
  console.log(`\nDeployment saved to: deployments/federation-${NETWORK}.json`);

  // If localnet, register Jeju as first network
  if (NETWORK === 'localnet') {
    console.log('\n📝 Registering Jeju Network in federation...\n');
    
    const contracts = [
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      '0x0000000000000000000000000000000000000000',
      deployment.registryHub,
    ] as const;

    const hash = await walletClient.writeContract({
      address: networkRegistry.address,
      abi: networkRegistry.abi,
      functionName: 'registerNetwork',
      args: [
        BigInt(chainId),
        'Jeju Localnet',
        rpcUrl,
        'http://localhost:4000',
        'ws://localhost:6547',
        contracts,
        '0x0000000000000000000000000000000000000000000000000000000000000000',
      ],
      value: parseEther('10'), // VERIFIED stake
    });
    await publicClient.waitForTransactionReceipt({ hash });
    
    console.log('✓ Jeju Network registered with VERIFIED status (10 ETH stake)');
    
    // Register the network in RegistryHub too
    const hash2 = await walletClient.writeContract({
      address: registryHub.address as Address,
      abi: registryHub.abi,
      functionName: 'registerChain',
      args: [
        BigInt(chainId),
        0, // ChainType.EVM
        'Jeju Localnet',
        rpcUrl,
      ],
      value: parseEther('10'),
    });
    await publicClient.waitForTransactionReceipt({ hash: hash2 });
    
    console.log('✓ Jeju registered in RegistryHub with VERIFIED tier');
  }

  return deployment;
}

main().catch(console.error);

