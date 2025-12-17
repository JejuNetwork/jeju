#!/usr/bin/env bun
/**
 * JNS (Network Name Service) Deployment Script
 * 
 * Deploys the complete JNS stack:
 * - JNSRegistry: Core name registry
 * - JNSResolver: Public resolver with ERC-8004 integration
 * - JNSRegistrar: Name registration controller (ERC-721)
 * - JNSReverseRegistrar: Reverse resolution
 * 
 * Also registers canonical name: getNetworkName() apps.
 * 
 * Usage:
 *   bun run scripts/deploy/jns.ts               # Deploy to localnet
 *   bun run scripts/deploy/jns.ts --testnet     # Deploy to testnet
 *   bun run scripts/deploy/jns.ts --mainnet     # Deploy to mainnet
 */

import { createPublicClient, createWalletClient, http, keccak256, toUtf8Bytes, concat, encodeDeployData, getContractAddress, type Address, type Chain, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { waitForTransactionReceipt } from 'viem/actions';
import { parseAbi } from 'viem';
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
║   🏷️  JNS - Network Name Service Deployment                  ║
║   Network: ${network.padEnd(44)}║
║   Decentralized naming for hosted apps                   ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

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
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  account: ReturnType<typeof privateKeyToAccount>,
  name: string,
  args: (string | bigint)[] = []
): Promise<Address> {
  console.log(`  Deploying ${name}...`);
  
  const artifact = await getArtifact(name);
  
  const deployData = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
    args,
  });
  
  const nonce = await publicClient.getTransactionCount({
    address: account.address,
  });
  
  const txHash = await walletClient.sendTransaction({
    data: deployData,
    account,
  });
  
  const receipt = await waitForTransactionReceipt(publicClient, {
    hash: txHash,
    timeout: 120_000,
  });
  
  if (receipt.status !== 'success') {
    throw new Error(`Deployment failed: ${name} (tx: ${txHash})`);
  }
  
  let address: Address;
  if (receipt.contractAddress) {
    address = receipt.contractAddress;
  } else {
    address = getContractAddress({
      from: account.address,
      nonce: BigInt(nonce),
    });
  }
  
  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await publicClient.getCode({ address });
    if (code && code !== '0x') {
      console.log(`  ✅ ${name}: ${address}`);
      return address;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  
  throw new Error(`Contract not found at expected address: ${address} (tx: ${txHash})`);
}

// Compute namehash (ENS algorithm)
function namehash(name: string): `0x${string}` {
  let node = '0x' + '0'.repeat(64) as `0x${string}`;
  
  if (name === '') return node;
  
  const labels = name.split('.').reverse();
  for (const label of labels) {
    const labelHash = keccak256(toUtf8Bytes(label));
    node = keccak256(concat([node, labelHash]));
  }
  
  return node;
}

// Compute labelhash
function labelhash(label: string): `0x${string}` {
  return keccak256(toUtf8Bytes(label));
}

