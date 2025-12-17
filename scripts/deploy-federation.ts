#!/usr/bin/env bun
/**
 * Deploy Federation Contracts
 * 
 * Deploys all federation infrastructure for cross-chain interop:
 * - NetworkRegistry: Hub for all federated networks
 * - RegistryHub: Meta-registry tracking all registries
 * - RegistrySyncOracle: Event-driven registry sync
 * - SolanaVerifier: Wormhole-based Solana verification
 * - FederatedIdentity: Cross-chain identity
 * - FederatedLiquidity: Cross-chain liquidity
 * - FederatedSolver: Cross-chain solver discovery
 * 
 * Usage:
 *   bun run scripts/deploy-federation.ts [--network localnet|testnet|mainnet]
 */

import { Wallet, JsonRpcProvider, ContractFactory, Contract, parseEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const NETWORK = process.argv.includes('--network') 
  ? process.argv[process.argv.indexOf('--network') + 1] 
  : 'localnet';

const CONTRACTS_DIR = join(import.meta.dir, '../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');
const DEPLOYMENTS_DIR = join(import.meta.dir, '../deployments');

interface FederationDeployment {
  networkRegistry: string;
  registryHub: string;
  registrySyncOracle: string;
  solanaVerifier: string;
  federatedIdentity: string;
  federatedLiquidity: string;
  federatedSolver: string;
  deployedAt: string;
  deployer: string;
  chainId: number;
}

function getArtifact(contractName: string): { abi: unknown[]; bytecode: string } {
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
  
  console.log(`  Deploying ${contractName}...`);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`  ✓ ${contractName}: ${address}`);
  
  return contract;
}

async function main() {
  console.log(`\n🌐 Deploying Federation Contracts (${NETWORK})\n`);

  // Get RPC URL based on network
  const rpcUrls: Record<string, string> = {
    localnet: 'http://localhost:9545',
    testnet: process.env.TESTNET_RPC_URL || 'https://testnet-rpc.jejunetwork.org',
    mainnet: process.env.MAINNET_RPC_URL || 'https://rpc.jejunetwork.org',
  };

  const rpcUrl = rpcUrls[NETWORK];
  if (!rpcUrl) {
    throw new Error(`Unknown network: ${NETWORK}`);
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const chainId = Number((await provider.getNetwork()).chainId);
  
  // Get deployer wallet
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Default Anvil key
  const wallet = new Wallet(privateKey, provider);
  
  console.log(`Network: ${NETWORK} (chainId: ${chainId})`);
  console.log(`RPC: ${rpcUrl}`);
  console.log(`Deployer: ${wallet.address}`);
  console.log(`Balance: ${await provider.getBalance(wallet.address)}\n`);

  // Deploy contracts
  console.log('Deploying federation contracts...\n');

  // 1. NetworkRegistry
  const networkRegistry = await deployContract(wallet, 'NetworkRegistry', [wallet.address]);

  // 2. RegistryHub
  const registryHub = await deployContract(wallet, 'RegistryHub', [wallet.address]);

  // 3. RegistrySyncOracle
  const registrySyncOracle = await deployContract(wallet, 'RegistrySyncOracle', []);

  // 4. SolanaVerifier
  const solanaVerifier = await deployContract(wallet, 'SolanaVerifier', [
    wallet.address, // wormhole relayer (deployer for now)
    '0x0000000000000000000000000000000000000000000000000000000000000000', // trusted emitter
  ]);

  // 5. FederatedIdentity
  const federatedIdentity = await deployContract(wallet, 'FederatedIdentity', [
    chainId,
    wallet.address, // oracle
    wallet.address, // governance
    await networkRegistry.getAddress(),
    '0x0000000000000000000000000000000000000000', // local identity registry
  ]);

  // 6. FederatedLiquidity
  const federatedLiquidity = await deployContract(wallet, 'FederatedLiquidity', [
    chainId,
    wallet.address, // oracle
    wallet.address, // governance
    await networkRegistry.getAddress(),
    '0x0000000000000000000000000000000000000000', // local vault
  ]);

  // 7. FederatedSolver
  const federatedSolver = await deployContract(wallet, 'FederatedSolver', [
    chainId,
    wallet.address, // oracle
    wallet.address, // governance
    await networkRegistry.getAddress(),
    '0x0000000000000000000000000000000000000000', // local solver registry
  ]);

  // Save deployment addresses
  const deployment: FederationDeployment = {
    networkRegistry: await networkRegistry.getAddress(),
    registryHub: await registryHub.getAddress(),
    registrySyncOracle: await registrySyncOracle.getAddress(),
    solanaVerifier: await solanaVerifier.getAddress(),
    federatedIdentity: await federatedIdentity.getAddress(),
    federatedLiquidity: await federatedLiquidity.getAddress(),
    federatedSolver: await federatedSolver.getAddress(),
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
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
    
    const contracts = {
      identityRegistry: '0x0000000000000000000000000000000000000000',
      solverRegistry: '0x0000000000000000000000000000000000000000',
      inputSettler: '0x0000000000000000000000000000000000000000',
      outputSettler: '0x0000000000000000000000000000000000000000',
      liquidityVault: '0x0000000000000000000000000000000000000000',
      governance: '0x0000000000000000000000000000000000000000',
      oracle: '0x0000000000000000000000000000000000000000',
      registryHub: deployment.registryHub,
    };

    const tx = await networkRegistry.registerNetwork(
      chainId,
      'Jeju Localnet',
      rpcUrl,
      'http://localhost:4000',
      'ws://localhost:9546',
      contracts,
      '0x0000000000000000000000000000000000000000000000000000000000000000',
      { value: parseEther('10') } // VERIFIED stake
    );
    await tx.wait();
    
    console.log('✓ Jeju Network registered with VERIFIED status (10 ETH stake)');
    
    // Register the network in RegistryHub too
    const registryHubContract = new Contract(
      deployment.registryHub,
      getArtifact('RegistryHub').abi,
      wallet
    );
    
    const tx2 = await registryHubContract.registerChain(
      chainId,
      0, // ChainType.EVM
      'Jeju Localnet',
      rpcUrl,
      { value: parseEther('10') }
    );
    await tx2.wait();
    
    console.log('✓ Jeju registered in RegistryHub with VERIFIED tier');
  }

  return deployment;
}

main().catch(console.error);

