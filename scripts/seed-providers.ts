/**
 * Provider Seeding Script
 * 
 * Registers Jeju-operated TEE nodes on Phala, Marlin, and Oasis networks.
 * These seed the network with initial compute capacity.
 * 
 * Usage:
 *   bun scripts/seed-providers.ts --network testnet
 *   bun scripts/seed-providers.ts --network mainnet --provider phala
 */

import { createPublicClient, createWalletClient, http, parseEther, formatEther, readContract, writeContract, waitForTransactionReceipt, getBalance, keccak256, toBytes, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { inferChainFromRpcUrl } from './shared/chain-utils';

interface ProviderConfig {
  name: string;
  type: 'phala' | 'marlin' | 'oasis' | 'local';
  endpoint: string;
  teeType: number; // 0=none, 1=sgx, 2=tdx, 3=sev, 4=nitro
  capabilities: string[];
  models: string[];
  stake: bigint;
  fundingRequired: {
    nativeToken: string;
    amount: string;
    purpose: string;
  };
}

const TESTNET_PROVIDERS: ProviderConfig[] = [
  {
    name: 'Jeju-Phala-Testnet-1',
    type: 'phala',
    endpoint: 'https://phala-testnet-1.jeju.network',
    teeType: 1, // SGX
    capabilities: ['inference', 'workers', 'secrets'],
    models: ['llama-3.1-8b', 'mistral-7b', 'phi-3-mini'],
    stake: parseEther('0.1'),
    fundingRequired: {
      nativeToken: 'PHA',
      amount: '100 PHA',
      purpose: 'Phala Network staking and compute credits',
    },
  },
  {
    name: 'Jeju-Marlin-Testnet-1',
    type: 'marlin',
    endpoint: 'https://marlin-testnet-1.jeju.network',
    teeType: 2, // TDX
    capabilities: ['workers', 'zk-proving'],
    models: [],
    stake: parseEther('0.1'),
    fundingRequired: {
      nativeToken: 'POND',
      amount: '1000 POND',
      purpose: 'Marlin Oyster operator stake',
    },
  },
  {
    name: 'Jeju-Oasis-Testnet-1',
    type: 'oasis',
    endpoint: 'https://oasis-testnet-1.jeju.network',
    teeType: 1, // SGX (Sapphire)
    capabilities: ['confidential-compute', 'workers'],
    models: [],
    stake: parseEther('0.1'),
    fundingRequired: {
      nativeToken: 'ROSE',
      amount: '100 TEST ROSE',
      purpose: 'Oasis Sapphire deployment and gas',
    },
  },
];

const MAINNET_PROVIDERS: ProviderConfig[] = [
  {
    name: 'Jeju-Phala-1',
    type: 'phala',
    endpoint: 'https://phala-1.jeju.network',
    teeType: 1,
    capabilities: ['inference', 'workers', 'secrets'],
    models: ['llama-3.1-70b', 'llama-3.1-8b', 'mistral-7b', 'codellama-34b'],
    stake: parseEther('1.0'),
    fundingRequired: {
      nativeToken: 'PHA',
      amount: '10,000 PHA',
      purpose: 'Phala Network staking and compute credits',
    },
  },
  {
    name: 'Jeju-Marlin-1',
    type: 'marlin',
    endpoint: 'https://marlin-1.jeju.network',
    teeType: 2,
    capabilities: ['workers', 'zk-proving'],
    models: [],
    stake: parseEther('1.0'),
    fundingRequired: {
      nativeToken: 'POND',
      amount: '100,000 POND',
      purpose: 'Marlin Oyster operator stake + MPond delegation',
    },
  },
  {
    name: 'Jeju-Oasis-1',
    type: 'oasis',
    endpoint: 'https://oasis-1.jeju.network',
    teeType: 1,
    capabilities: ['confidential-compute', 'workers'],
    models: [],
    stake: parseEther('1.0'),
    fundingRequired: {
      nativeToken: 'ROSE',
      amount: '10,000 ROSE',
      purpose: 'Oasis Sapphire deployment and gas',
    },
  },
];

const COMPUTE_REGISTRY_ABI = parseAbi([
  'function register(string name, string endpoint, bytes32 attestationHash) payable',
  'function registerWithAgent(string name, string endpoint, bytes32 attestationHash, uint256 agentId) payable',
  'function addCapability(string model, uint256 pricePerInputToken, uint256 pricePerOutputToken, uint256 maxContextLength)',
  'function updateEndpoint(string endpoint, bytes32 attestationHash)',
  'function getProvider(address) view returns (address owner, string name, string endpoint, bytes32 attestationHash, uint256 stake, uint256 registeredAt, uint256 agentId, bool active)',
  'function isActive(address) view returns (bool)',
  'function minProviderStake() view returns (uint256)',
]);

const WORKER_REGISTRY_ABI = parseAbi([
  'function addEndpoint(bytes32 workerId, string endpoint, bytes32 attestationHash, uint8 teeType)',
  'function getActiveWorkers() view returns (bytes32[])',
]);

interface SeedConfig {
  network: 'localnet' | 'testnet' | 'mainnet';
  providerType?: 'phala' | 'marlin' | 'oasis' | 'all';
  dryRun?: boolean;
}

async function generateAttestation(accountAddress: Address, endpoint: string, teeType: number): Promise<`0x${string}`> {
  const message = JSON.stringify({
    endpoint,
    teeType,
    timestamp: Date.now(),
    address: accountAddress,
  });
  const hash = keccak256(toBytes(message));
  return hash;
}

async function seedProvider(
  provider: ProviderConfig,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  registryAddress: Address,
  accountAddress: Address,
  dryRun: boolean
): Promise<void> {
  console.log(`\n📡 Seeding provider: ${provider.name}`);
  console.log(`   Type: ${provider.type}`);
  console.log(`   Endpoint: ${provider.endpoint}`);
  console.log(`   TEE Type: ${provider.teeType}`);
  console.log(`   Stake: ${formatEther(provider.stake)} ETH`);

  // Check if already registered
  const existing = await readContract(publicClient, {
    address: registryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'getProvider',
    args: [accountAddress],
  }).catch(() => null);
  
  if (existing && existing[0] !== '0x0000000000000000000000000000000000000000') {
    console.log(`   ⚠️  Already registered, updating endpoint...`);
    
    if (!dryRun) {
      const attestation = await generateAttestation(accountAddress, provider.endpoint, provider.teeType);
      const hash = await walletClient.writeContract({
        address: registryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'updateEndpoint',
        args: [provider.endpoint, attestation],
      });
      await waitForTransactionReceipt(publicClient, { hash });
      console.log(`   ✅ Endpoint updated: ${hash}`);
    } else {
      console.log(`   [DRY RUN] Would update endpoint`);
    }
    return;
  }

  // Check minimum stake
  const minStake = await readContract(publicClient, {
    address: registryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    functionName: 'minProviderStake',
  });
  const stake = provider.stake > minStake ? provider.stake : minStake;

  // Generate attestation
  const attestation = await generateAttestation(accountAddress, provider.endpoint, provider.teeType);

  if (!dryRun) {
    console.log(`   Registering with stake ${formatEther(stake)} ETH...`);
    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'register',
      args: [provider.name, provider.endpoint, attestation],
      value: stake,
    });
    await waitForTransactionReceipt(publicClient, { hash });
    console.log(`   ✅ Registered: ${hash}`);

    // Add model capabilities
    for (const model of provider.models) {
      console.log(`   Adding capability: ${model}`);
      const capHash = await walletClient.writeContract({
        address: registryAddress,
        abi: COMPUTE_REGISTRY_ABI,
        functionName: 'addCapability',
        args: [
          model,
          parseEther('0.0000001'), // Price per input token
          parseEther('0.0000003'), // Price per output token
          128000n // Max context length
        ],
      });
      await waitForTransactionReceipt(publicClient, { hash: capHash });
    }
  } else {
    console.log(`   [DRY RUN] Would register with stake ${formatEther(stake)} ETH`);
    console.log(`   [DRY RUN] Would add ${provider.models.length} model capabilities`);
  }
}

