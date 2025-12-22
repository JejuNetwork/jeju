#!/usr/bin/env bun
/**
 * DAO Registry Seeding Script
 * 
 * Seeds DAOs into the DAORegistry contract.
 * 
 * Usage:
 *   bun run scripts/deploy/dao-registry.ts jeju [network]
 *   bun run scripts/deploy/dao-registry.ts babylon [network]
 *   bun run scripts/deploy/dao-registry.ts create <name> [network]
 *   bun run scripts/deploy/dao-registry.ts list [network]
 */

import { createWalletClient, createPublicClient, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { localhost, baseSepolia, base } from 'viem/chains';
import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config';

// DAO Registry ABI (JSON format to handle complex tuples)
const DAO_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'createDAO',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'treasury', type: 'address' },
      {
        name: 'ceoPersona',
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfp', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'voiceStyle', type: 'string' },
          { name: 'communicationTone', type: 'string' },
          { name: 'specialties', type: 'string[]' },
        ],
      },
      {
        name: 'governanceParams',
        type: 'tuple',
        components: [
          { name: 'quorum', type: 'uint256' },
          { name: 'votingPeriod', type: 'uint256' },
          { name: 'executionDelay', type: 'uint256' },
          { name: 'proposalThreshold', type: 'uint256' },
          { name: 'vetoThreshold', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAllDAOs',
    inputs: [],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getDAO',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'treasury', type: 'address' },
          { name: 'councilMembers', type: 'address[]' },
          { name: 'active', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCEOPersona',
    inputs: [{ name: 'daoId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'pfp', type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'personality', type: 'string' },
          { name: 'voiceStyle', type: 'string' },
          { name: 'communicationTone', type: 'string' },
          { name: 'specialties', type: 'string[]' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// Predefined DAO configurations
const DAO_CONFIGS = {
  jeju: {
    name: 'Jeju DAO',
    ceoPersona: {
      name: 'Jeju',
      pfp: 'https://jejunetwork.org/assets/jeju-ceo.png',
      description: 'Autonomous CEO of Jeju DAO, governing the Jeju network infrastructure and chain-level decisions.',
      personality: 'Strategic, analytical, focused on long-term network health and decentralization.',
      voiceStyle: 'Professional yet approachable, with a focus on clarity and transparency.',
      communicationTone: 'Formal but warm, emphasizing community and collaboration.',
      specialties: ['network governance', 'infrastructure', 'tokenomics', 'validator management', 'protocol upgrades'],
    },
    governanceParams: {
      quorum: 20n * 10n ** 18n, // 20 tokens
      votingPeriod: 7n * 24n * 60n * 60n, // 7 days
      executionDelay: 2n * 24n * 60n * 60n, // 2 days
      proposalThreshold: 10n * 10n ** 18n, // 10 tokens
      vetoThreshold: 30n, // 30%
    },
  },
  babylon: {
    name: 'Babylon DAO',
    ceoPersona: {
      name: 'Monkey King',
      pfp: 'https://babylon.game/assets/monkey-king.png',
      description: 'The legendary Monkey King, ruling Babylon with wisdom, mischief, and a golden staff.',
      personality: 'Playful but wise, chaotic good, protector of the underdog, loves challenges.',
      voiceStyle: 'Bold and theatrical, with occasional bursts of humor and ancient wisdom.',
      communicationTone: 'Casual and energetic, mixing modern slang with classical references.',
      specialties: ['game mechanics', 'player rewards', 'seasonal events', 'NFT economics', 'community challenges'],
    },
    governanceParams: {
      quorum: 10n * 10n ** 18n, // 10 tokens
      votingPeriod: 3n * 24n * 60n * 60n, // 3 days
      executionDelay: 1n * 24n * 60n * 60n, // 1 day
      proposalThreshold: 5n * 10n ** 18n, // 5 tokens
      vetoThreshold: 40n, // 40%
    },
  },
};

function getChain(network: NetworkType) {
  switch (network) {
    case 'localnet': return localhost;
    case 'testnet': return baseSepolia;
    case 'mainnet': return base;
    default: return localhost;
  }
}

function getRpcUrl(network: NetworkType): string {
  switch (network) {
    case 'localnet': return process.env.RPC_URL ?? 'http://localhost:9545';
    case 'testnet': return process.env.RPC_URL ?? 'https://sepolia.base.org';
    case 'mainnet': return process.env.RPC_URL ?? 'https://mainnet.base.org';
    default: return 'http://localhost:9545';
  }
}

async function main() {
  const [command, arg, networkArg] = process.argv.slice(2);
  const network = (networkArg as NetworkType) ?? getCurrentNetwork();
  const registryAddress = process.env.DAO_REGISTRY_ADDRESS;
  
  if (!registryAddress) {
    console.error('DAO_REGISTRY_ADDRESS environment variable required');
    process.exit(1);
  }

  const chain = getChain(network);
  const rpcUrl = getRpcUrl(network);
  
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });

  console.log(`DAO Registry: ${registryAddress}`);
  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log('');

  if (command === 'list') {
    console.log('Fetching registered DAOs...');
    try {
      const daoIds = await publicClient.readContract({
        address: registryAddress as Hex,
        abi: DAO_REGISTRY_ABI,
        functionName: 'getAllDAOs',
      });
      
      console.log(`Found ${daoIds.length} DAOs:`);
      for (const daoId of daoIds) {
        const dao = await publicClient.readContract({
          address: registryAddress as Hex,
          abi: DAO_REGISTRY_ABI,
          functionName: 'getDAO',
          args: [daoId],
        });
        console.log(`  - ${dao.name} (${daoId.slice(0, 10)}...)`);
      }
    } catch (e) {
      console.error('Failed to fetch DAOs:', (e as Error).message);
    }
    return;
  }

  // For write operations, we need a wallet
  const privateKey = process.env.PRIVATE_KEY ?? process.env.DEPLOYER_KEY;
  if (!privateKey) {
    console.error('PRIVATE_KEY or DEPLOYER_KEY environment variable required for write operations');
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  });

  console.log(`Deployer: ${account.address}`);
  console.log('');

  if (command === 'jeju' || command === 'babylon') {
    const config = DAO_CONFIGS[command];
    console.log(`Creating ${config.name}...`);
    
    try {
      const hash = await walletClient.writeContract({
        address: registryAddress as Hex,
        abi: DAO_REGISTRY_ABI,
        functionName: 'createDAO',
        args: [
          config.name,
          account.address, // Treasury defaults to deployer
          config.ceoPersona,
          config.governanceParams,
        ],
      });
      
      console.log(`Transaction: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`${config.name} created in block ${receipt.blockNumber}`);
      console.log(`CEO: ${config.ceoPersona.name}`);
      console.log('');
    } catch (e) {
      const error = e as Error;
      if (error.message.includes('DAO already exists')) {
        console.log(`${config.name} already exists`);
      } else {
        throw e;
      }
    }
    return;
  }

  if (command === 'create' && arg) {
    console.log(`Creating custom DAO: ${arg}...`);
    
    const hash = await walletClient.writeContract({
      address: registryAddress as Hex,
      abi: DAO_REGISTRY_ABI,
      functionName: 'createDAO',
      args: [
        arg,
        account.address,
        {
          name: `${arg} CEO`,
          pfp: '',
          description: `Autonomous CEO of ${arg}`,
          personality: 'Strategic and analytical',
          voiceStyle: 'Professional',
          communicationTone: 'Formal',
          specialties: ['governance', 'treasury'],
        },
        {
          quorum: 10n * 10n ** 18n,
          votingPeriod: 7n * 24n * 60n * 60n,
          executionDelay: 2n * 24n * 60n * 60n,
          proposalThreshold: 5n * 10n ** 18n,
          vetoThreshold: 30n,
        },
      ],
    });
    
    console.log(`Transaction: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`${arg} created in block ${receipt.blockNumber}`);
    return;
  }

  console.log(`
Usage:
  bun run scripts/deploy/dao-registry.ts jeju [network]     - Create Jeju DAO
  bun run scripts/deploy/dao-registry.ts babylon [network]  - Create Babylon DAO
  bun run scripts/deploy/dao-registry.ts create <name> [network] - Create custom DAO
  bun run scripts/deploy/dao-registry.ts list [network]     - List all DAOs

Environment:
  DAO_REGISTRY_ADDRESS - Address of deployed DAORegistry contract (required)
  PRIVATE_KEY          - Private key for transaction signing (required for create)
  RPC_URL              - RPC endpoint (optional, defaults to network config)
`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

