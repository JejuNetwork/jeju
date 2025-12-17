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

import { Wallet, JsonRpcProvider, Contract, ContractFactory, parseEther, formatEther } from 'ethers';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const CONTRACTS_DIR = join(import.meta.dir, '../../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');
const DEPLOYMENTS_DIR = join(import.meta.dir, '../../deployments');

// Default Anvil keys
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const OPERATOR1_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const OPERATOR2_KEY = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

interface ContractArtifact {
  abi: unknown[];
  bytecode: string;
}

function getArtifact(contractName: string): ContractArtifact {
  const artifactPath = join(OUT_DIR, `${contractName}.sol`, `${contractName}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
  };
}

async function deployContract(
  wallet: Wallet,
  contractName: string,
  args: unknown[] = []
): Promise<Contract> {
  const { abi, bytecode } = getArtifact(contractName);
  const factory = new ContractFactory(abi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return new Contract(await contract.getAddress(), abi, wallet);
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
  const rpcUrl = process.env.RPC_URL || 'http://localhost:9545';
  const provider = new JsonRpcProvider(rpcUrl);
  
  const deployer = new Wallet(DEPLOYER_KEY, provider);
  const operator1 = new Wallet(OPERATOR1_KEY, provider);
  const operator2 = new Wallet(OPERATOR2_KEY, provider);

  const chainId = Number((await provider.getNetwork()).chainId);
  
  log('🔗', `Connected to chain ${chainId} at ${rpcUrl}`);
  log('💰', `Deployer balance: ${formatEther(await provider.getBalance(deployer.address))} ETH`);

  // ============================================================================
  // STEP 1: Deploy Federation Contracts
  // ============================================================================
  section('STEP 1: Deploy Federation Contracts');

  log('📦', 'Deploying NetworkRegistry...');
  const networkRegistry = await deployContract(deployer, 'NetworkRegistry', [deployer.address]);
  log('✓', `NetworkRegistry: ${await networkRegistry.getAddress()}`);

  log('📦', 'Deploying RegistryHub...');
  const registryHub = await deployContract(deployer, 'RegistryHub', [deployer.address]);
  log('✓', `RegistryHub: ${await registryHub.getAddress()}`);

  log('📦', 'Deploying RegistrySyncOracle...');
  const syncOracle = await deployContract(deployer, 'RegistrySyncOracle', []);
  log('✓', `RegistrySyncOracle: ${await syncOracle.getAddress()}`);

  log('📦', 'Deploying SolanaVerifier...');
  const solanaVerifier = await deployContract(deployer, 'SolanaVerifier', [
    deployer.address,
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  ]);
  log('✓', `SolanaVerifier: ${await solanaVerifier.getAddress()}`);

  // ============================================================================
  // STEP 2: Register Networks
  // ============================================================================
  section('STEP 2: Register Networks in Federation');

  // Network 1: Jeju (VERIFIED - 10 ETH)
  log('📝', 'Registering Jeju Network (VERIFIED tier - 10 ETH stake)...');
  const contracts1 = {
    identityRegistry: '0x0000000000000000000000000000000000000001',
    solverRegistry: '0x0000000000000000000000000000000000000002',
    inputSettler: '0x0000000000000000000000000000000000000003',
    outputSettler: '0x0000000000000000000000000000000000000004',
    liquidityVault: '0x0000000000000000000000000000000000000005',
    governance: '0x0000000000000000000000000000000000000006',
    oracle: '0x0000000000000000000000000000000000000007',
    registryHub: await registryHub.getAddress(),
  };
  
  await networkRegistry.registerNetwork(
    420690, // Jeju Testnet
    'Jeju Network',
    'https://testnet-rpc.jejunetwork.org',
    'https://testnet-explorer.jejunetwork.org',
    'wss://testnet-ws.jejunetwork.org',
    Object.values(contracts1),
    '0x0000000000000000000000000000000000000000000000000000000000000001',
    { value: parseEther('10') }
  );
  log('✓', 'Jeju Network registered as VERIFIED');

  // Network 2: Fork Network (STAKED - 1 ETH)
  log('📝', 'Registering Fork Network (STAKED tier - 1 ETH stake)...');
  const networkRegistry2 = networkRegistry.connect(operator1);
  await networkRegistry2.registerNetwork(
    420691, // Fork network
    'My Fork Network',
    'https://rpc.myfork.network',
    'https://explorer.myfork.network',
    'wss://ws.myfork.network',
    Object.values(contracts1).map(() => '0x0000000000000000000000000000000000000000'),
    '0x0000000000000000000000000000000000000000000000000000000000000002',
    { value: parseEther('1') }
  );
  log('✓', 'Fork Network registered as STAKED');

  // Network 3: Test Network (UNSTAKED - 0 ETH)
  log('📝', 'Registering Test Network (UNSTAKED tier - 0 ETH stake)...');
  const networkRegistry3 = networkRegistry.connect(operator2);
  await networkRegistry3.registerNetwork(
    420692, // Test network
    'Test Network',
    'https://rpc.test.network',
    'https://explorer.test.network',
    '',
    Object.values(contracts1).map(() => '0x0000000000000000000000000000000000000000'),
    '0x0000000000000000000000000000000000000000000000000000000000000003',
    { value: 0 }
  );
  log('✓', 'Test Network registered as UNSTAKED');

  // ============================================================================
  // STEP 3: Register in RegistryHub
  // ============================================================================
  section('STEP 3: Register Chains and Registries in Hub');

  // Register chains in hub
  log('📝', 'Registering Jeju in RegistryHub...');
  await registryHub.registerChain(
    420690,
    0, // EVM
    'Jeju Network',
    'https://testnet-rpc.jejunetwork.org',
    { value: parseEther('10') }
  );
  log('✓', 'Jeju registered in hub as VERIFIED');

  // Register Solana
  log('📝', 'Registering Solana in RegistryHub...');
  await registryHub.registerSolanaRegistry(
    '0x0000000000000000000000000000000000000000000000000000000000000001', // Fake program ID
    0, // IDENTITY type
    'Solana Identity Registry',
    'ipfs://QmSolanaRegistry',
    { value: parseEther('1') }
  );
  log('✓', 'Solana identity registry registered');

  // Register a registry for Jeju
  log('📝', 'Registering Jeju IdentityRegistry in hub...');
  await registryHub.registerRegistry(
    420690,
    0, // IDENTITY
    '0x' + '00'.repeat(31) + '01', // Padded address
    'Jeju Identity Registry',
    '1.0.0',
    'ipfs://QmJejuIdentity'
  );
  log('✓', 'Jeju IdentityRegistry registered');

  // ============================================================================
  // STEP 4: Query Federation Data
  // ============================================================================
  section('STEP 4: Query Federation Data');

  // Get all networks
  const networkIds = await networkRegistry.getAllNetworkIds();
  log('📊', `Total networks registered: ${networkIds.length}`);

  for (const id of networkIds) {
    const network = await networkRegistry.getNetwork(id);
    const tierNames = ['UNSTAKED', 'STAKED', 'VERIFIED'];
    const canVote = await networkRegistry.canParticipateInConsensus(id);
    const canSequence = await networkRegistry.isSequencerEligible(id);
    
    console.log(`\n  Network: ${network.name} (${id})`);
    console.log(`    Tier: ${tierNames[network.trustTier]}`);
    console.log(`    Stake: ${formatEther(network.stake)} ETH`);
    console.log(`    Can Vote: ${canVote}`);
    console.log(`    Can Sequence: ${canSequence}`);
  }

  // Get hub stats
  const totalChains = await registryHub.totalChains();
  const totalRegistries = await registryHub.totalRegistries();
  const totalStaked = await registryHub.totalStaked();

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
  const networkRegistry3Connected = networkRegistry.connect(operator2);
  await networkRegistry3Connected.addStake(420692, { value: parseEther('1') });
  
  const upgraded = await networkRegistry.getNetwork(420692);
  const canVoteNow = await networkRegistry.canParticipateInConsensus(420692);
  log('✓', `Test Network upgraded to ${['UNSTAKED', 'STAKED', 'VERIFIED'][upgraded.trustTier]}`);
  log('✓', `Can now participate in consensus: ${canVoteNow}`);

  // ============================================================================
  // Save Deployment
  // ============================================================================
  section('DEPLOYMENT SUMMARY');

  const deployment = {
    networkRegistry: await networkRegistry.getAddress(),
    registryHub: await registryHub.getAddress(),
    registrySyncOracle: await syncOracle.getAddress(),
    solanaVerifier: await solanaVerifier.getAddress(),
    deployedAt: new Date().toISOString(),
    chainId,
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

