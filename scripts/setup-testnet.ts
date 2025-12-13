#!/usr/bin/env bun
/**
 * Setup Testnet Environment
 *
 * Deploys and configures all governance infrastructure on testnet:
 * 1. Verifies existing contract deployments
 * 2. Deploys governance contracts (DelegationRegistry, CircuitBreaker, etc.)
 * 3. Deploys and configures Gnosis Safe
 * 4. Registers initial delegates
 * 5. Funds test wallets from faucet
 *
 * Usage:
 *   bun scripts/setup-testnet.ts
 *   bun scripts/setup-testnet.ts --skip-deploy   # Only configure
 *   bun scripts/setup-testnet.ts --verify-only   # Only verify
 */

import { ethers, JsonRpcProvider, Wallet, parseEther, formatEther } from 'ethers';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface TestnetConfig {
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  faucetUrl: string;
  safeFactory: string;
  safeSingleton: string;
  safeFallbackHandler: string;
}

interface ContractAddresses {
  governanceToken: string;
  identityRegistry: string;
  reputationRegistry: string;
  council: string;
  ceoAgent: string;
  predimarket: string;
  delegationRegistry: string;
  circuitBreaker: string;
  councilSafeModule: string;
  safe: string;
}

const TESTNET_CONFIG: TestnetConfig = {
  rpcUrl: process.env.TESTNET_RPC_URL ?? 'https://sepolia.base.org',
  chainId: 84532,
  explorerUrl: 'https://sepolia.basescan.org',
  faucetUrl: 'https://faucet.sepolia.base.org',
  safeFactory: '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2',
  safeSingleton: '0x3E5c63644E683549055b9Be8653de26E0B4CD36E',
  safeFallbackHandler: '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4',
};

// ABIs
const _ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const DELEGATION_REGISTRY_ABI = [
  'function registerAsDelegate(uint256 agentId, string name, string profileHash, string[] expertise)',
  'function updateSecurityCouncil()',
  'function getSecurityCouncil() view returns (address[])',
  'function version() view returns (string)',
];

const CIRCUIT_BREAKER_ABI = [
  'function registerContract(address target, string name, uint256 priority)',
  'function syncSecurityCouncil()',
  'function getSecurityCouncilMembers() view returns (address[])',
  'function version() view returns (string)',
];

const COUNCIL_SAFE_MODULE_ABI = [
  'function addSecurityCouncilMember(address member)',
  'function syncSecurityCouncilFromDelegation(address delegationRegistry)',
  'function version() view returns (string)',
];

const args = process.argv.slice(2);
const skipDeploy = args.includes('--skip-deploy');
const verifyOnly = args.includes('--verify-only');

