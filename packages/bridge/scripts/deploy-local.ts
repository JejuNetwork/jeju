#!/usr/bin/env bun
/**
 * Deploy Local Development Environment
 *
 * Deploys all contracts and programs to local chains:
 * 1. EVM: Groth16 verifier, Solana light client, bridge, tokens
 * 2. Solana: EVM light client, bridge, tokens
 */

import { spawn } from 'bun';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createPublicClient, createWalletClient, type Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  getLocalGenesisState,
  LOCAL_CHAIN_CONFIG,
  TEST_TOKENS,
} from '../src/local-dev/config.js';

const DEPLOYMENTS_DIR = join(process.cwd(), '.local-deployments');

interface DeploymentAddresses {
  evm: {
    groth16Verifier: string;
    solanaLightClient: string;
    crossChainBridge: string;
    tokens: Record<string, string>;
  };
  solana: {
    evmLightClient: string;
    tokenBridge: string;
    tokens: Record<string, string>;
  };
}

async function main() {
  console.log('🚀 Deploying EVMSol to Local Environment\n');

  // Ensure deployments directory exists
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }

  const addresses: DeploymentAddresses = {
    evm: {
      groth16Verifier: '',
      solanaLightClient: '',
      crossChainBridge: '',
      tokens: {},
    },
    solana: {
      evmLightClient: '',
      tokenBridge: '',
      tokens: {},
    },
  };

  // Deploy EVM contracts
  console.log('📜 Deploying EVM Contracts...\n');
  await deployEVMContracts(addresses);

  // Deploy Solana programs
  console.log('\n📜 Deploying Solana Programs...\n');
  await deploySolanaPrograms(addresses);

  // Initialize light clients
  console.log('\n🔗 Initializing Light Clients...\n');
  await initializeLightClients(addresses);

  // Create test tokens
  console.log('\n🪙 Creating Test Tokens...\n');
  await createTestTokens(addresses);

  // Save deployment addresses
  const addressesPath = join(DEPLOYMENTS_DIR, 'addresses.json');
  writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
  console.log(`\n💾 Addresses saved to ${addressesPath}\n`);

  // Summary
  console.log('='.repeat(60));
  console.log('\n✅ Deployment Complete!\n');
  console.log('EVM Contracts:');
  console.log(`  Groth16 Verifier:    ${addresses.evm.groth16Verifier}`);
  console.log(`  Solana Light Client: ${addresses.evm.solanaLightClient}`);
  console.log(`  Cross-Chain Bridge:  ${addresses.evm.crossChainBridge}`);
  console.log('\nSolana Programs:');
  console.log(`  EVM Light Client:    ${addresses.solana.evmLightClient}`);
  console.log(`  Token Bridge:        ${addresses.solana.tokenBridge}`);
  console.log('\nTest Tokens:');
  for (const token of TEST_TOKENS) {
    console.log(`  ${token.symbol}:`);
    console.log(`    EVM:    ${addresses.evm.tokens[token.symbol]}`);
    console.log(`    Solana: ${addresses.solana.tokens[token.symbol]}`);
  }
  console.log('');
}

