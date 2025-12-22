#!/usr/bin/env bun
/**
 * Configure Hyperlane Trusted Remotes
 * 
 * This script sets up trusted remote contracts for cross-chain identity sync.
 * It connects CrossChainIdentitySync contracts on different chains so they can
 * communicate via Hyperlane.
 * 
 * Usage:
 *   bun run scripts/configure-hyperlane-remotes.ts [--network localnet|testnet|mainnet]
 */

import { createPublicClient, createWalletClient, http, type Address, padHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const NETWORK = process.argv.includes('--network') 
  ? process.argv[process.argv.indexOf('--network') + 1] 
  : 'testnet';

const CONFIG_DIR = join(import.meta.dir, '../packages/config');
const DEPLOYMENTS_DIR = join(import.meta.dir, '../deployments');

interface CrossChainConfig {
  hyperlane: Record<string, { mailbox: string; domain: number; igp: string }>;
}

interface FederationDeployment {
  crossChainIdentitySync: string;
  hyperlaneDomain: number;
}

// ABI for CrossChainIdentitySync.setTrustedRemote
const CROSS_CHAIN_IDENTITY_SYNC_ABI = [
  {
    "inputs": [
      { "internalType": "uint32", "name": "domain", "type": "uint32" },
      { "internalType": "bytes32", "name": "remote", "type": "bytes32" }
    ],
    "name": "setTrustedRemote",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "uint32", "name": "", "type": "uint32" }],
    "name": "trustedRemotes",
    "outputs": [{ "internalType": "bytes32", "name": "", "type": "bytes32" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getConnectedDomains",
    "outputs": [{ "internalType": "uint32[]", "name": "", "type": "uint32[]" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

// Known deployments on different networks
interface NetworkDeployment {
  chain: string;
  rpcUrl: string;
  deployment?: FederationDeployment;
  domain: number;
}

function loadCrossChainConfig(): CrossChainConfig {
  const configPath = join(CONFIG_DIR, 'cross-chain.json');
  if (!existsSync(configPath)) {
    throw new Error(`Cross-chain config not found: ${configPath}`);
  }
  return JSON.parse(readFileSync(configPath, 'utf-8'));
}

function loadDeployment(network: string): FederationDeployment | undefined {
  const deploymentPath = join(DEPLOYMENTS_DIR, `federation-${network}.json`);
  if (!existsSync(deploymentPath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(deploymentPath, 'utf-8'));
}

function addressToBytes32(address: Address): `0x${string}` {
  return padHex(address, { size: 32 });
}

async function main() {
  console.log(`\n🔗 Configuring Hyperlane Trusted Remotes (${NETWORK})\n`);

  const crossChainConfig = loadCrossChainConfig();
  
  // Define networks to configure
  const networks: NetworkDeployment[] = [
    {
      chain: 'baseSepolia',
      rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      deployment: loadDeployment('testnet'),
      domain: crossChainConfig.hyperlane.baseSepolia.domain,
    },
    {
      chain: 'base',
      rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      deployment: loadDeployment('mainnet'),
      domain: crossChainConfig.hyperlane.base.domain,
    },
  ];

  // Get deployer wallet
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  
  console.log(`Deployer: ${account.address}\n`);

  // Filter to only networks with deployments
  const deployedNetworks = networks.filter(n => n.deployment?.crossChainIdentitySync);
  
  if (deployedNetworks.length < 2) {
    console.log('⚠️  Need at least 2 deployments to configure trusted remotes');
    console.log('   Deploy CrossChainIdentitySync on multiple networks first.\n');
    
    // Create sample configuration for documentation
    console.log('Sample configuration commands:');
    console.log('==============================\n');
    
    for (const source of networks) {
      for (const target of networks) {
        if (source.chain === target.chain) continue;
        
        console.log(`# Configure ${source.chain} to trust ${target.chain}:`);
        console.log(`cast send <CrossChainIdentitySync on ${source.chain}> \\`);
        console.log(`  "setTrustedRemote(uint32,bytes32)" \\`);
        console.log(`  ${target.domain} \\`);
        console.log(`  $(cast --to-bytes32 <CrossChainIdentitySync on ${target.chain}>) \\`);
        console.log(`  --rpc-url <${source.chain}_RPC_URL> \\`);
        console.log(`  --private-key <DEPLOYER_KEY>\n`);
      }
    }
    
    return;
  }

  console.log(`Found ${deployedNetworks.length} deployed networks:`);
  for (const net of deployedNetworks) {
    console.log(`  - ${net.chain} (domain ${net.domain}): ${net.deployment!.crossChainIdentitySync}`);
  }
  console.log('');

  // Configure each network to trust all other networks
  for (const source of deployedNetworks) {
    console.log(`\nConfiguring ${source.chain}...`);
    
    const publicClient = createPublicClient({ 
      transport: http(source.rpcUrl) 
    });
    const walletClient = createWalletClient({ 
      account, 
      transport: http(source.rpcUrl) 
    });
    
    const sourceAddress = source.deployment!.crossChainIdentitySync as Address;

    for (const target of deployedNetworks) {
      if (source.chain === target.chain) continue;
      
      const targetDomain = target.domain;
      const targetAddress = target.deployment!.crossChainIdentitySync as Address;
      const targetBytes32 = addressToBytes32(targetAddress);
      
      // Check if already configured
      const currentRemote = await publicClient.readContract({
        address: sourceAddress,
        abi: CROSS_CHAIN_IDENTITY_SYNC_ABI,
        functionName: 'trustedRemotes',
        args: [targetDomain],
      });
      
      if (currentRemote === targetBytes32) {
        console.log(`  ✓ ${target.chain} (domain ${targetDomain}) already trusted`);
        continue;
      }
      
      // Configure trusted remote
      console.log(`  Setting trusted remote for ${target.chain} (domain ${targetDomain})...`);
      
      const hash = await walletClient.writeContract({
        address: sourceAddress,
        abi: CROSS_CHAIN_IDENTITY_SYNC_ABI,
        functionName: 'setTrustedRemote',
        args: [targetDomain, targetBytes32],
      });
      
      await publicClient.waitForTransactionReceipt({ hash });
      console.log(`  ✓ ${target.chain} configured (tx: ${hash})`);
    }
    
    // List all connected domains
    const connectedDomains = await publicClient.readContract({
      address: sourceAddress,
      abi: CROSS_CHAIN_IDENTITY_SYNC_ABI,
      functionName: 'getConnectedDomains',
    });
    
    console.log(`  Connected domains: ${connectedDomains.join(', ')}`);
  }

  console.log('\n✅ Hyperlane trusted remotes configured!\n');
  
  // Print summary
  console.log('Cross-Chain Identity Sync Configuration:');
  console.log('=========================================');
  for (const net of deployedNetworks) {
    console.log(`${net.chain.padEnd(15)} | Domain ${net.domain.toString().padStart(5)} | ${net.deployment!.crossChainIdentitySync}`);
  }
  console.log('');
}

main().catch(console.error);
