#!/usr/bin/env bun
/**
 * Deploy Federation Contracts
 * 
 * Deploys the federation stack:
 * - NetworkRegistry (on hub chain)
 * - FederatedIdentity (on local chain)
 * - FederatedSolver (on local chain)
 * - FederatedLiquidity (on local chain)
 * 
 * Usage:
 *   bun run scripts/deploy/federation.ts [network]
 *   NETWORK=testnet bun run scripts/deploy/federation.ts
 */

import { $ } from 'bun';
import { Wallet, JsonRpcProvider, ContractFactory, parseEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const CONTRACTS_DIR = join(ROOT, 'packages/contracts');
const CONFIG_DIR = join(ROOT, 'packages/config');

type NetworkType = 'localnet' | 'testnet' | 'mainnet';

const NETWORK = (process.env.NETWORK || process.argv[2] || 'localnet') as NetworkType;

interface ChainConfig {
  chainId: number;
  rpcUrl: string;
}

interface FederationDeployment {
  network: string;
  chainId: number;
  hub: {
    chainId: number;
    networkRegistry: string;
  };
  local: {
    federatedIdentity: string;
    federatedSolver: string;
    federatedLiquidity: string;
  };
  deployedAt: string;
}

const CHAIN_CONFIGS: Record<NetworkType, { local: ChainConfig; hub: ChainConfig }> = {
  localnet: {
    local: { chainId: 1337, rpcUrl: 'http://localhost:9545' },
    hub: { chainId: 31337, rpcUrl: 'http://localhost:8545' },
  },
  testnet: {
    local: { chainId: 420690, rpcUrl: 'https://testnet-rpc.jeju.network' },
    hub: { chainId: 11155111, rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com' },
  },
  mainnet: {
    local: { chainId: 420691, rpcUrl: 'https://rpc.jeju.network' },
    hub: { chainId: 1, rpcUrl: 'https://eth.llamarpc.com' },
  },
};

async function getPrivateKey(): Promise<string> {
  const key = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (key) return key;

  if (NETWORK === 'localnet') {
    return '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  }

  throw new Error('DEPLOYER_PRIVATE_KEY required');
}

async function deployContract(
  provider: JsonRpcProvider,
  wallet: Wallet,
  name: string,
  args: (string | number | bigint)[] = []
): Promise<string> {
  const abiPath = join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`);
  
  if (!existsSync(abiPath)) {
    console.log(`Building contracts...`);
    await $`cd ${CONTRACTS_DIR} && forge build`.quiet();
  }

  const artifact = JSON.parse(readFileSync(abiPath, 'utf-8'));
  const factory = new ContractFactory(artifact.abi, artifact.bytecode.object, wallet);

  console.log(`Deploying ${name}...`);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`  ${name}: ${address}`);

  return address;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  FEDERATION DEPLOYMENT: ${NETWORK.toUpperCase()}`);
  console.log(`${'='.repeat(60)}\n`);

  const config = CHAIN_CONFIGS[NETWORK];
  const privateKey = await getPrivateKey();

  const hubProvider = new JsonRpcProvider(config.hub.rpcUrl);
  const localProvider = new JsonRpcProvider(config.local.rpcUrl);

  const hubWallet = new Wallet(privateKey, hubProvider);
  const localWallet = new Wallet(privateKey, localProvider);

  console.log(`Deployer: ${hubWallet.address}`);
  console.log(`Hub Chain: ${config.hub.chainId}`);
  console.log(`Local Chain: ${config.local.chainId}\n`);

  const hubBalance = await hubProvider.getBalance(hubWallet.address);
  const localBalance = await localProvider.getBalance(localWallet.address);

  console.log(`Hub Balance: ${(Number(hubBalance) / 1e18).toFixed(4)} ETH`);
  console.log(`Local Balance: ${(Number(localBalance) / 1e18).toFixed(4)} ETH\n`);

  if (hubBalance < parseEther('0.1')) {
    throw new Error('Insufficient hub chain balance');
  }

  if (localBalance < parseEther('0.1')) {
    throw new Error('Insufficient local chain balance');
  }

  console.log('Deploying Hub Contracts...\n');

  const networkRegistry = await deployContract(
    hubProvider,
    hubWallet,
    'NetworkRegistry',
    [hubWallet.address]
  );

  console.log('\nDeploying Local Contracts...\n');

  const federatedIdentity = await deployContract(
    localProvider,
    localWallet,
    'FederatedIdentity',
    [
      config.local.chainId,
      localWallet.address,
      localWallet.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000',
    ]
  );

  const federatedSolver = await deployContract(
    localProvider,
    localWallet,
    'FederatedSolver',
    [
      config.local.chainId,
      localWallet.address,
      localWallet.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000',
    ]
  );

  const federatedLiquidity = await deployContract(
    localProvider,
    localWallet,
    'FederatedLiquidity',
    [
      config.local.chainId,
      localWallet.address,
      localWallet.address,
      networkRegistry,
      '0x0000000000000000000000000000000000000000',
    ]
  );

  const deployment: FederationDeployment = {
    network: NETWORK,
    chainId: config.local.chainId,
    hub: {
      chainId: config.hub.chainId,
      networkRegistry,
    },
    local: {
      federatedIdentity,
      federatedSolver,
      federatedLiquidity,
    },
    deployedAt: new Date().toISOString(),
  };

  const outputPath = join(CONTRACTS_DIR, `deployments/federation-${NETWORK}.json`);
  writeFileSync(outputPath, JSON.stringify(deployment, null, 2));

  console.log(`\n${'='.repeat(60)}`);
  console.log('  DEPLOYMENT COMPLETE');
  console.log(`${'='.repeat(60)}\n`);

  console.log('Hub Contracts:');
  console.log(`  NetworkRegistry: ${networkRegistry}`);

  console.log('\nLocal Contracts:');
  console.log(`  FederatedIdentity: ${federatedIdentity}`);
  console.log(`  FederatedSolver: ${federatedSolver}`);
  console.log(`  FederatedLiquidity: ${federatedLiquidity}`);

  console.log(`\nSaved to: ${outputPath}\n`);
}

main().catch(err => {
  console.error('\nDeployment failed:', err.message);
  process.exit(1);
});

