/**
 * Deploy Messaging Contracts to the network Localnet
 * 
 * Usage: bun run scripts/deploy-contracts.ts
 * 
 * This script:
 * 1. Compiles contracts using Foundry
 * 2. Deploys KeyRegistry contract
 * 3. Writes deployment addresses to JSON
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

// ============ Configuration ============

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:9545';
const PRIVATE_KEY = process.env.PRIVATE_KEY ?? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Use IdentityRegistry address from deployed contracts (required for KeyRegistry)
const IDENTITY_REGISTRY_ADDRESS = process.env.IDENTITY_REGISTRY_ADDRESS as Address | undefined;

// Network localnet chain config
const jejuLocalnet = {
  id: 1337,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
};

// Paths
const CONTRACTS_DIR = path.resolve(import.meta.dir, '../contracts');
const OUT_DIR = path.resolve(CONTRACTS_DIR, 'out');
const DEPLOYMENTS_DIR = path.resolve(import.meta.dir, '../deployments');

// ============ Contract Artifacts ============

interface ContractArtifact {
  abi: readonly object[];
  bytecode: { object: Hex };
}

function loadArtifact(contractName: string): ContractArtifact {
  const artifactPath = path.join(OUT_DIR, `${contractName}.sol`, `${contractName}.json`);
  
  if (!existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found at ${artifactPath}. Run 'forge build' first.`);
  }
  
  const artifact = require(artifactPath);
  return {
    abi: artifact.abi,
    bytecode: { object: `0x${artifact.bytecode.object.replace(/^0x/, '')}` as Hex },
  };
}

// ============ Compile Contracts ============

function compileContracts(): void {
  console.log('📦 Compiling contracts with Foundry...');
  
  if (!existsSync(CONTRACTS_DIR)) {
    throw new Error(`Contracts directory not found at ${CONTRACTS_DIR}`);
  }
  
  try {
    execSync('forge build', {
      cwd: CONTRACTS_DIR,
      stdio: 'inherit',
    });
    console.log('   Compilation successful\n');
  } catch (error) {
    throw new Error(`Forge build failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============ Deploy Contract ============

async function deployContract(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>,
  artifact: ContractArtifact,
  constructorArgs: readonly Hex[] = [],
  contractName: string,
): Promise<Address> {
  console.log(`   Deploying ${contractName}...`);
  
  // Encode constructor args
  const { encodeAbiParameters, parseAbiParameters } = await import('viem');
  
  let deployData = artifact.bytecode.object;
  
  if (constructorArgs.length > 0) {
    // Get constructor from ABI
    const constructor = artifact.abi.find((item): item is { type: 'constructor'; inputs: readonly { type: string; name: string }[] } => 
      'type' in item && item.type === 'constructor'
    );
    
    if (constructor && constructor.inputs.length > 0) {
      const encodedArgs = encodeAbiParameters(
        constructor.inputs as readonly { type: string; name: string }[],
        constructorArgs,
      );
      deployData = `${artifact.bytecode.object}${encodedArgs.slice(2)}` as Hex;
    }
  }
  
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: deployData,
    args: constructorArgs,
  });
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  if (!receipt.contractAddress) {
    throw new Error(`${contractName} deployment failed: no contract address in receipt`);
  }
  
  console.log(`   Deployed at: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

// ============ Main Deployment ============

async function main() {
  console.log('🚀 Deploying Messaging Contracts\n');
  console.log('RPC URL:', RPC_URL);
  
  // Compile contracts first
  compileContracts();
  
  // Create clients
  const account = privateKeyToAccount(PRIVATE_KEY as Hex);
  console.log('Deployer:', account.address);
  
  const publicClient = createPublicClient({
    chain: jejuLocalnet,
    transport: http(RPC_URL),
  });
  
  const walletClient = createWalletClient({
    account,
    chain: jejuLocalnet,
    transport: http(RPC_URL),
  });
  
  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log('Balance:', Number(balance) / 1e18, 'ETH\n');
  
  if (balance < parseEther('0.1')) {
    throw new Error('Insufficient balance for deployment. Need at least 0.1 ETH.');
  }
  
  // Get or deploy IdentityRegistry
  let identityRegistryAddress = IDENTITY_REGISTRY_ADDRESS;
  
  if (!identityRegistryAddress) {
    console.log('📦 IdentityRegistry address not provided.');
    console.log('   Set IDENTITY_REGISTRY_ADDRESS env var to use existing deployment.');
    console.log('   Deploying new IdentityRegistry for testing...\n');
    
    // Try to load and deploy IdentityRegistry from packages/contracts
    const contractsOutDir = path.resolve(import.meta.dir, '../../../contracts/out');
    const identityRegistryPath = path.join(contractsOutDir, 'IdentityRegistry.sol', 'IdentityRegistry.json');
    
    if (existsSync(identityRegistryPath)) {
      const artifact = require(identityRegistryPath);
      const identityArtifact: ContractArtifact = {
        abi: artifact.abi,
        bytecode: { object: `0x${artifact.bytecode.object.replace(/^0x/, '')}` as Hex },
      };
      
      identityRegistryAddress = await deployContract(
        walletClient,
        publicClient,
        identityArtifact,
        [],
        'IdentityRegistry',
      );
    } else {
      throw new Error(
        'IdentityRegistry artifact not found. Either:\n' +
        '  1. Set IDENTITY_REGISTRY_ADDRESS to use existing deployment\n' +
        '  2. Run "forge build" in packages/contracts first'
      );
    }
  }
  
  console.log('\n📦 Deploying KeyRegistry...');
  
  // Load KeyRegistry artifact
  const keyRegistryArtifact = loadArtifact('KeyRegistry');
  
  // Deploy KeyRegistry with IdentityRegistry address as constructor arg
  const keyRegistryAddress = await deployContract(
    walletClient,
    publicClient,
    keyRegistryArtifact,
    [identityRegistryAddress as Hex],
    'KeyRegistry',
  );
  
  // ============ Output Addresses ============
  
  console.log('\n📋 Deployment Summary:');
  console.log('─'.repeat(50));
  
  const deploymentInfo = {
    network: 'jeju-localnet',
    chainId: 1337,
    rpcUrl: RPC_URL,
    deployer: account.address,
    contracts: {
      identityRegistry: identityRegistryAddress,
      keyRegistry: keyRegistryAddress,
    },
    timestamp: new Date().toISOString(),
  };
  
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // ============ Write to File ============
  
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  
  const outputPath = path.join(DEPLOYMENTS_DIR, 'messaging-localnet.json');
  await Bun.write(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n✅ Deployment info written to ${outputPath}`);
  
  // ============ Verify Deployment ============
  
  console.log('\n🔍 Verifying deployment...');
  
  const keyRegistryVersion = await publicClient.readContract({
    address: keyRegistryAddress,
    abi: keyRegistryArtifact.abi,
    functionName: 'version',
  });
  
  console.log(`   KeyRegistry version: ${keyRegistryVersion}`);
  
  const registryAddress = await publicClient.readContract({
    address: keyRegistryAddress,
    abi: keyRegistryArtifact.abi,
    functionName: 'identityRegistry',
  });
  
  if (registryAddress !== identityRegistryAddress) {
    throw new Error('IdentityRegistry address mismatch in KeyRegistry');
  }
  
  console.log(`   IdentityRegistry linked: ${registryAddress}`);
  console.log('\n✅ Deployment verified successfully');
}

main().catch((error) => {
  console.error('\n❌ Deployment failed:', error.message);
  process.exit(1);
});
