#!/usr/bin/env bun
/**
 * JNS (Jeju Name Service) Deployment Script
 * 
 * Deploys the complete JNS stack:
 * - JNSRegistry: Core name registry
 * - JNSResolver: Public resolver with ERC-8004 integration
 * - JNSRegistrar: Name registration controller (ERC-721)
 * - JNSReverseRegistrar: Reverse resolution
 * 
 * Also registers canonical names for all Jeju apps.
 * 
 * Usage:
 *   bun run scripts/deploy/jns.ts               # Deploy to localnet
 *   bun run scripts/deploy/jns.ts --testnet     # Deploy to testnet
 *   bun run scripts/deploy/jns.ts --mainnet     # Deploy to mainnet
 */

import { ethers } from 'ethers';
import { existsSync, mkdirSync } from 'fs';

// Network configuration
const isMainnet = process.argv.includes('--mainnet');
const isTestnet = process.argv.includes('--testnet');
const network = isMainnet ? 'mainnet' : isTestnet ? 'testnet' : 'localnet';

const RPC_URL = isMainnet
  ? process.env.BASE_RPC_URL || 'https://mainnet.base.org'
  : isTestnet
    ? process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org'
    : process.env.RPC_URL || 'http://127.0.0.1:9545';

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || 
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil default

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🏷️  JNS - Jeju Name Service Deployment                  ║
║   Network: ${network.padEnd(44)}║
║   Decentralized naming for hosted apps                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

// Contract ABIs (minimal for deployment) - reserved for future use
const _JNS_REGISTRY_ABI = [
  'constructor()',
  'function setSubnodeOwner(bytes32 node, bytes32 label, address owner) returns (bytes32)',
  'function setResolver(bytes32 node, address resolver)',
  'function owner(bytes32 node) view returns (address)',
  'function version() view returns (string)',
];

const JNS_RESOLVER_ABI = [
  'constructor(address _jns)',
  'function setIdentityRegistry(address _identityRegistry)',
  'function version() view returns (string)',
];

const JNS_REGISTRAR_ABI = [
  'constructor(address _jns, address _defaultResolver, address _treasury)',
  'function setIdentityRegistry(address _identityRegistry)',
  'function claimReserved(string name, address owner, uint256 duration) returns (bytes32)',
  'function version() view returns (string)',
  'function BASE_NODE() view returns (bytes32)',
];

// Reserved for future use
const _JNS_REVERSE_REGISTRAR_ABI = [
  'constructor(address _jns, address _defaultResolver)',
  'function version() view returns (string)',
  'function ADDR_REVERSE_NODE() view returns (bytes32)',
];

// Read compiled artifacts
async function getArtifact(name: string) {
  const path = `packages/contracts/out/${name}.sol/${name}.json`;
  if (!existsSync(path)) {
    throw new Error(`Artifact not found: ${path}. Run 'forge build' first.`);
  }
  return Bun.file(path).json();
}

// Deploy a contract
async function deployContract(
  wallet: ethers.Wallet,
  name: string,
  args: (string | bigint)[] = []
): Promise<ethers.Contract> {
  console.log(`  Deploying ${name}...`);
  
  const artifact = await getArtifact(name);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, wallet);
  
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  console.log(`  ✅ ${name}: ${address}`);
  
  return contract as ethers.Contract;
}

// Compute namehash (ENS algorithm)
function namehash(name: string): string {
  let node = '0x' + '0'.repeat(64);
  
  if (name === '') return node;
  
  const labels = name.split('.').reverse();
  for (const label of labels) {
    const labelHash = ethers.keccak256(ethers.toUtf8Bytes(label));
    node = ethers.keccak256(ethers.concat([node, labelHash]));
  }
  
  return node;
}

// Compute labelhash
function labelhash(label: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(label));
}