async function seedWorkerEndpoints(
  provider: ProviderConfig,
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  workerRegistryAddress: Address,
  accountAddress: Address,
  dryRun: boolean
): Promise<void> {
  if (!provider.capabilities.includes('workers')) {
    console.log(`   Skipping worker endpoints (not a worker provider)`);
    return;
  }

  console.log(`   Adding worker endpoints...`);

  // Get all active workers
  const workerIds = await readContract(publicClient, {
    address: workerRegistryAddress,
    abi: WORKER_REGISTRY_ABI,
    functionName: 'getActiveWorkers',
  });
  console.log(`   Found ${workerIds.length} active workers`);

  for (const workerId of workerIds) {
    const attestation = await generateAttestation(accountAddress, provider.endpoint, provider.teeType);

    if (!dryRun) {
      const hash = await walletClient.writeContract({
        address: workerRegistryAddress,
        abi: WORKER_REGISTRY_ABI,
        functionName: 'addEndpoint',
        args: [
          workerId as `0x${string}`,
          `${provider.endpoint}/workers`,
          attestation,
          provider.teeType as number
        ],
      });
      await waitForTransactionReceipt(publicClient, { hash });
      console.log(`   ✅ Added endpoint for worker ${workerId.slice(0, 10)}...`);
    } else {
      console.log(`   [DRY RUN] Would add endpoint for worker ${workerId.slice(0, 10)}...`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const config: SeedConfig = {
    network: 'testnet',
    providerType: 'all',
    dryRun: false,
  };

  // Parse args
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--network' && args[i + 1]) {
      config.network = args[++i] as 'localnet' | 'testnet' | 'mainnet';
    } else if (args[i] === '--provider' && args[i + 1]) {
      config.providerType = args[++i] as 'phala' | 'marlin' | 'oasis' | 'all';
    } else if (args[i] === '--dry-run') {
      config.dryRun = true;
    }
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║              Provider Seeding Script                       ║
║        Register Jeju TEE Providers on Networks            ║
╠═══════════════════════════════════════════════════════════╣
║  Network:  ${config.network.padEnd(44)}║
║  Provider: ${(config.providerType ?? 'all').padEnd(44)}║
║  Dry Run:  ${config.dryRun ? 'Yes' : 'No '.padEnd(44)}║
╚═══════════════════════════════════════════════════════════╝
`);

  // Get configuration
  const providers = config.network === 'mainnet' ? MAINNET_PROVIDERS : TESTNET_PROVIDERS;
  const filteredProviders = config.providerType === 'all'
    ? providers
    : providers.filter(p => p.type === config.providerType);

  if (filteredProviders.length === 0) {
    console.error('No providers to seed');
    process.exit(1);
  }

  // Print funding requirements
  console.log('\n💰 Funding Requirements:');
  console.log('═══════════════════════════════════════════════════════════');
  for (const provider of filteredProviders) {
    console.log(`\n${provider.name}:`);
    console.log(`  ${provider.fundingRequired.nativeToken}: ${provider.fundingRequired.amount}`);
    console.log(`  Purpose: ${provider.fundingRequired.purpose}`);
  }
  console.log('\n═══════════════════════════════════════════════════════════');

  // Setup
  const rpcUrl = config.network === 'mainnet'
    ? process.env.MAINNET_RPC_URL ?? 'https://mainnet.base.org'
    : config.network === 'testnet'
      ? process.env.TESTNET_RPC_URL ?? 'https://sepolia.base.org'
      : process.env.RPC_URL ?? 'http://localhost:9545';

  const privateKey = process.env.PROVIDER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('❌ PROVIDER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  const registryAddress = config.network === 'mainnet'
    ? process.env.MAINNET_COMPUTE_REGISTRY_ADDRESS
    : config.network === 'testnet'
      ? process.env.TESTNET_COMPUTE_REGISTRY_ADDRESS
      : process.env.COMPUTE_REGISTRY_ADDRESS;

  const workerRegistryAddress = config.network === 'mainnet'
    ? process.env.MAINNET_WORKER_REGISTRY_ADDRESS
    : config.network === 'testnet'
      ? process.env.TESTNET_WORKER_REGISTRY_ADDRESS
      : process.env.WORKER_REGISTRY_ADDRESS;

  if (!registryAddress) {
    console.error('❌ COMPUTE_REGISTRY_ADDRESS required');
    process.exit(1);
  }

  const chain = inferChainFromRpcUrl(rpcUrl);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

  console.log(`\n🔑 Seeding with wallet: ${account.address}`);
  const balance = await getBalance(publicClient, { address: account.address });
  console.log(`   Balance: ${formatEther(balance)} ETH`);

  // Seed each provider
  for (const provider of filteredProviders) {
    await seedProvider(provider, publicClient, walletClient, registryAddress as Address, account.address, config.dryRun ?? false);
    
    if (workerRegistryAddress && provider.capabilities.includes('workers')) {
      await seedWorkerEndpoints(provider, publicClient, walletClient, workerRegistryAddress as Address, account.address, config.dryRun ?? false);
    }
  }

  console.log('\n✅ Provider seeding complete!');
}

main().catch(console.error);
