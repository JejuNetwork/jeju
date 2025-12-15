#!/usr/bin/env bun
/**
 * Deploy Governance Infrastructure
 *
 * Deploys:
 * 1. DelegationRegistry - Vote delegation and security council
 * 2. CircuitBreaker - Emergency pause system
 * 3. CouncilSafeModule - AI CEO signing module
 * 4. Gnosis Safe - Multi-sig treasury
 *
 * Usage:
 *   bun scripts/deploy-governance.ts --network localnet
 *   bun scripts/deploy-governance.ts --network testnet
 *   bun scripts/deploy-governance.ts --network mainnet
 */

import { ethers, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Configuration
interface NetworkConfig {
  rpcUrl: string;
  chainId: number;
  safeFactory: string;
  safeSingleton: string;
  safeFallbackHandler: string;
  explorerUrl: string;
}

interface DeployedAddresses {
  delegationRegistry: string;
  circuitBreaker: string;
  councilSafeModule: string;
  safe: string;
  council: string;
  identityRegistry: string;
  reputationRegistry: string;
  governanceToken: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    rpcUrl: process.env.LOCALNET_RPC_URL ?? 'http://localhost:8545',
    chainId: 31337,
    safeFactory: '0x0000000000000000000000000000000000000000',
    safeSingleton: '0x0000000000000000000000000000000000000000',
    safeFallbackHandler: '0x0000000000000000000000000000000000000000',
    explorerUrl: '',
  },
  testnet: {
    rpcUrl: process.env.TESTNET_RPC_URL ?? 'https://sepolia.base.org',
    chainId: 84532,
    safeFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
    safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
    safeFallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
    explorerUrl: 'https://sepolia.basescan.org',
  },
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC_URL ?? 'https://mainnet.base.org',
    chainId: 8453,
    safeFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
    safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
    safeFallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
    explorerUrl: 'https://basescan.org',
  },
};

// Contract ABIs (minimal for deployment)
const DELEGATION_REGISTRY_ABI = [
  'constructor(address governanceToken, address identityRegistry, address reputationRegistry, address initialOwner)',
  'function version() view returns (string)',
];

const CIRCUIT_BREAKER_ABI = [
  'constructor(address safe, address delegationRegistry, address initialOwner)',
  'function version() view returns (string)',
  'function registerContract(address target, string name, uint256 priority)',
];

const COUNCIL_SAFE_MODULE_ABI = [
  'constructor(address safe, address council, address teeOperator, bytes32 trustedMeasurement, address initialOwner)',
  'function version() view returns (string)',
];

const SAFE_FACTORY_ABI = [
  'function createProxyWithNonce(address singleton, bytes memory initializer, uint256 saltNonce) returns (address proxy)',
];

const SAFE_ABI = [
  'function setup(address[] calldata owners, uint256 threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)',
  'function enableModule(address module)',
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
];

// Parse arguments
const args = process.argv.slice(2);
const networkArg = args.find((a) => a.startsWith('--network='))?.split('=')[1] ?? 'localnet';
const dryRun = args.includes('--dry-run');

if (!NETWORKS[networkArg]) {
  console.error(`Unknown network: ${networkArg}`);
  console.error('Available networks:', Object.keys(NETWORKS).join(', '));
  process.exit(1);
}

const network = NETWORKS[networkArg];

