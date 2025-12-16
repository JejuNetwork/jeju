#!/usr/bin/env bun
/**
 * TokenLaunchpad Deployment Script
 * 
 * Deploys the TokenLaunchpad system for token launches:
 * - LPLocker (template for LP token locking)
 * - TokenLaunchpad (factory for bonding curve and ICO launches)
 * 
 * Requires:
 * - XLP V2 Factory (or Uniswap V2 compatible factory)
 * - WETH address
 * 
 * Usage:
 *   bun run scripts/deploy-launchpad.ts
 *   bun run scripts/deploy-launchpad.ts --network testnet
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry, baseSepolia } from 'viem/chains';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import * as path from 'path';

// Default anvil private key
const DEPLOYER_KEY =
  process.env.DEPLOYER_PRIVATE_KEY ||
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Network configurations
const NETWORKS = {
  localnet: {
    chain: foundry,
    rpcUrl: 'http://localhost:8545',
    weth: '0x4200000000000000000000000000000000000006' as Address,
    xlpV2Factory: null as Address | null, // Will use mock or skip LP features
    communityVault: null as Address | null, // Will use deployer
  },
  testnet: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
    weth: '0x4200000000000000000000000000000000000006' as Address,
    xlpV2Factory: null as Address | null,
    communityVault: null as Address | null,
  },
};

type NetworkName = keyof typeof NETWORKS;

// Contracts directory
const CONTRACTS_DIR = '/Users/shawwalters/jeju/packages/contracts';

// Load compiled contract artifacts
function loadArtifact(name: string): {
  abi: readonly object[];
  bytecode: Hex;
} {
  const artifactPath = path.join(CONTRACTS_DIR, `out/${name}.sol/${name}.json`);
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Artifact not found: ${artifactPath}. Run 'forge build src/launchpad/' first.`
    );
  }
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as Hex,
  };
}

interface DeploymentResult {
  lpLocker: Address;
  tokenLaunchpad: Address;
  weth: Address;
  xlpV2Factory: Address | null;
  communityVault: Address;
  chainId: number;
  deployedAt: string;
}

async function deployMockV2Factory(
  walletClient: ReturnType<typeof createWalletClient>,
  publicClient: ReturnType<typeof createPublicClient>
): Promise<Address> {
  // Deploy a minimal mock V2 factory for localnet testing
  // In production, use the real XLP V2 Factory or Uniswap V2 Factory
  console.log('  Deploying MockXLPV2Factory (for testing)...');

  // Simple mock that just stores pairs
  const mockFactoryBytecode =
    '0x608060405234801561001057600080fd5b50610120806100206000396000f3fe6080604052348015600f57600080fd5b506004361060325760003560e01c8063c9c65396146037578063e6a43905146059575b600080fd5b604d60423660046096565b600092915050565b60405190815260200160405180910390f35b60706065366004609696565b600092915050565b6040516001600160a01b03909116815260200160405180910390f35b80356001600160a01b0381168114609157600080fd5b919050565b6000806040838503121560a857600080fd5b60af83607d565b915060bb60208401607d565b9050925092905056fea164736f6c6343000816000a' as Hex;

  const hash = await walletClient.deployContract({
    abi: [
      {
        type: 'function',
        name: 'createPair',
        inputs: [
          { name: 'tokenA', type: 'address' },
          { name: 'tokenB', type: 'address' },
        ],
        outputs: [{ name: 'pair', type: 'address' }],
        stateMutability: 'nonpayable',
      },
      {
        type: 'function',
        name: 'getPair',
        inputs: [
          { name: 'tokenA', type: 'address' },
          { name: 'tokenB', type: 'address' },
        ],
        outputs: [{ name: 'pair', type: 'address' }],
        stateMutability: 'view',
      },
    ],
    bytecode: mockFactoryBytecode,
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error('MockXLPV2Factory deployment failed');
  }

  console.log(`  MockXLPV2Factory: ${receipt.contractAddress}`);
  return receipt.contractAddress;
}

async function main() {
  // Parse arguments
  const args = process.argv.slice(2);
  const networkArg = args.find((a) => a.startsWith('--network='));
  const networkName: NetworkName = networkArg
    ? (networkArg.split('=')[1] as NetworkName)
    : 'localnet';

  const network = NETWORKS[networkName];
  if (!network) {
    throw new Error(`Unknown network: ${networkName}`);
  }

  console.log('🚀 TokenLaunchpad Deployment');
  console.log('='.repeat(50));
  console.log(`Network: ${networkName}`);

  // Setup clients
  const account = privateKeyToAccount(DEPLOYER_KEY as Hex);

  const publicClient = createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: network.chain,
    transport: http(network.rpcUrl),
  });

  console.log(`\n👤 Deployer: ${account.address}`);

  // Check connection
  const chainId = await publicClient.getChainId();
  console.log(`🔗 Chain ID: ${chainId}`);

  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`💰 Balance: ${formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error('Deployer has no ETH balance');
  }

  // Load artifacts
  console.log('\n📦 Loading contract artifacts...');
  const lpLockerArtifact = loadArtifact('LPLocker');
  const tokenLaunchpadArtifact = loadArtifact('TokenLaunchpad');

  // Determine XLP V2 Factory
  let xlpV2Factory = network.xlpV2Factory;
  if (!xlpV2Factory && networkName === 'localnet') {
    xlpV2Factory = await deployMockV2Factory(walletClient, publicClient);
  }

  // Use deployer as community vault if not set
  const communityVault = network.communityVault || account.address;

  // Deploy LPLocker
  console.log('\n🔐 Deploying LPLocker...');
  const lpLockerHash = await walletClient.deployContract({
    abi: lpLockerArtifact.abi,
    bytecode: lpLockerArtifact.bytecode,
    args: [account.address], // owner
    chain: network.chain,
    account,
  });

  const lpLockerReceipt = await publicClient.waitForTransactionReceipt({
    hash: lpLockerHash,
  });
  const lpLockerAddress = lpLockerReceipt.contractAddress;
  if (!lpLockerAddress) {
    throw new Error('LPLocker deployment failed');
  }
  console.log(`  LPLocker: ${lpLockerAddress}`);

  // Deploy TokenLaunchpad
  console.log('\n🎯 Deploying TokenLaunchpad...');
  const tokenLaunchpadHash = await walletClient.deployContract({
    abi: tokenLaunchpadArtifact.abi,
    bytecode: tokenLaunchpadArtifact.bytecode,
    args: [
      xlpV2Factory || ('0x0000000000000000000000000000000000000000' as Address), // xlpV2Factory
      network.weth, // weth
      lpLockerAddress, // lpLockerTemplate
      communityVault, // defaultCommunityVault
      account.address, // owner
    ],
    chain: network.chain,
    account,
  });

  const tokenLaunchpadReceipt = await publicClient.waitForTransactionReceipt({
    hash: tokenLaunchpadHash,
  });
  const tokenLaunchpadAddress = tokenLaunchpadReceipt.contractAddress;
  if (!tokenLaunchpadAddress) {
    throw new Error('TokenLaunchpad deployment failed');
  }
  console.log(`  TokenLaunchpad: ${tokenLaunchpadAddress}`);

  // Save deployment
  const deployment: DeploymentResult = {
    lpLocker: lpLockerAddress,
    tokenLaunchpad: tokenLaunchpadAddress,
    weth: network.weth,
    xlpV2Factory: xlpV2Factory,
    communityVault: communityVault,
    chainId: chainId,
    deployedAt: new Date().toISOString(),
  };

  const deploymentPath = path.join(
    CONTRACTS_DIR,
    `deployments/launchpad-${networkName}.json`
  );
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(`\n💾 Deployment saved to: ${deploymentPath}`);

  // Summary
  console.log('\n✅ Deployment Complete');
  console.log('='.repeat(50));
  console.log(`TokenLaunchpad: ${tokenLaunchpadAddress}`);
  console.log(`LPLocker:       ${lpLockerAddress}`);
  console.log(`WETH:           ${network.weth}`);
  console.log(`XLP V2 Factory: ${xlpV2Factory || 'Not configured'}`);
  console.log(`Community Vault: ${communityVault}`);

  console.log('\n📝 Next Steps:');
  console.log('1. Update bazaar config with TokenLaunchpad address');
  console.log(
    '2. Test launching a token: bun run test:launchpad (TODO: create test)'
  );
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});