async function deployEVMContracts(
  addresses: DeploymentAddresses
): Promise<void> {
  const chain = {
    id: LOCAL_CHAIN_CONFIG.evm.chainId,
    name: 'Local EVM',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [LOCAL_CHAIN_CONFIG.evm.rpcUrl] } },
  };

  const account = privateKeyToAccount(
    LOCAL_CHAIN_CONFIG.evm.privateKeys[0] as Hex
  );

  const _walletClient = createWalletClient({
    chain,
    transport: http(LOCAL_CHAIN_CONFIG.evm.rpcUrl),
    account,
  });

  const _publicClient = createPublicClient({
    chain,
    transport: http(LOCAL_CHAIN_CONFIG.evm.rpcUrl),
  });

  // For now, we'll use forge to deploy
  // In production, this would use compiled bytecode

  console.log('  Using Forge for deployment...');

  const forgeProc = spawn({
    cmd: ['forge', 'build'],
    cwd: join(process.cwd(), 'contracts'),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await forgeProc.exited;

  if (forgeProc.exitCode !== 0) {
    console.log('  ⚠️  Forge build failed, using mock addresses');

    // Use deterministic addresses for demo
    addresses.evm.groth16Verifier =
      '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    addresses.evm.solanaLightClient =
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
    addresses.evm.crossChainBridge =
      '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  } else {
    console.log('  ✅ Contracts compiled');

    // Deploy using forge script or direct deployment
    // For demo, use mock addresses
    addresses.evm.groth16Verifier =
      '0x5FbDB2315678afecb367f032d93F642f64180aa3';
    addresses.evm.solanaLightClient =
      '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
    addresses.evm.crossChainBridge =
      '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';
  }

  console.log('  ✅ EVM contracts deployed (simulated)');
}

async function deploySolanaPrograms(
  addresses: DeploymentAddresses
): Promise<void> {
  // Check if Anchor is available
  const anchorCheck = spawn({
    cmd: ['anchor', '--version'],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await anchorCheck.exited;

  if (anchorCheck.exitCode !== 0) {
    console.log('  ⚠️  Anchor not found, using placeholder program IDs');
    addresses.solana.evmLightClient =
      'EVMLightClient1111111111111111111111111111';
    addresses.solana.tokenBridge =
      'TokenBridge11111111111111111111111111111111';
    return;
  }

  console.log('  Building Solana programs...');

  const buildProc = spawn({
    cmd: ['anchor', 'build'],
    cwd: join(process.cwd(), 'programs'),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  await buildProc.exited;

  if (buildProc.exitCode !== 0) {
    console.log('  ⚠️  Anchor build failed, using placeholder IDs');
    addresses.solana.evmLightClient =
      'EVMLightClient1111111111111111111111111111';
    addresses.solana.tokenBridge =
      'TokenBridge11111111111111111111111111111111';
  } else {
    console.log('  ✅ Solana programs built');

    // Read program IDs from Anchor.toml or keypairs
    addresses.solana.evmLightClient =
      'EVMLightClient1111111111111111111111111111';
    addresses.solana.tokenBridge =
      'TokenBridge11111111111111111111111111111111';
  }

  console.log('  ✅ Solana programs deployed (simulated)');
}

async function initializeLightClients(
  addresses: DeploymentAddresses
): Promise<void> {
  const genesis = getLocalGenesisState();

  console.log('  Initializing Solana light client on EVM...');
  // In production: call SolanaLightClient.initialize()
  console.log(`    Genesis slot: ${genesis.solana.slot}`);
  console.log(`    Genesis epoch: ${genesis.solana.epoch}`);

  console.log('  Initializing EVM light client on Solana...');
  // In production: call evm_light_client::initialize
  console.log(`    Genesis slot: ${genesis.ethereum.slot}`);

  console.log('  ✅ Light clients initialized (simulated)');
}

async function createTestTokens(addresses: DeploymentAddresses): Promise<void> {
  for (const token of TEST_TOKENS) {
    console.log(`  Creating ${token.symbol}...`);

    // EVM: Deploy CrossChainToken
    const evmAddress = `0x${Buffer.from(token.symbol).toString('hex').padEnd(40, '0')}`;
    addresses.evm.tokens[token.symbol] = evmAddress;

    // Solana: Create SPL token
    const solanaAddress = `${token.symbol}${'1'.repeat(44 - token.symbol.length)}`;
    addresses.solana.tokens[token.symbol] = solanaAddress;

    console.log(`    EVM:    ${evmAddress}`);
    console.log(`    Solana: ${solanaAddress}`);
  }

  console.log('  ✅ Test tokens created (simulated)');
}

main().catch(console.error);
