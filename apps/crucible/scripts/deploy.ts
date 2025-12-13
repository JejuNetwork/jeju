/**
 * Crucible Deployment Script
 * 
 * Deploys Crucible contracts to the target network.
 * 
 * Usage:
 *   bun run scripts/deploy.ts              # Deploy to localnet
 *   NETWORK=testnet bun run scripts/deploy.ts   # Deploy to testnet
 */

import { createPublicClient, createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost, sepolia, mainnet } from 'viem/chains';

// Contract ABIs (simplified for deployment)
const AGENT_VAULT_ABI = [
  'constructor(address _feeRecipient)',
  'function defaultSpendLimit() view returns (uint256)',
  'function feeRecipient() view returns (address)',
] as const;

const ROOM_REGISTRY_ABI = [
  'constructor()',
  'function nextRoomId() view returns (uint256)',
] as const;

interface DeploymentResult {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    agentVault: string;
    roomRegistry: string;
  };
  timestamp: string;
}

async function main() {
  const network = process.env.NETWORK ?? 'localnet';
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    console.error('Error: PRIVATE_KEY environment variable required');
    process.exit(1);
  }

  // Get chain config
  const chainConfig = getChainConfig(network);
  console.log(`\n🔥 Crucible Deployment`);
  console.log(`   Network: ${network}`);
  console.log(`   Chain ID: ${chainConfig.chain.id}`);
  console.log(`   RPC: ${chainConfig.rpcUrl}`);

  // Create clients
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  console.log(`   Deployer: ${account.address}`);

  const publicClient = createPublicClient({
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });

  const walletClient = createWalletClient({
    account,
    chain: chainConfig.chain,
    transport: http(chainConfig.rpcUrl),
  });

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`   Balance: ${balance / BigInt(1e18)} ETH\n`);

  if (balance < parseEther('0.01')) {
    console.error('Error: Insufficient balance for deployment');
    process.exit(1);
  }

  // Deploy contracts using forge
  console.log('📦 Deploying contracts via Foundry...\n');
  
  const proc = Bun.spawn([
    'forge', 'script',
    'script/DeployCrucible.s.sol',
    '--rpc-url', chainConfig.rpcUrl,
    '--broadcast',
    '--legacy', // For compatibility
  ], {
    cwd: '/Users/shawwalters/jeju/packages/contracts',
    env: {
      ...process.env,
      PRIVATE_KEY: privateKey,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  console.log(stdout);
  if (stderr) console.error(stderr);

  // Parse deployment addresses from output
  const agentVaultMatch = stdout.match(/AgentVault deployed at: (0x[a-fA-F0-9]{40})/);
  const roomRegistryMatch = stdout.match(/RoomRegistry deployed at: (0x[a-fA-F0-9]{40})/);

  if (!agentVaultMatch || !roomRegistryMatch) {
    console.error('Error: Failed to parse deployment addresses');
    process.exit(1);
  }

  const result: DeploymentResult = {
    network,
    chainId: chainConfig.chain.id,
    deployer: account.address,
    contracts: {
      agentVault: agentVaultMatch[1]!,
      roomRegistry: roomRegistryMatch[1]!,
    },
    timestamp: new Date().toISOString(),
  };

  // Save deployment result
  const deploymentPath = `./deployments/${network}.json`;
  await Bun.write(deploymentPath, JSON.stringify(result, null, 2));
  console.log(`\n✅ Deployment saved to ${deploymentPath}`);

  // Print summary
  console.log('\n📋 Deployment Summary:');
  console.log(`   AgentVault: ${result.contracts.agentVault}`);
  console.log(`   RoomRegistry: ${result.contracts.roomRegistry}`);
  console.log(`\n🎉 Crucible deployment complete!\n`);

  return result;
}

function getChainConfig(network: string) {
  switch (network) {
    case 'testnet':
      return {
        chain: sepolia,
        rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
      };
    case 'mainnet':
      return {
        chain: mainnet,
        rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
      };
    case 'localnet':
    default:
      return {
        chain: localhost,
        rpcUrl: process.env.RPC_URL ?? 'http://127.0.0.1:8545',
      };
  }
}

main().catch(console.error);