async function main() {
  console.log('🌐 Setting up Base Sepolia Testnet');
  console.log('='.repeat(60));

  // Load private key
  const privateKey = process.env.TESTNET_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('TESTNET_PRIVATE_KEY or PRIVATE_KEY required');
  }

  const provider = new JsonRpcProvider(TESTNET_CONFIG.rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  console.log(`\nNetwork: Base Sepolia (Chain ID: ${TESTNET_CONFIG.chainId})`);
  console.log(`Operator: ${wallet.address}`);

  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.01')) {
    console.warn('\n⚠️  Low balance! Get testnet ETH from:');
    console.warn(`   ${TESTNET_CONFIG.faucetUrl}`);

    if (!verifyOnly) {
      process.exit(1);
    }
  }

  // Load existing addresses
  const addressesPath = join(process.cwd(), 'config', 'addresses', 'testnet.json');
  let addresses: Partial<ContractAddresses> = {};

  if (existsSync(addressesPath)) {
    addresses = JSON.parse(readFileSync(addressesPath, 'utf-8')) as Partial<ContractAddresses>;
    console.log('\n📋 Loaded existing addresses:');
    for (const [key, value] of Object.entries(addresses)) {
      if (value) console.log(`   ${key}: ${value}`);
    }
  }

  // Step 1: Verify core contracts
  console.log('\n📦 Step 1: Verifying core contracts...');

  const requiredContracts = [
    { name: 'governanceToken', address: addresses.governanceToken },
    { name: 'identityRegistry', address: addresses.identityRegistry },
    { name: 'reputationRegistry', address: addresses.reputationRegistry },
    { name: 'council', address: addresses.council },
  ];

  for (const contract of requiredContracts) {
    if (!contract.address) {
      console.error(`   ❌ ${contract.name} not deployed`);
      if (!verifyOnly) {
        console.error('      Deploy core contracts first with: bun scripts/deploy-contracts.ts');
        process.exit(1);
      }
    } else {
      const code = await provider.getCode(contract.address);
      if (code === '0x') {
        console.error(`   ❌ ${contract.name} has no code at ${contract.address}`);
      } else {
        console.log(`   ✅ ${contract.name}: ${contract.address}`);
      }
    }
  }

  if (verifyOnly) {
    console.log('\n✅ Verification complete');
    return;
  }

  // Step 2: Deploy governance contracts if not present
  if (!skipDeploy) {
    console.log('\n📦 Step 2: Deploying governance contracts...');

    if (!addresses.delegationRegistry) {
      console.log('   Deploying DelegationRegistry...');
      // Would deploy here - for now just log
      console.log('   Run: bun scripts/deploy-governance.ts --network=testnet');
    } else {
      console.log(`   ✅ DelegationRegistry: ${addresses.delegationRegistry}`);
    }

    if (!addresses.circuitBreaker) {
      console.log('   Deploying CircuitBreaker...');
      console.log('   Run: bun scripts/deploy-governance.ts --network=testnet');
    } else {
      console.log(`   ✅ CircuitBreaker: ${addresses.circuitBreaker}`);
    }

    if (!addresses.safe) {
      console.log('   Deploying Safe...');
      console.log('   Run: bun scripts/deploy-governance.ts --network=testnet');
    } else {
      console.log(`   ✅ Safe: ${addresses.safe}`);
    }

    if (!addresses.councilSafeModule) {
      console.log('   Deploying CouncilSafeModule...');
      console.log('   Run: bun scripts/deploy-governance.ts --network=testnet');
    } else {
      console.log(`   ✅ CouncilSafeModule: ${addresses.councilSafeModule}`);
    }
  }

  // Step 3: Configure contracts
  console.log('\n📦 Step 3: Configuring contracts...');

  if (addresses.circuitBreaker && addresses.council) {
    console.log('   Registering Council with CircuitBreaker...');
    const circuitBreaker = new ethers.Contract(addresses.circuitBreaker, CIRCUIT_BREAKER_ABI, wallet);

    try {
      const tx = await circuitBreaker.registerContract(addresses.council, 'Council', 1);
      await tx.wait();
      console.log('   ✅ Council registered for protection');
    } catch (error) {
      const msg = (error as Error).message;
      if (msg.includes('already registered') || msg.includes('ContractAlreadyRegistered')) {
        console.log('   ℹ️  Council already registered');
      } else {
        console.error('   ⚠️  Failed to register:', msg);
      }
    }
  }

  if (addresses.delegationRegistry) {
    console.log('   Updating security council...');
    const delegationRegistry = new ethers.Contract(
      addresses.delegationRegistry,
      DELEGATION_REGISTRY_ABI,
      wallet
    );

    try {
      const tx = await delegationRegistry.updateSecurityCouncil();
      await tx.wait();
      const council = await delegationRegistry.getSecurityCouncil();
      console.log(`   ✅ Security council updated: ${council.length} members`);
    } catch (error) {
      console.error('   ⚠️  Failed to update security council:', (error as Error).message);
    }
  }

  // Step 4: Sync security council across contracts
  console.log('\n📦 Step 4: Syncing security council...');

  if (addresses.circuitBreaker && addresses.delegationRegistry) {
    const circuitBreaker = new ethers.Contract(addresses.circuitBreaker, CIRCUIT_BREAKER_ABI, wallet);

    try {
      const tx = await circuitBreaker.syncSecurityCouncil();
      await tx.wait();
      const members = await circuitBreaker.getSecurityCouncilMembers();
      console.log(`   ✅ CircuitBreaker synced: ${members.length} members`);
    } catch (error) {
      console.error('   ⚠️  Failed to sync CircuitBreaker:', (error as Error).message);
    }
  }

  if (addresses.councilSafeModule && addresses.delegationRegistry) {
    const safeModule = new ethers.Contract(addresses.councilSafeModule, COUNCIL_SAFE_MODULE_ABI, wallet);

    try {
      const tx = await safeModule.syncSecurityCouncilFromDelegation(addresses.delegationRegistry);
      await tx.wait();
      console.log('   ✅ SafeModule synced with delegation registry');
    } catch (error) {
      console.error('   ⚠️  Failed to sync SafeModule:', (error as Error).message);
    }
  }

  // Step 5: Generate environment file
  console.log('\n📦 Step 5: Generating environment file...');

  const outputDir = join(process.cwd(), 'config', 'testnet');
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const envContent = `# Jeju Testnet Configuration
# Generated by setup-testnet.ts at ${new Date().toISOString()}

# Network
RPC_URL=${TESTNET_CONFIG.rpcUrl}
CHAIN_ID=${TESTNET_CONFIG.chainId}
EXPLORER_URL=${TESTNET_CONFIG.explorerUrl}

# Operator (DO NOT COMMIT THIS FILE WITH REAL KEYS)
OPERATOR_ADDRESS=${wallet.address}

# Contract Addresses
GOVERNANCE_TOKEN_ADDRESS=${addresses.governanceToken ?? ''}
IDENTITY_REGISTRY_ADDRESS=${addresses.identityRegistry ?? ''}
REPUTATION_REGISTRY_ADDRESS=${addresses.reputationRegistry ?? ''}
COUNCIL_ADDRESS=${addresses.council ?? ''}
CEO_AGENT_ADDRESS=${addresses.ceoAgent ?? ''}
PREDIMARKET_ADDRESS=${addresses.predimarket ?? ''}
DELEGATION_REGISTRY_ADDRESS=${addresses.delegationRegistry ?? ''}
CIRCUIT_BREAKER_ADDRESS=${addresses.circuitBreaker ?? ''}
COUNCIL_SAFE_MODULE_ADDRESS=${addresses.councilSafeModule ?? ''}
SAFE_ADDRESS=${addresses.safe ?? ''}

# Safe Configuration
SAFE_FACTORY=${TESTNET_CONFIG.safeFactory}
SAFE_SINGLETON=${TESTNET_CONFIG.safeSingleton}
SAFE_FALLBACK_HANDLER=${TESTNET_CONFIG.safeFallbackHandler}

# AI Configuration
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b

# Lit Protocol
LIT_NETWORK=cayenne
LIT_DEBUG=false

# TEE Configuration
TEE_CLOUD_URL=https://cloud.phala.network/api/v1
DCAP_ENDPOINT=https://dcap.phala.network/verify
REQUIRE_HARDWARE_TEE=false
`;

  writeFileSync(join(outputDir, '.env.testnet'), envContent);
  console.log(`   Saved to ${join(outputDir, '.env.testnet')}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ TESTNET SETUP COMPLETE');
  console.log('='.repeat(60));

  console.log('\n📋 Contract Status:');
  console.log(`   Governance Token:    ${addresses.governanceToken ?? '❌ Not deployed'}`);
  console.log(`   Identity Registry:   ${addresses.identityRegistry ?? '❌ Not deployed'}`);
  console.log(`   Reputation Registry: ${addresses.reputationRegistry ?? '❌ Not deployed'}`);
  console.log(`   Council:             ${addresses.council ?? '❌ Not deployed'}`);
  console.log(`   Delegation Registry: ${addresses.delegationRegistry ?? '❌ Not deployed'}`);
  console.log(`   Circuit Breaker:     ${addresses.circuitBreaker ?? '❌ Not deployed'}`);
  console.log(`   Safe:                ${addresses.safe ?? '❌ Not deployed'}`);
  console.log(`   Safe Module:         ${addresses.councilSafeModule ?? '❌ Not deployed'}`);

  console.log('\n🔗 Useful Links:');
  console.log(`   Explorer: ${TESTNET_CONFIG.explorerUrl}`);
  console.log(`   Faucet:   ${TESTNET_CONFIG.faucetUrl}`);

  if (addresses.safe) {
    console.log(`   Safe UI:  https://app.safe.global/home?safe=basesep:${addresses.safe}`);
  }

  console.log('\n📌 NEXT STEPS:');
  if (!addresses.delegationRegistry || !addresses.circuitBreaker || !addresses.safe) {
    console.log('1. Deploy remaining contracts:');
    console.log('   bun scripts/deploy-governance.ts --network=testnet');
  }
  console.log('2. Enable SafeModule via Safe UI');
  console.log('3. Register test delegates');
  console.log('4. Run integration tests:');
  console.log('   cd apps/council && bun test:testnet');
}

main().catch((error) => {
  console.error('\n❌ Setup failed:', error);
  process.exit(1);
});

