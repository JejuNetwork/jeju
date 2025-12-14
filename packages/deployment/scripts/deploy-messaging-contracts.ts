#!/usr/bin/env bun
/**
 * Deploy Messaging Contracts to the network L2
 * 
 * Deploys KeyRegistry and MessageNodeRegistry contracts for decentralized messaging.
 * 
 * Usage:
 *   bun run scripts/deploy-messaging-contracts.ts --network testnet
 *   bun run scripts/deploy-messaging-contracts.ts --network mainnet --verify
 */

import { createPublicClient, createWalletClient, http, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { spawn } from 'child_process';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';

// Network configurations
const NETWORKS = {
  testnet: {
    rpcUrl: process.env.JEJU_TESTNET_RPC_URL ?? 'https://testnet-rpc.jeju.network',
    chainId: 11235813,
    name: 'Testnet',
  },
  mainnet: {
    rpcUrl: process.env.JEJU_MAINNET_RPC_URL ?? 'https://rpc.jeju.network',
    chainId: 11235814,
    name: 'Mainnet',
  },
  localnet: {
    rpcUrl: process.env.JEJU_LOCALNET_RPC_URL ?? 'http://localhost:8545',
    chainId: 31337,
    name: getLocalnetChain().name,
  },
} as const;

type NetworkName = keyof typeof NETWORKS;

interface DeploymentResult {
  network: string;
  keyRegistry: Address;
  nodeRegistry: Address;
  deployer: Address;
  timestamp: string;
  blockNumber: number;
}

interface DeploymentAddresses {
  [network: string]: DeploymentResult;
}

async function runForgeCommand(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('forge', args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Forge command failed with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);
  });
}

async function deployContracts(network: NetworkName, verify: boolean): Promise<DeploymentResult> {
  const config = NETWORKS[network];
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;

  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable is required');
  }

  const account = privateKeyToAccount(privateKey);
  const contractsDir = join(process.cwd(), '../../contracts');

  console.log(`\n🚀 Deploying Messaging Contracts to ${config.name}`);
  console.log(`   RPC: ${config.rpcUrl}`);
  console.log(`   Deployer: ${account.address}`);
  console.log('');

  // Create public client to get block number
  const publicClient = createPublicClient({
    transport: http(config.rpcUrl),
  });

  // Check deployer balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`   Balance: ${Number(balance) / 1e18} ETH`);

  if (balance < parseEther('0.01')) {
    throw new Error('Insufficient balance for deployment (need at least 0.01 ETH)');
  }

  // Build contracts first
  console.log('\n📦 Building contracts...');
  await runForgeCommand(['build'], contractsDir);

  // Deploy KeyRegistry
  console.log('\n📝 Deploying KeyRegistry...');
  const keyRegistryArgs = [
    'create',
    'src/messaging/KeyRegistry.sol:KeyRegistry',
    '--rpc-url', config.rpcUrl,
    '--private-key', privateKey,
    '--broadcast',
    '--json',
  ];

  if (verify) {
    keyRegistryArgs.push('--verify');
  }

  const keyRegistryOutput = await runForgeCommand(keyRegistryArgs, contractsDir);
  const keyRegistryMatch = keyRegistryOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  
  if (!keyRegistryMatch) {
    throw new Error('Failed to extract KeyRegistry address from deployment output');
  }
  
  const keyRegistryAddress = keyRegistryMatch[1] as Address;
  console.log(`   ✅ KeyRegistry deployed at: ${keyRegistryAddress}`);

  // Deploy MessageNodeRegistry
  console.log('\n📝 Deploying MessageNodeRegistry...');
  const nodeRegistryArgs = [
    'create',
    'src/messaging/MessageNodeRegistry.sol:MessageNodeRegistry',
    '--rpc-url', config.rpcUrl,
    '--private-key', privateKey,
    '--broadcast',
    '--json',
  ];

  if (verify) {
    nodeRegistryArgs.push('--verify');
  }

  const nodeRegistryOutput = await runForgeCommand(nodeRegistryArgs, contractsDir);
  const nodeRegistryMatch = nodeRegistryOutput.match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  
  if (!nodeRegistryMatch) {
    throw new Error('Failed to extract MessageNodeRegistry address from deployment output');
  }
  
  const nodeRegistryAddress = nodeRegistryMatch[1] as Address;
  console.log(`   ✅ MessageNodeRegistry deployed at: ${nodeRegistryAddress}`);

  const blockNumber = await publicClient.getBlockNumber();

  const result: DeploymentResult = {
    network,
    keyRegistry: keyRegistryAddress,
    nodeRegistry: nodeRegistryAddress,
    deployer: account.address,
    timestamp: new Date().toISOString(),
    blockNumber: Number(blockNumber),
  };

  // Save deployment addresses
  const deploymentsFile = join(process.cwd(), '../../contracts/deployments/messaging.json');
  let deployments: DeploymentAddresses = {};
  
  if (existsSync(deploymentsFile)) {
    deployments = JSON.parse(readFileSync(deploymentsFile, 'utf-8'));
  }
  
  deployments[network] = result;
  writeFileSync(deploymentsFile, JSON.stringify(deployments, null, 2));
  console.log(`\n💾 Saved deployment addresses to ${deploymentsFile}`);

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  
  // Parse arguments
  let network: NetworkName = 'testnet';
  let verify = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--network' && args[i + 1]) {
      network = args[i + 1] as NetworkName;
      i++;
    } else if (args[i] === '--verify') {
      verify = true;
    }
  }

  if (!NETWORKS[network]) {
    console.error(`Unknown network: ${network}`);
    console.error(`Available networks: ${Object.keys(NETWORKS).join(', ')}`);
    process.exit(1);
  }

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('          JEJU MESSAGING CONTRACTS DEPLOYMENT');
  console.log('═══════════════════════════════════════════════════════════════════');

  const result = await deployContracts(network, verify);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                    DEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`
  Network:           ${result.network}
  KeyRegistry:       ${result.keyRegistry}
  NodeRegistry:      ${result.nodeRegistry}
  Deployer:          ${result.deployer}
  Block Number:      ${result.blockNumber}
  Timestamp:         ${result.timestamp}

  Next Steps:
  1. Update Terraform variables:
     key_registry_address  = "${result.keyRegistry}"
     node_registry_address = "${result.nodeRegistry}"

  2. Update Babylon .env:
     KEY_REGISTRY_ADDRESS=${result.keyRegistry}
     NODE_REGISTRY_ADDRESS=${result.nodeRegistry}

  3. Deploy messaging services:
     cd packages/deployment && bun run scripts/helmfile.ts sync --only messaging
`);
  console.log('═══════════════════════════════════════════════════════════════════');
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});

