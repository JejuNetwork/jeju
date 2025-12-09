#!/usr/bin/env bun
/**
 * Jeju Compute Network - Provider Onboarding
 *
 * This script helps providers join the Jeju compute network.
 * It handles:
 * 1. Wallet setup and funding check
 * 2. Contract registration with stake
 * 3. Service registration with pricing
 * 4. Starting the compute node
 *
 * Usage:
 *   bun run src/compute/scripts/join-network.ts
 *
 * Environment variables:
 *   PRIVATE_KEY     - Provider wallet private key (required)
 *   RPC_URL         - RPC endpoint (default: Sepolia)
 *   MODEL_NAME      - Model to serve (default: mock-model)
 *   MODEL_BACKEND   - Backend type: mock, ollama (default: mock)
 *   STAKE_AMOUNT    - Amount to stake in ETH (default: 0.1)
 */

import {
  Contract,
  formatEther,
  JsonRpcProvider,
  parseEther,
  Wallet,
} from 'ethers';
import { detectHardware, generateHardwareHash } from '../node/hardware';
import { ComputeNodeServer } from '../node/server';
import type { ProviderConfig } from '../node/types';

// Load contract addresses from deployment file or environment
async function loadContracts(): Promise<{
  registry: string;
  ledger: string;
  inference: string;
}> {
  // First check environment
  if (
    process.env.REGISTRY_ADDRESS &&
    process.env.LEDGER_ADDRESS &&
    process.env.INFERENCE_ADDRESS
  ) {
    return {
      registry: process.env.REGISTRY_ADDRESS,
      ledger: process.env.LEDGER_ADDRESS,
      inference: process.env.INFERENCE_ADDRESS,
    };
  }

  // Try to load from deployment file
  const network = process.env.NETWORK || 'sepolia';
  const deploymentPath = `${import.meta.dir}/../../../deployments/${network}.json`;

  try {
    const deployment = await Bun.file(deploymentPath).json();
    return {
      registry: deployment.contracts.registry,
      ledger: deployment.contracts.ledger,
      inference: deployment.contracts.inference,
    };
  } catch {
    return { registry: '', ledger: '', inference: '' };
  }
}

const REGISTRY_ABI = [
  'function register(string name, string endpoint, bytes32 attestationHash) payable returns (address)',
  'function isActive(address) view returns (bool)',
  'function getProvider(address) view returns (tuple(address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, bool active))',
  'function MIN_PROVIDER_STAKE() view returns (uint256)',
];

const INFERENCE_ABI = [
  'function registerService(string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken)',
  'function getServices(address) view returns (tuple(address provider, string model, string endpoint, uint256 pricePerInputToken, uint256 pricePerOutputToken, bool active)[])',
];