async function main() {
  console.log(`\n🏛️  Deploying Governance Infrastructure to ${networkArg}`);
  console.log('='.repeat(60));

  // Load private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
  }

  const provider = new JsonRpcProvider(network.rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  console.log(`\nDeployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.1')) {
    console.warn('⚠️  Low balance, deployment may fail');
  }

  // Load existing addresses
  const addressesPath = join(process.cwd(), 'config', 'addresses', `${networkArg}.json`);
  let existingAddresses: Partial<DeployedAddresses> = {};

  if (existsSync(addressesPath)) {
    existingAddresses = JSON.parse(readFileSync(addressesPath, 'utf-8')) as Partial<DeployedAddresses>;
    console.log('\nLoaded existing addresses:');
    console.log(JSON.stringify(existingAddresses, null, 2));
  }

  // Get required addresses
  const governanceToken = existingAddresses.governanceToken ?? process.env.GOVERNANCE_TOKEN_ADDRESS;
  const identityRegistry = existingAddresses.identityRegistry ?? process.env.IDENTITY_REGISTRY_ADDRESS;
  const reputationRegistry = existingAddresses.reputationRegistry ?? process.env.REPUTATION_REGISTRY_ADDRESS;
  const council = existingAddresses.council ?? process.env.COUNCIL_ADDRESS;

  if (!governanceToken || !identityRegistry || !reputationRegistry || !council) {
    console.error('\nMissing required contract addresses:');
    if (!governanceToken) console.error('  - GOVERNANCE_TOKEN_ADDRESS');
    if (!identityRegistry) console.error('  - IDENTITY_REGISTRY_ADDRESS');
    if (!reputationRegistry) console.error('  - REPUTATION_REGISTRY_ADDRESS');
    if (!council) console.error('  - COUNCIL_ADDRESS');
    console.error('\nSet these in environment or deploy base contracts first.');
    process.exit(1);
  }

  const deployedAddresses: DeployedAddresses = {
    governanceToken,
    identityRegistry,
    reputationRegistry,
    council,
    delegationRegistry: '',
    circuitBreaker: '',
    councilSafeModule: '',
    safe: '',
  };

  if (dryRun) {
    console.log('\n🔍 DRY RUN - No transactions will be sent');
  }

  // Step 1: Deploy Safe (multi-sig)
  console.log('\n📦 Step 1: Deploying Gnosis Safe...');

  if (network.safeFactory !== '0x0000000000000000000000000000000000000000') {
    const safeFactory = new ethers.Contract(network.safeFactory, SAFE_FACTORY_ABI, wallet);

    // Initial owners: deployer + 2 additional signers from env
    const signer2 = process.env.SAFE_SIGNER_2 ?? wallet.address;
    const signer3 = process.env.SAFE_SIGNER_3 ?? wallet.address;
    const owners = [wallet.address, signer2, signer3].filter((v, i, a) => a.indexOf(v) === i);
    const threshold = Math.min(2, owners.length);

    console.log(`  Owners (${owners.length}):`, owners);
    console.log(`  Threshold: ${threshold}`);

    // Encode setup call
    const safeInterface = new ethers.Interface(SAFE_ABI);
    const setupData = safeInterface.encodeFunctionData('setup', [
      owners,
      threshold,
      ethers.ZeroAddress, // to
      '0x', // data
      network.safeFallbackHandler,
      ethers.ZeroAddress, // paymentToken
      0, // payment
      ethers.ZeroAddress, // paymentReceiver
    ]);

    const saltNonce = Date.now();

    if (!dryRun) {
      const tx = await safeFactory.createProxyWithNonce(network.safeSingleton, setupData, saltNonce);
      const receipt = await tx.wait();

      // Parse ProxyCreation event
      const proxyCreatedTopic = ethers.id('ProxyCreation(address,address)');
      const proxyEvent = receipt.logs.find((l: { topics: string[] }) => l.topics[0] === proxyCreatedTopic);
      if (proxyEvent) {
        deployedAddresses.safe = ethers.getAddress('0x' + proxyEvent.topics[1].slice(26));
      }

      console.log(`  ✅ Safe deployed: ${deployedAddresses.safe}`);
    } else {
      console.log('  [DRY RUN] Would deploy Safe with owners:', owners);
    }
  } else {
    console.log('  ⚠️  Skipping Safe deployment on localnet (no factory)');
    deployedAddresses.safe = wallet.address; // Use deployer as "Safe" for localnet
  }

  // Step 2: Deploy DelegationRegistry
  console.log('\n📦 Step 2: Deploying DelegationRegistry...');

  const delegationBytecode = await loadBytecode('DelegationRegistry');
  const delegationFactory = new ethers.ContractFactory(DELEGATION_REGISTRY_ABI, delegationBytecode, wallet);

  if (!dryRun) {
    const delegationRegistry = await delegationFactory.deploy(
      governanceToken,
      identityRegistry,
      reputationRegistry,
      wallet.address
    );
    await delegationRegistry.waitForDeployment();
    deployedAddresses.delegationRegistry = await delegationRegistry.getAddress();
    console.log(`  ✅ DelegationRegistry: ${deployedAddresses.delegationRegistry}`);
  } else {
    console.log('  [DRY RUN] Would deploy DelegationRegistry');
  }

  // Step 3: Deploy CircuitBreaker
  console.log('\n📦 Step 3: Deploying CircuitBreaker...');

  const circuitBreakerBytecode = await loadBytecode('CircuitBreaker');
  const circuitBreakerFactory = new ethers.ContractFactory(CIRCUIT_BREAKER_ABI, circuitBreakerBytecode, wallet);

  if (!dryRun) {
    const circuitBreaker = await circuitBreakerFactory.deploy(
      deployedAddresses.safe,
      deployedAddresses.delegationRegistry,
      wallet.address
    );
    await circuitBreaker.waitForDeployment();
    deployedAddresses.circuitBreaker = await circuitBreaker.getAddress();
    console.log(`  ✅ CircuitBreaker: ${deployedAddresses.circuitBreaker}`);

    // Register Council contract for protection
    const cb = new ethers.Contract(deployedAddresses.circuitBreaker, CIRCUIT_BREAKER_ABI, wallet);
    const registerTx = await cb.registerContract(council, 'Council', 1);
    await registerTx.wait();
    console.log('  ✅ Registered Council for circuit breaker protection');
  } else {
    console.log('  [DRY RUN] Would deploy CircuitBreaker');
  }

  // Step 4: Deploy CouncilSafeModule
  console.log('\n📦 Step 4: Deploying CouncilSafeModule...');

  const teeOperator = process.env.TEE_OPERATOR_ADDRESS ?? wallet.address;
  const trustedMeasurement = process.env.TRUSTED_MEASUREMENT ?? ethers.ZeroHash;

  const councilModuleBytecode = await loadBytecode('CouncilSafeModule');
  const councilModuleFactory = new ethers.ContractFactory(COUNCIL_SAFE_MODULE_ABI, councilModuleBytecode, wallet);

  if (!dryRun) {
    const councilModule = await councilModuleFactory.deploy(
      deployedAddresses.safe,
      council,
      teeOperator,
      trustedMeasurement,
      wallet.address
    );
    await councilModule.waitForDeployment();
    deployedAddresses.councilSafeModule = await councilModule.getAddress();
    console.log(`  ✅ CouncilSafeModule: ${deployedAddresses.councilSafeModule}`);
  } else {
    console.log('  [DRY RUN] Would deploy CouncilSafeModule');
  }

  // Step 5: Enable module on Safe
  if (!dryRun && deployedAddresses.safe !== wallet.address) {
    console.log('\n📦 Step 5: Enabling module on Safe...');
    console.log('  ⚠️  Manual step required: Call enableModule on Safe');
    console.log(`     Safe: ${deployedAddresses.safe}`);
    console.log(`     Module: ${deployedAddresses.councilSafeModule}`);
    console.log('     Use Safe UI or CLI to add the module');
  }

  // Save addresses
  if (!dryRun) {
    const outputDir = join(process.cwd(), 'config', 'addresses');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(addressesPath, JSON.stringify(deployedAddresses, null, 2));
    console.log(`\n📝 Saved addresses to ${addressesPath}`);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log(`Network: ${networkArg} (Chain ID: ${network.chainId})`);
  console.log('\nDeployed Contracts:');
  console.log(`  Safe:               ${deployedAddresses.safe}`);
  console.log(`  DelegationRegistry: ${deployedAddresses.delegationRegistry}`);
  console.log(`  CircuitBreaker:     ${deployedAddresses.circuitBreaker}`);
  console.log(`  CouncilSafeModule:  ${deployedAddresses.councilSafeModule}`);

  if (network.explorerUrl) {
    console.log('\nExplorer Links:');
    if (deployedAddresses.safe) console.log(`  Safe: ${network.explorerUrl}/address/${deployedAddresses.safe}`);
    if (deployedAddresses.delegationRegistry)
      console.log(`  Delegation: ${network.explorerUrl}/address/${deployedAddresses.delegationRegistry}`);
    if (deployedAddresses.circuitBreaker)
      console.log(`  CircuitBreaker: ${network.explorerUrl}/address/${deployedAddresses.circuitBreaker}`);
    if (deployedAddresses.councilSafeModule)
      console.log(`  SafeModule: ${network.explorerUrl}/address/${deployedAddresses.councilSafeModule}`);
  }

  console.log('\n✅ Governance deployment complete!');

  if (!dryRun) {
    console.log('\n📌 NEXT STEPS:');
    console.log('1. Enable CouncilSafeModule on Safe via Safe UI');
    console.log('2. Add additional Safe signers if needed');
    console.log('3. Register delegates in DelegationRegistry');
    console.log('4. Update security council via updateSecurityCouncil()');
    console.log('5. Configure TEE operator and trusted measurement');
  }
}

async function loadBytecode(contractName: string): Promise<string> {
  // Try to load from forge artifacts
  const artifactPaths = [
    join(process.cwd(), 'packages', 'contracts', 'out', `${contractName}.sol`, `${contractName}.json`),
    join(process.cwd(), 'out', `${contractName}.sol`, `${contractName}.json`),
  ];

  for (const path of artifactPaths) {
    if (existsSync(path)) {
      const artifact = JSON.parse(readFileSync(path, 'utf-8')) as { bytecode: { object: string } };
      return artifact.bytecode.object;
    }
  }

  throw new Error(
    `Bytecode not found for ${contractName}. Run 'forge build' in packages/contracts first.`
  );
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error);
  process.exit(1);
});