async function main() {
  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  
  console.log(`Deployer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} ETH\n`);

  // Check for existing Identity Registry
  const deploymentsPath = `packages/contracts/deployments/${network}`;
  let identityRegistryAddress = '';
  
  if (existsSync(`${deploymentsPath}/deployment.json`)) {
    const existing = await Bun.file(`${deploymentsPath}/deployment.json`).json();
    identityRegistryAddress = existing.IdentityRegistry || '';
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('1️⃣  Deploying Core Contracts...\n');

  // Deploy JNS Registry
  const registry = await deployContract(wallet, 'JNSRegistry');
  const registryAddress = await registry.getAddress();

  // Deploy JNS Resolver
  const resolver = await deployContract(wallet, 'JNSResolver', [registryAddress]);
  const resolverAddress = await resolver.getAddress();

  // Deploy JNS Registrar
  const registrar = await deployContract(wallet, 'JNSRegistrar', [
    registryAddress,
    resolverAddress,
    wallet.address, // Treasury
  ]);
  const registrarAddress = await registrar.getAddress();

  // Deploy Reverse Registrar
  const reverseRegistrar = await deployContract(wallet, 'JNSReverseRegistrar', [
    registryAddress,
    resolverAddress,
  ]);
  const reverseRegistrarAddress = await reverseRegistrar.getAddress();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('2️⃣  Setting Up Registry...\n');

  // Set up .jeju TLD
  console.log('  Setting up .jeju TLD...');
  const rootNode = '0x' + '0'.repeat(64);
  const jejuLabel = labelhash('jeju');
  const jejuNode = namehash('jeju');
  
  // Grant registrar ownership of .jeju
  let tx = await registry.setSubnodeOwner(rootNode, jejuLabel, registrarAddress);
  await tx.wait();
  console.log('  ✅ .jeju TLD created and assigned to Registrar');

  // Set up reverse namespace
  console.log('  Setting up reverse namespace...');
  const reverseLabel = labelhash('reverse');
  const addrLabel = labelhash('addr');
  
  tx = await registry.setSubnodeOwner(rootNode, reverseLabel, wallet.address);
  await tx.wait();
  
  const reverseNode = namehash('reverse');
  tx = await registry.setSubnodeOwner(reverseNode, addrLabel, reverseRegistrarAddress);
  await tx.wait();
  console.log('  ✅ addr.reverse namespace created');

  // Link Identity Registry if available
  if (identityRegistryAddress) {
    console.log('  Linking ERC-8004 Identity Registry...');
    
    const resolverContract = new ethers.Contract(resolverAddress, JNS_RESOLVER_ABI, wallet);
    tx = await resolverContract.setIdentityRegistry(identityRegistryAddress);
    await tx.wait();
    
    const registrarContract = new ethers.Contract(registrarAddress, JNS_REGISTRAR_ABI, wallet);
    tx = await registrarContract.setIdentityRegistry(identityRegistryAddress);
    await tx.wait();
    
    console.log('  ✅ Identity Registry linked');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('3️⃣  Registering Canonical App Names...\n');

  // Canonical app names to register
  const appNames = [
    { name: 'gateway', owner: wallet.address },
    { name: 'bazaar', owner: wallet.address },
    { name: 'compute', owner: wallet.address },
    { name: 'storage', owner: wallet.address },
    { name: 'indexer', owner: wallet.address },
    { name: 'cloud', owner: wallet.address },
    { name: 'docs', owner: wallet.address },
    { name: 'monitoring', owner: wallet.address },
  ];

  const registrarContract = new ethers.Contract(registrarAddress, JNS_REGISTRAR_ABI, wallet);
  const oneYear = 365 * 24 * 60 * 60;

  for (const app of appNames) {
    console.log(`  Registering ${app.name}.jeju...`);
    tx = await registrarContract.claimReserved(app.name, app.owner, oneYear);
    await tx.wait();
    console.log(`  ✅ ${app.name}.jeju registered`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('4️⃣  Saving Deployment...\n');

  // Save deployment
  if (!existsSync(deploymentsPath)) {
    mkdirSync(deploymentsPath, { recursive: true });
  }

  const deployment = {
    network,
    timestamp: new Date().toISOString(),
    deployer: wallet.address,
    contracts: {
      JNSRegistry: registryAddress,
      JNSResolver: resolverAddress,
      JNSRegistrar: registrarAddress,
      JNSReverseRegistrar: reverseRegistrarAddress,
    },
    nodes: {
      root: rootNode,
      jeju: jejuNode,
      reverse: namehash('reverse'),
      addrReverse: namehash('addr.reverse'),
    },
    canonicalNames: appNames.map(a => ({ name: `${a.name}.jeju`, node: namehash(`${a.name}.jeju`) })),
  };

  await Bun.write(
    `${deploymentsPath}/jns-deployment.json`,
    JSON.stringify(deployment, null, 2)
  );

  // Also update main deployment file
  let mainDeployment: Record<string, string> = {};
  if (existsSync(`${deploymentsPath}/deployment.json`)) {
    mainDeployment = await Bun.file(`${deploymentsPath}/deployment.json`).json();
  }
  
  mainDeployment = {
    ...mainDeployment,
    JNSRegistry: registryAddress,
    JNSResolver: resolverAddress,
    JNSRegistrar: registrarAddress,
    JNSReverseRegistrar: reverseRegistrarAddress,
  };
  
  await Bun.write(
    `${deploymentsPath}/deployment.json`,
    JSON.stringify(mainDeployment, null, 2)
  );

  console.log(`  ✅ Deployment saved to ${deploymentsPath}/jns-deployment.json\n`);

  // Print summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📋 JNS Deployment Summary:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Network:              ${network}`);
  console.log(`  JNS Registry:         ${registryAddress}`);
  console.log(`  JNS Resolver:         ${resolverAddress}`);
  console.log(`  JNS Registrar:        ${registrarAddress}`);
  console.log(`  JNS Reverse:          ${reverseRegistrarAddress}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📦 Registered App Names:');
  for (const app of appNames) {
    console.log(`  • ${app.name}.jeju`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('🎉 JNS deployment complete.\n');
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error);
  process.exit(1);
});