async function main() {
  console.log('\n🚀 Jeju Compute Network - Provider Onboarding\n');
  console.log('='.repeat(50));

  // 1. Check environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PRIVATE_KEY environment variable is required');
    console.log('\nUsage:');
    console.log(
      '  PRIVATE_KEY=0x... bun run src/compute/scripts/join-network.ts'
    );
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const modelName = process.env.MODEL_NAME || 'mock-model';
  const modelBackend = (process.env.MODEL_BACKEND || 'mock') as
    | 'mock'
    | 'ollama';
  const stakeAmount = parseEther(process.env.STAKE_AMOUNT || '0.01');
  const port = Number.parseInt(process.env.PORT || '8080', 10);

  // Load contract addresses
  const CONTRACTS = await loadContracts();
  if (!CONTRACTS.registry || !CONTRACTS.ledger || !CONTRACTS.inference) {
    console.error('❌ Contract addresses not configured');
    console.log('\nSet the following environment variables:');
    console.log('  REGISTRY_ADDRESS=0x...');
    console.log('  LEDGER_ADDRESS=0x...');
    console.log('  INFERENCE_ADDRESS=0x...');
    console.log('\nOr deploy contracts first:');
    console.log('  NETWORK=sepolia bun run compute:deploy:sepolia');
    process.exit(1);
  }

  console.log(`   Registry: ${CONTRACTS.registry}`);
  console.log(`   Ledger: ${CONTRACTS.ledger}`);
  console.log(`   Inference: ${CONTRACTS.inference}`);

  // 2. Initialize wallet
  console.log('\n📋 Configuration:');
  console.log(`   RPC URL: ${rpcUrl}`);
  console.log(`   Model: ${modelName} (${modelBackend})`);
  console.log(`   Stake: ${formatEther(stakeAmount)} ETH`);
  console.log(`   Port: ${port}`);

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);

  console.log(`   Provider Wallet: ${wallet.address}`);

  // 3. Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log(`   Balance: ${formatEther(balance)} ETH`);

  if (balance < stakeAmount + parseEther('0.005')) {
    console.error(
      `\n❌ Insufficient balance. Need at least ${formatEther(stakeAmount + parseEther('0.005'))} ETH`
    );
    console.log(`   Current balance: ${formatEther(balance)} ETH`);
    console.log('\n   Get testnet ETH from:');
    console.log(
      '   - Sepolia: https://sepoliafaucet.com'
    );
    process.exit(1);
  }

  // 4. Detect hardware
  console.log('\n🔍 Detecting hardware...');
  const hardware = await detectHardware();
  console.log(`   Platform: ${hardware.platform}`);
  console.log(`   CPUs: ${hardware.cpus}`);
  console.log(
    `   Memory: ${Math.round(hardware.memory / 1024 / 1024 / 1024)}GB`
  );
  if (hardware.gpuType) {
    console.log(`   GPU: ${hardware.gpuType}`);
  }
  if (hardware.mlxVersion) {
    console.log(`   MLX: ${hardware.mlxVersion}`);
  }
  const hardwareHash = generateHardwareHash(hardware);
  console.log(`   Hardware Hash: ${hardwareHash.slice(0, 18)}...`);

  // 5. Check registration status
  console.log('\n📝 Checking registration status...');
  const registry = new Contract(CONTRACTS.registry, REGISTRY_ABI, wallet);

  const isActive = await registry.isActive(wallet.address);
  if (isActive) {
    console.log('   ✅ Already registered and active');
  } else {
    // Register with stake
    console.log('   Registering as provider...');

    const endpoint = `http://localhost:${port}`; // Will be updated after deployment
    const minStake = await registry.MIN_PROVIDER_STAKE();
    console.log(`   Min stake required: ${formatEther(minStake)} ETH`);

    const actualStake = stakeAmount > minStake ? stakeAmount : minStake;

    // Generate attestation hash from hardware
    const attestationHash = hardwareHash;

    try {
      const tx = await registry.register(
        `jeju-provider-${wallet.address.slice(0, 8)}`,
        endpoint,
        attestationHash,
        { value: actualStake }
      );
      console.log(`   Transaction: ${tx.hash}`);
      await tx.wait();
      console.log('   ✅ Registration complete');
    } catch (error) {
      console.error(`   ❌ Registration failed: ${error}`);
      process.exit(1);
    }
  }

  // 6. Register inference service
  console.log('\n🤖 Registering inference service...');
  const inference = new Contract(CONTRACTS.inference, INFERENCE_ABI, wallet);

  const services = await inference.getServices(wallet.address);
  const existingService = services.find(
    (s: { model: string }) => s.model === modelName
  );

  if (existingService) {
    console.log(`   ✅ Service "${modelName}" already registered`);
  } else {
    const pricePerInputToken = BigInt(
      process.env.PRICE_PER_INPUT_TOKEN || '1000000000'
    ); // 1 gwei
    const pricePerOutputToken = BigInt(
      process.env.PRICE_PER_OUTPUT_TOKEN || '2000000000'
    ); // 2 gwei

    try {
      const tx = await inference.registerService(
        modelName,
        `http://localhost:${port}`,
        pricePerInputToken,
        pricePerOutputToken
      );
      console.log(`   Transaction: ${tx.hash}`);
      await tx.wait();
      console.log(`   ✅ Service "${modelName}" registered`);
    } catch (error) {
      console.error(`   ❌ Service registration failed: ${error}`);
      // Continue anyway - service might already exist
    }
  }

  // 7. Start compute node
  console.log('\n🖥️  Starting compute node...');

  const nodeConfig: ProviderConfig = {
    privateKey,
    registryAddress: CONTRACTS.registry,
    ledgerAddress: CONTRACTS.ledger,
    inferenceAddress: CONTRACTS.inference,
    rpcUrl,
    port,
    models: [
      {
        name: modelName,
        backend: modelBackend,
        endpoint:
          modelBackend === 'ollama'
            ? process.env.OLLAMA_ENDPOINT || 'http://localhost:11434'
            : undefined,
        pricePerInputToken: BigInt(
          process.env.PRICE_PER_INPUT_TOKEN || '1000000000'
        ),
        pricePerOutputToken: BigInt(
          process.env.PRICE_PER_OUTPUT_TOKEN || '2000000000'
        ),
        maxContextLength: 4096,
      },
    ],
  };

  const server = new ComputeNodeServer(nodeConfig);
  server.start(nodeConfig.port);

  console.log('\n' + '='.repeat(50));
  console.log('✅ Provider successfully joined the network!');
  console.log('='.repeat(50));
  console.log(`\n📡 Endpoint: http://localhost:${port}`);
  console.log(`👛 Provider: ${wallet.address}`);
  console.log(`🤖 Model: ${modelName}`);
  console.log('\n💡 Test with:');
  console.log(`   curl http://localhost:${port}/health`);
  console.log(`   curl http://localhost:${port}/v1/models`);
  console.log('\n📊 Make inference request:');
  console.log(`   curl http://localhost:${port}/v1/chat/completions \\`);
  console.log('     -H "Content-Type: application/json" \\');
  console.log(
    '     -d \'{"model": "' +
      modelName +
      '", "messages": [{"role": "user", "content": "Hello!"}]}\''
  );
  console.log('\n⌨️  Press Ctrl+C to stop the node\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
