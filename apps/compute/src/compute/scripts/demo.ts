#!/usr/bin/env bun
/**
 * Jeju Compute Marketplace - End-to-End Demo
 *
 * This demo shows the complete flow:
 * 1. Deploy contracts (if needed)
 * 2. Register a provider
 * 3. Start a compute node
 * 4. Create a user ledger and fund it
 * 5. Make an inference request
 * 6. Settle on-chain
 *
 * Usage:
 *   bun run src/compute/scripts/demo.ts
 *
 * For testnet (Sepolia):
 *   NETWORK=sepolia PRIVATE_KEY=0x... bun run src/compute/scripts/demo.ts
 */

import { formatEther, JsonRpcProvider, parseEther, Wallet } from 'ethers';
import { ComputeNodeServer } from '../node/server';
import type { ProviderConfig } from '../node/types';
import { JejuComputeSDK } from '../sdk/sdk';
import type { InferenceResponse } from '../sdk/types';

// Demo configuration - uses Jeju localnet (port 9545) by default
const DEMO_CONFIG = {
  // Local Jeju localnet (via Kurtosis)
  localnet: {
    rpcUrl: 'http://127.0.0.1:9545',
    deployer:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    user: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  // Standalone Anvil (for isolated testing)
  anvil: {
    rpcUrl: 'http://127.0.0.1:8545',
    deployer:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider:
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    user: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  },
  // Sepolia testnet
  sepolia: {
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
  },
};

async function main() {
  // Default to localnet (Jeju's Kurtosis network) instead of standalone anvil
  const network = process.env.NETWORK || 'localnet';
  const isTestnet = network === 'sepolia';

  console.log('\n' + '='.repeat(60));
  console.log('🎮 JEJU COMPUTE MARKETPLACE - DEMO');
  console.log('='.repeat(60));
  console.log(`\nNetwork: ${network.toUpperCase()}`);

  // Setup wallets
  let rpcUrl: string;
  let deployerKey: string;
  let providerKey: string;
  let userKey: string;

  if (isTestnet) {
    rpcUrl = DEMO_CONFIG.sepolia.rpcUrl;
    deployerKey = process.env.PRIVATE_KEY || '';
    providerKey = process.env.PROVIDER_KEY || deployerKey;
    userKey = process.env.USER_KEY || deployerKey;

    if (!deployerKey) {
      console.error('\n❌ PRIVATE_KEY required for testnet');
      process.exit(1);
    }
  } else if (network === 'anvil') {
    rpcUrl = DEMO_CONFIG.anvil.rpcUrl;
    deployerKey = DEMO_CONFIG.anvil.deployer;
    providerKey = DEMO_CONFIG.anvil.provider;
    userKey = DEMO_CONFIG.anvil.user;
  } else {
    // Default: localnet (Jeju Kurtosis)
    rpcUrl = process.env.JEJU_RPC_URL || DEMO_CONFIG.localnet.rpcUrl;
    deployerKey = DEMO_CONFIG.localnet.deployer;
    providerKey = DEMO_CONFIG.localnet.provider;
    userKey = DEMO_CONFIG.localnet.user;
  }

  const rpcProvider = new JsonRpcProvider(rpcUrl);
  const deployerWallet = new Wallet(deployerKey, rpcProvider);
  const providerWallet = new Wallet(providerKey, rpcProvider);
  const userWallet = new Wallet(userKey, rpcProvider);

  console.log(`\n📋 Wallets:`);
  console.log(`   Deployer: ${deployerWallet.address}`);
  console.log(`   Provider: ${providerWallet.address}`);
  console.log(`   User: ${userWallet.address}`);

  // Check balances
  const deployerBalance = await rpcProvider.getBalance(deployerWallet.address);
  console.log(`\n💰 Deployer Balance: ${formatEther(deployerBalance)} ETH`);

  if (deployerBalance < parseEther('0.1')) {
    console.error('\n❌ Insufficient funds. Need at least 0.1 ETH');
    if (isTestnet) {
      console.log(
        '   Get testnet ETH: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet'
      );
    }
    process.exit(1);
  }

  // =========================================
  // STEP 1: Deploy Contracts (or use existing)
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('📦 STEP 1: Deploy Contracts');
  console.log('-'.repeat(60));

  let contracts: {
    registry: string;
    ledger: string;
    inference: string;
  };

  // Load deployment from file or environment
  const existingRegistry = process.env.REGISTRY_ADDRESS;
  if (existingRegistry) {
    contracts = {
      registry: existingRegistry,
      ledger: process.env.LEDGER_ADDRESS || '',
      inference: process.env.INFERENCE_ADDRESS || '',
    };
    console.log('   Using env deployment:');
  } else {
    console.log('   Loading deployment from file...');
    contracts = await loadDeployment(network);
    console.log('   ✅ Loaded from deployments/' + network + '.json');
  }
  console.log(`   Registry: ${contracts.registry}`);
  console.log(`   Ledger: ${contracts.ledger}`);
  console.log(`   Inference: ${contracts.inference}`);

  // =========================================
  // STEP 2: Register Provider
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('👤 STEP 2: Register Provider');
  console.log('-'.repeat(60));

  const providerSDK = new JejuComputeSDK({
    rpcUrl,
    signer: providerWallet,
    contracts,
  });

  const isActive = await providerSDK.isProviderActive(providerWallet.address);
  if (isActive) {
    console.log('   ✅ Provider already registered');
  } else {
    console.log('   Registering provider with 0.1 ETH stake...');
    await providerSDK.register(
      'demo-provider',
      'http://localhost:8080',
      parseEther('0.1')
    );
    console.log('   ✅ Provider registered');
  }

  // =========================================
  // STEP 3: Start Compute Node
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('🖥️  STEP 3: Start Compute Node');
  console.log('-'.repeat(60));

  // Compute node port (4007 is Jeju standard, fallback to 8080 for standalone)
  const computePort = parseInt(process.env.COMPUTE_PORT || '4007', 10);
  
  const nodeConfig: ProviderConfig = {
    privateKey: providerKey,
    registryAddress: contracts.registry,
    ledgerAddress: contracts.ledger,
    inferenceAddress: contracts.inference,
    rpcUrl,
    port: computePort,
    models: [
      {
        name: 'demo-model',
        backend: 'mock',
        pricePerInputToken: BigInt(1000000000), // 1 gwei
        pricePerOutputToken: BigInt(2000000000), // 2 gwei
        maxContextLength: 4096,
      },
    ],
  };

  const computeNode = new ComputeNodeServer(nodeConfig);
  computeNode.start(nodeConfig.port);

  // Wait for server to be ready
  await new Promise((r) => setTimeout(r, 1000));
  console.log(`   ✅ Compute node running at http://localhost:${computePort}`);

  // =========================================
  // STEP 4: Fund User Ledger
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('💳 STEP 4: Fund User Ledger');
  console.log('-'.repeat(60));

  const userSDK = new JejuComputeSDK({
    rpcUrl,
    signer: userWallet,
    contracts,
  });

  console.log('   Creating user ledger with 0.5 ETH...');
  await userSDK.deposit(parseEther('0.5'));
  console.log('   ✅ Ledger funded');

  console.log('   Transferring 0.1 ETH to provider sub-account...');
  await userSDK.transferToProvider(providerWallet.address, parseEther('0.1'));
  console.log('   ✅ Sub-account funded');

  // Provider must acknowledge the user to enable settlements
  // In production, provider would do this after seeing the transfer
  console.log('   Provider acknowledging user...');
  await providerSDK.acknowledgeUser(userWallet.address);
  console.log('   ✅ User acknowledged by provider');

  // =========================================
  // STEP 5: Make Inference Request
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('🤖 STEP 5: Make Inference Request');
  console.log('-'.repeat(60));

  // Generate auth headers
  const authHeaders = await userSDK.generateAuthHeaders(providerWallet.address);
  console.log('   Generated auth headers');
  console.log(
    `   Settlement nonce: ${authHeaders['x-jeju-settlement-nonce']}`
  );

  // Make request
  console.log('   Sending inference request...');
  const response = await fetch(`http://localhost:${computePort}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      model: 'demo-model',
      messages: [{ role: 'user', content: 'What is 2+2? Answer briefly.' }],
    }),
  });

  const result = await response.json() as InferenceResponse;
  console.log('\n   📝 Response:');
  console.log(`   Model: ${result.model}`);
  console.log(`   Content: ${result.choices[0].message.content}`);
  console.log(`   Input tokens: ${result.usage.prompt_tokens}`);
  console.log(`   Output tokens: ${result.usage.completion_tokens}`);

  if (result.settlement) {
    console.log('\n   💰 Settlement Data:');
    console.log(`   Request Hash: ${result.settlement.requestHash}`);
    console.log(`   Signature: ${result.settlement.signature.slice(0, 40)}...`);
  }

  // =========================================
  // STEP 6: Settlement (Optional)
  // =========================================
  console.log('\n' + '-'.repeat(60));
  console.log('⚡ STEP 6: On-Chain Settlement');
  console.log('-'.repeat(60));

  if (result.settlement) {
    console.log('   Settling on-chain...');
    await userSDK.settleFromResponse(result);
    console.log('   ✅ Settlement complete!');
  } else {
    console.log('   ⚠️  No settlement data in response');
  }

  // =========================================
  // Summary
  // =========================================
  console.log('\n' + '='.repeat(60));
  console.log('✅ DEMO COMPLETE');
  console.log('='.repeat(60));
  console.log('\n📊 Summary:');
  console.log(`   ✅ Contracts deployed/connected`);
  console.log(`   ✅ Provider registered and staked`);
  console.log(`   ✅ Compute node running`);
  console.log(`   ✅ User ledger funded`);
  console.log(`   ✅ Inference request successful`);
  console.log(`   ✅ Settlement data generated`);

  console.log('\n📡 Endpoints:');
  console.log(`   Health: http://localhost:${computePort}/health`);
  console.log(`   Models: http://localhost:${computePort}/v1/models`);
  console.log(`   Inference: http://localhost:${computePort}/v1/chat/completions`);

  console.log('\n💡 Try it yourself:');
  console.log(`   curl http://localhost:${computePort}/v1/chat/completions \\`);
  console.log('     -H "Content-Type: application/json" \\');
  console.log(
    '     -d \'{"model": "demo-model", "messages": [{"role": "user", "content": "Hello!"}]}\''
  );

  console.log('\n⌨️  Press Ctrl+C to stop\n');

  // Keep running
  await new Promise(() => {});
}

/**
 * Load contract deployment from file
 */
async function loadDeployment(
  network: string
): Promise<{ registry: string; ledger: string; inference: string }> {
  const deploymentPath = `${import.meta.dir}/../../../deployments/${network}.json`;

  const file = Bun.file(deploymentPath);
  if (!(await file.exists())) {
    throw new Error(
      `No deployment found for ${network}.\n` +
        `Run: NETWORK=${network} bun run compute:deploy\n` +
        `Or for Anvil: NETWORK=anvil PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 bun run compute:deploy`
    );
  }

  const deployment = await file.json();
  return {
    registry: deployment.contracts.registry,
    ledger: deployment.contracts.ledger,
    inference: deployment.contracts.inference,
  };
}

main().catch((error) => {
  console.error('\n❌ Demo failed:', error);
  process.exit(1);
});