async function main() {
  const chain = { id: network === 'mainnet' ? 8453 : network === 'testnet' ? 84532 : 31337, name: network } as Chain;
  const publicClient = createPublicClient({
    chain,
    transport: http(RPC_URL),
  });
  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(RPC_URL),
  });
  
  console.log(`Deployer: ${account.address}`);
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`Balance: ${formatEther(balance)} ETH\n`);

  const deploymentsPath = `packages/contracts/deployments/${network}`;
  let identityRegistryAddress = '';
  
  if (existsSync(`${deploymentsPath}/deployment.json`)) {
    const existing = await Bun.file(`${deploymentsPath}/deployment.json`).json();
    identityRegistryAddress = existing.IdentityRegistry || '';
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('1️⃣  Deploying Core Contracts...\n');

  const registryAddress = await deployContract(publicClient, walletClient, account, 'JNSRegistry', []);
  const resolverAddress = await deployContract(publicClient, walletClient, account, 'JNSResolver', [registryAddress]);
  const registrarAddress = await deployContract(publicClient, walletClient, account, 'JNSRegistrar', [
    registryAddress,
    resolverAddress,
    account.address,
  ]);
  const reverseRegistrarAddress = await deployContract(publicClient, walletClient, account, 'JNSReverseRegistrar', [
    registryAddress,
    resolverAddress,
  ]);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('2️⃣  Setting Up Registry...\n');

  console.log('  Setting up .jeju TLD...');
  const rootNode = '0x' + '0'.repeat(64);
  const jejuLabel = labelhash('jeju');
  const jejuNode = namehash('jeju');
  
  // Grant registrar ownership of .jeju
  const registryAbi = parseAbi(['function setSubnodeOwner(bytes32 node, bytes32 label, address owner)']);
  let hash = await walletClient.writeContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [rootNode as `0x${string}`, jejuLabel, registrarAddress],
    account,
  });
  await waitForTransactionReceipt(publicClient, { hash });
  console.log('  ✅ .jeju TLD created and assigned to Registrar');

  console.log('  Setting up reverse namespace...');
  const reverseLabel = labelhash('reverse');
  const addrLabel = labelhash('addr');
  
  hash = await walletClient.writeContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [rootNode as `0x${string}`, reverseLabel, account.address],
    account,
  });
  await waitForTransactionReceipt(publicClient, { hash });
  
  const reverseNode = namehash('reverse');
  hash = await walletClient.writeContract({
    address: registryAddress,
    abi: registryAbi,
    functionName: 'setSubnodeOwner',
    args: [reverseNode, addrLabel, reverseRegistrarAddress],
    account,
  });
  await waitForTransactionReceipt(publicClient, { hash });
  console.log('  ✅ addr.reverse namespace created');

  if (identityRegistryAddress) {
    console.log('  Linking ERC-8004 Identity Registry...');
    
    const resolverAbi = parseAbi(JNS_RESOLVER_ABI);
    hash = await walletClient.writeContract({
      address: resolverAddress,
      abi: resolverAbi,
      functionName: 'setIdentityRegistry',
      args: [identityRegistryAddress as Address],
      account,
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    const registrarAbi = parseAbi(JNS_REGISTRAR_ABI);
    hash = await walletClient.writeContract({
      address: registrarAddress,
      abi: registrarAbi,
      functionName: 'setIdentityRegistry',
      args: [identityRegistryAddress as Address],
      account,
    });
    await waitForTransactionReceipt(publicClient, { hash });
    
    console.log('  ✅ Identity Registry linked');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('3️⃣  Registering Canonical App Names...\n');

  const appNames = [
    { name: 'gateway', owner: account.address },
    { name: 'bazaar', owner: account.address },
    { name: 'compute', owner: account.address },
    { name: 'storage', owner: account.address },
    { name: 'indexer', owner: account.address },
    { name: 'cloud', owner: account.address },
    { name: 'docs', owner: account.address },
    { name: 'monitoring', owner: account.address },
  ];

  const registrarAbi = parseAbi(JNS_REGISTRAR_ABI);
  const oneYear = BigInt(365 * 24 * 60 * 60);

  for (const app of appNames) {
    console.log(`  Registering ${app.name}.jeju...`);
    hash = await walletClient.writeContract({
      address: registrarAddress,
      abi: registrarAbi,
      functionName: 'claimReserved',
      args: [app.name, app.owner as Address, oneYear],
      account,
    });
    await waitForTransactionReceipt(publicClient, { hash });
    console.log(`  ✅ ${app.name}.jeju registered`);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('4️⃣  Saving Deployment...\n');

  if (!existsSync(deploymentsPath)) {
    mkdirSync(deploymentsPath, { recursive: true });
  }

  const deployment = {
    network,
    timestamp: new Date().toISOString(),
    deployer: account.address,
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


