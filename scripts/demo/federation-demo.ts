#!/usr/bin/env bun
/**
 * Federation Demo Script
 * 
 * Demonstrates the complete federation flow:
 * 1. Deploy federation contracts
 * 2. Register the first network
 * 3. Register registries in the hub
 * 4. Query federation data via SDK
 * 5. Show cross-chain capabilities
 * 
 * Usage:
 *   bun run scripts/demo/federation-demo.ts
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Address, type Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ConstructorArg, RawArtifactJson } from '../shared/contract-types';

const CONTRACTS_DIR = join(import.meta.dir, '../../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');
const DEPLOYMENTS_DIR = join(import.meta.dir, '../../deployments');

// Default Anvil keys
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPERATOR1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const OPERATOR2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

interface ContractArtifact {
  abi: Abi;
  bytecode: `0x${string}`;
}

function getArtifact(contractName: string): ContractArtifact {
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
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { address: receipt.contractAddress as Address, abi };
}

function log(emoji: string, message: string) {
  console.log(`${emoji} ${message}`);
}

function section(title: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(60)}\n`);
}

async function main() {
  console.log('\n🌐 JEJU FEDERATION DEMO\n');

  // Setup
  const rpcUrl = process.env.RPC_URL || 'http://localhost:6546';
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  
  const deployerAccount = privateKeyToAccount(DEPLOYER_KEY as `0x${string}`);
  const operator1Account = privateKeyToAccount(OPERATOR1_KEY as `0x${string}`);
  const operator2Account = privateKeyToAccount(OPERATOR2_KEY as `0x${string}`);
  
  const deployerWallet = createWalletClient({ account: deployerAccount, transport: http(rpcUrl) });
  const operator1Wallet = createWalletClient({ account: operator1Account, transport: http(rpcUrl) });
  const operator2Wallet = createWalletClient({ account: operator2Account, transport: http(rpcUrl) });

  const chainId = await publicClient.getChainId();
  const balance = await publicClient.getBalance({ address: deployerAccount.address });
  
  log('🔗', `Connected to chain ${chainId} at ${rpcUrl}`);
  log('💰', `Deployer balance: ${formatEther(balance)} ETH`);

  // ============================================================================
  // STEP 1: Deploy Federation Contracts
  // ============================================================================
  section('STEP 1: Deploy Federation Contracts');

  log('📦', 'Deploying NetworkRegistry...');
  const networkRegistry = await deployContract(deployerWallet, publicClient, 'NetworkRegistry', [deployerAccount.address]);
  log('✓', `NetworkRegistry: ${networkRegistry.address}`);

  log('📦', 'Deploying RegistryHub...');
  const registryHub = await deployContract(deployerWallet, publicClient, 'RegistryHub', [deployerAccount.address]);
  log('✓', `RegistryHub: ${registryHub.address}`);

  log('📦', 'Deploying RegistrySyncOracle...');
  const syncOracle = await deployContract(deployerWallet, publicClient, 'RegistrySyncOracle', []);
  log('✓', `RegistrySyncOracle: ${syncOracle.address}`);

  log('📦', 'Deploying SolanaVerifier...');
  const solanaVerifier = await deployContract(deployerWallet, publicClient, 'SolanaVerifier', [
    deployerAccount.address,
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ]);
  log('✓', `SolanaVerifier: ${solanaVerifier.address}`);

  // ============================================================================
  // STEP 2: Register Networks
  // ============================================================================
  section('STEP 2: Register Networks in Federation');

  // Network 1: Jeju (VERIFIED - 10 ETH)
  log('📝', 'Registering Jeju Network (VERIFIED tier - 10 ETH stake)...');
  const contracts1 = [
    '0x0000000000000000000000000000000000000001',
    '0x0000000000000000000000000000000000000002',
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
    '0x0000000000000000000000000000000000000005',
    '0x0000000000000000000000000000000000000006',
    '0x0000000000000000000000000000000000000007',
    registryHub.address,
  ] as const;
  
  const tx1 = await deployerWallet.writeContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'registerNetwork',
    args: [
      420690n, // Jeju Testnet
      'Jeju Network',
      'https://testnet-rpc.jejunetwork.org',
      'https://testnet-explorer.jejunetwork.org',
      'wss://testnet-ws.jejunetwork.org',
      contracts1,
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ],
    value: parseEther('10'),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx1 });
  log('✓', 'Jeju Network registered as VERIFIED');

  // Network 2: Fork Network (STAKED - 1 ETH)
  log('📝', 'Registering Fork Network (STAKED tier - 1 ETH stake)...');
  const zeroContracts = contracts1.map(() => '0x0000000000000000000000000000000000000000') as unknown as readonly Address[];
  const tx2 = await operator1Wallet.writeContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'registerNetwork',
    args: [
      420691n, // Fork network
      'My Fork Network',
      'https://rpc.myfork.network',
      'https://explorer.myfork.network',
      'wss://ws.myfork.network',
      zeroContracts,
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    ],
    value: parseEther('1'),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx2 });
  log('✓', 'Fork Network registered as STAKED');

  // Network 3: Test Network (UNSTAKED - 0 ETH)
  log('📝', 'Registering Test Network (UNSTAKED tier - 0 ETH stake)...');
  const tx3 = await operator2Wallet.writeContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'registerNetwork',
    args: [
      420692n, // Test network
      'Test Network',
      'https://rpc.test.network',
      'https://explorer.test.network',
      '',
      zeroContracts,
      '0x0000000000000000000000000000000000000000000000000000000000000003',
    ],
    value: 0n,
  });
  await publicClient.waitForTransactionReceipt({ hash: tx3 });
  log('✓', 'Test Network registered as UNSTAKED');

  // ============================================================================
  // STEP 3: Register in RegistryHub
  // ============================================================================
  section('STEP 3: Register Chains and Registries in Hub');

  // Register chains in hub
  log('📝', 'Registering Jeju in RegistryHub...');
  const tx4 = await deployerWallet.writeContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'registerChain',
    args: [420690n, 0, 'Jeju Network', 'https://testnet-rpc.jejunetwork.org'],
    value: parseEther('10'),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx4 });
  log('✓', 'Jeju registered in hub as VERIFIED');

  // Register Solana
  log('📝', 'Registering Solana in RegistryHub...');
  const tx5 = await deployerWallet.writeContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'registerSolanaRegistry',
    args: [
      '0x0000000000000000000000000000000000000000000000000000000000000001', // Fake program ID
      0, // IDENTITY type
      'Solana Identity Registry',
      'ipfs://QmSolanaRegistry',
    ],
    value: parseEther('1'),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx5 });
  log('✓', 'Solana identity registry registered');

  // Register a registry for Jeju
  log('📝', 'Registering Jeju IdentityRegistry in hub...');
  const tx6 = await deployerWallet.writeContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'registerRegistry',
    args: [
      420690n,
      0, // IDENTITY
      '0x' + '00'.repeat(31) + '01', // Padded address
      'Jeju Identity Registry',
      '1.0.0',
      'ipfs://QmJejuIdentity',
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash: tx6 });
  log('✓', 'Jeju IdentityRegistry registered');

  // ============================================================================
  // STEP 4: Query Federation Data
  // ============================================================================
  section('STEP 4: Query Federation Data');

  // Get all networks
  const networkIds = await publicClient.readContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'getAllNetworkIds',
  }) as bigint[];
  log('📊', `Total networks registered: ${networkIds.length}`);

  type NetworkResult = { name: string; trustTier: number; stake: bigint };
  for (const id of networkIds) {
    const network = await publicClient.readContract({
      address: networkRegistry.address,
      abi: networkRegistry.abi,
      functionName: 'getNetwork',
      args: [id],
    }) as NetworkResult;
    const tierNames = ['UNSTAKED', 'STAKED', 'VERIFIED'];
    const canVote = await publicClient.readContract({
      address: networkRegistry.address,
      abi: networkRegistry.abi,
      functionName: 'canParticipateInConsensus',
      args: [id],
    }) as boolean;
    const canSequence = await publicClient.readContract({
      address: networkRegistry.address,
      abi: networkRegistry.abi,
      functionName: 'isSequencerEligible',
      args: [id],
    }) as boolean;
    
    console.log(`\n  Network: ${network.name} (${id})`);
    console.log(`    Tier: ${tierNames[network.trustTier]}`);
    console.log(`    Stake: ${formatEther(network.stake)} ETH`);
    console.log(`    Can Vote: ${canVote}`);
    console.log(`    Can Sequence: ${canSequence}`);
  }

  // Get hub stats
  const totalChains = await publicClient.readContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'totalChains',
  }) as bigint;
  const totalRegistries = await publicClient.readContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'totalRegistries',
  }) as bigint;
  const totalStaked = await publicClient.readContract({
    address: registryHub.address,
    abi: registryHub.abi,
    functionName: 'totalStaked',
  }) as bigint;

  console.log(`\n  Registry Hub Stats:`);
  console.log(`    Total Chains: ${totalChains}`);
  console.log(`    Total Registries: ${totalRegistries}`);
  console.log(`    Total Staked: ${formatEther(totalStaked)} ETH`);

  // ============================================================================
  // STEP 5: Demonstrate Trust Tiers
  // ============================================================================
  section('STEP 5: Trust Tier Capabilities');

  console.log('  UNSTAKED (0 ETH):');
  console.log('    ❌ Cannot participate in federation consensus');
  console.log('    ❌ Cannot run shared sequencer');
  console.log('    ❌ Cannot receive delegated liquidity');
  console.log('    ✅ Can be listed in registry');
  console.log('    ✅ Can use OIF for cross-chain intents (user pays)');

  console.log('\n  STAKED (1+ ETH):');
  console.log('    ✅ Federation consensus participation');
  console.log('    ✅ Cross-chain identity verification');
  console.log('    ✅ Solver network access');
  console.log('    ✅ Delegated liquidity (with collateral)');
  console.log('    ❌ Cannot run shared sequencer');

  console.log('\n  VERIFIED (10+ ETH):');
  console.log('    ✅ All STAKED capabilities');
  console.log('    ✅ Sequencer rotation eligibility');
  console.log('    ✅ Priority in solver routing');
  console.log('    ✅ Governance voting rights');

  // ============================================================================
  // STEP 6: Upgrade Trust Tier
  // ============================================================================
  section('STEP 6: Upgrade Trust Tier');

  log('📈', 'Upgrading Test Network from UNSTAKED to STAKED...');
  const tx7 = await operator2Wallet.writeContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'addStake',
    args: [420692n],
    value: parseEther('1'),
  });
  await publicClient.waitForTransactionReceipt({ hash: tx7 });
  
  const upgraded = await publicClient.readContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'getNetwork',
    args: [420692n],
  }) as NetworkResult;
  const canVoteNow = await publicClient.readContract({
    address: networkRegistry.address,
    abi: networkRegistry.abi,
    functionName: 'canParticipateInConsensus',
    args: [420692n],
  }) as boolean;
  log('✓', `Test Network upgraded to ${['UNSTAKED', 'STAKED', 'VERIFIED'][upgraded.trustTier]}`);
  log('✓', `Can now participate in consensus: ${canVoteNow}`);

  // ============================================================================
  // Save Deployment
  // ============================================================================
  section('DEPLOYMENT SUMMARY');

  const deployment = {
    networkRegistry: networkRegistry.address,
    registryHub: registryHub.address,
    registrySyncOracle: syncOracle.address,
    solanaVerifier: solanaVerifier.address,
    deployedAt: new Date().toISOString(),
    chainId: Number(chainId),
  };

  // Ensure deployments directory exists
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  writeFileSync(
    join(DEPLOYMENTS_DIR, 'federation-demo.json'),
    JSON.stringify(deployment, null, 2)
  );

  console.log('Deployed Contracts:');
  console.log(`  NetworkRegistry:    ${deployment.networkRegistry}`);
  console.log(`  RegistryHub:        ${deployment.registryHub}`);
  console.log(`  RegistrySyncOracle: ${deployment.registrySyncOracle}`);
  console.log(`  SolanaVerifier:     ${deployment.solanaVerifier}`);
  console.log(`\nSaved to: deployments/federation-demo.json`);

  console.log('\n✅ Federation demo complete!\n');
  console.log('Next steps:');
  console.log('  1. Deploy to testnet: bun run scripts/deploy-federation.ts --network testnet');
  console.log('  2. Use SDK: import { createFederationClient } from "@jejunetwork/sdk"');
  console.log('  3. Run CLI: jeju federation status');
}

main().catch(console.error);

