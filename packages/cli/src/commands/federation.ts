/**
 * federation command - Manage Jeju Federation membership
 * 
 * Commands:
 *   jeju federation join      - Join the federation
 *   jeju federation status    - Check federation status
 *   jeju federation list      - List all federated networks
 *   jeju federation add-stake - Add stake to upgrade trust tier
 *   jeju federation registries - List all federated registries
 *   jeju federation sync      - Sync registry data
 */

import { Command } from 'commander';
import { createPublicClient, createWalletClient, http, formatEther, parseEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import chalk from 'chalk';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';
import '@jejunetwork/config';

// Contract ABIs (minimal)
const NETWORK_REGISTRY_ABI = [
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle, address registryHub) contracts, bytes32 genesisHash) payable',
  'function addStake(uint256 chainId) payable',
  'function getNetwork(uint256 chainId) view returns (tuple(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, address operator, tuple(address,address,address,address,address,address,address,address) contracts, bytes32 genesisHash, uint256 registeredAt, uint256 stake, uint8 trustTier, bool isActive, bool isVerified, bool isSuperchain))',
  'function getAllNetworkIds() view returns (uint256[])',
  'function canParticipateInConsensus(uint256 chainId) view returns (bool)',
  'function isSequencerEligible(uint256 chainId) view returns (bool)',
  'function totalNetworks() view returns (uint256)',
  'function activeNetworks() view returns (uint256)',
  'function verifiedNetworks() view returns (uint256)',
  'event NetworkRegistered(uint256 indexed chainId, string name, address indexed operator, uint256 stake)',
];

const REGISTRY_HUB_ABI = [
  'function getAllChainIds() view returns (uint256[])',
  'function getAllRegistryIds() view returns (bytes32[])',
  'function getChain(uint256 chainId) view returns (tuple(uint256 chainId, uint8 chainType, string name, string rpcUrl, address networkOperator, uint256 stake, uint8 trustTier, bool isActive, uint256 registeredAt))',
  'function getRegistry(bytes32 registryId) view returns (tuple(bytes32 registryId, uint256 chainId, uint8 chainType, uint8 registryType, bytes32 contractAddress, string name, string version, string metadataUri, uint256 entryCount, uint256 lastSyncBlock, bool isActive, uint256 registeredAt))',
  'function getRegistriesByType(uint8 registryType) view returns (bytes32[])',
  'function totalChains() view returns (uint256)',
  'function totalRegistries() view returns (uint256)',
  'function totalStaked() view returns (uint256)',
];

// Default addresses (Ethereum mainnet hub)
const DEFAULT_HUB_RPC = 'https://eth.llamarpc.com';
const DEFAULT_NETWORK_REGISTRY = '0x0000000000000000000000000000000000000000'; // To be deployed
const DEFAULT_REGISTRY_HUB = '0x0000000000000000000000000000000000000000'; // To be deployed

const TRUST_TIERS = ['UNSTAKED', 'STAKED', 'VERIFIED'];
const REGISTRY_TYPES = ['IDENTITY', 'COMPUTE', 'STORAGE', 'SOLVER', 'PACKAGE', 'CONTAINER', 'MODEL', 'NAME_SERVICE', 'REPUTATION', 'OTHER'];

export const federationCommand = new Command('federation')
  .description('Manage Jeju Federation membership')
  .option('--hub-rpc <url>', 'Hub chain RPC URL', DEFAULT_HUB_RPC)
  .option('--network-registry <address>', 'NetworkRegistry contract address')
  .option('--registry-hub <address>', 'RegistryHub contract address');

// ============================================================================
// join - Join the federation
// ============================================================================

federationCommand
  .command('join')
  .description('Join the Jeju Federation')
  .option('--stake <amount>', 'ETH stake amount (0=unstaked, 1+=staked, 10+=verified)', '0')
  .option('--chain-id <id>', 'Your chain ID')
  .option('--name <name>', 'Network name')
  .option('--rpc <url>', 'Your RPC URL')
  .option('--explorer <url>', 'Your explorer URL')
  .option('--ws <url>', 'Your WebSocket URL')
  .option('--private-key <key>', 'Deployer private key')
  .action(async (options) => {
    logger.header('JOIN JEJU FEDERATION');

    const parent = federationCommand.opts();
    
    if (!options.privateKey) {
      console.log(chalk.red('Error: --private-key required'));
      process.exit(1);
    }

    if (!options.chainId || !options.name || !options.rpc) {
      console.log(chalk.red('Error: --chain-id, --name, and --rpc are required'));
      process.exit(1);
    }

    const publicClient = createPublicClient({ transport: http(parent.hubRpc) });
    const account = privateKeyToAccount(options.privateKey as `0x${string}`);
    const walletClient = createWalletClient({ account, transport: http(parent.hubRpc) });
    
    const registryAddress = parent.networkRegistry || DEFAULT_NETWORK_REGISTRY;
    if (registryAddress === DEFAULT_NETWORK_REGISTRY) {
      console.log(chalk.yellow('Warning: Using default NetworkRegistry address. Deploy contracts first.'));
    }

    const stakeAmount = parseEther(options.stake);
    const tierName = parseFloat(options.stake) >= 10 ? 'VERIFIED' : 
                     parseFloat(options.stake) >= 1 ? 'STAKED' : 'UNSTAKED';

    console.log(chalk.cyan('\nRegistration Details:'));
    console.log(`  Chain ID: ${options.chainId}`);
    console.log(`  Name: ${options.name}`);
    console.log(`  RPC: ${options.rpc}`);
    console.log(`  Stake: ${options.stake} ETH`);
    console.log(`  Trust Tier: ${tierName}`);
    console.log();

    if (tierName === 'UNSTAKED') {
      console.log(chalk.yellow('Note: UNSTAKED networks cannot:'));
      console.log(chalk.yellow('  - Participate in federation consensus'));
      console.log(chalk.yellow('  - Run shared sequencer'));
      console.log(chalk.yellow('  - Receive delegated liquidity'));
      console.log(chalk.yellow('Stake 1+ ETH to upgrade to STAKED tier.\n'));
    }

    const contracts = {
      identityRegistry: '0x0000000000000000000000000000000000000000',
      solverRegistry: '0x0000000000000000000000000000000000000000',
      inputSettler: '0x0000000000000000000000000000000000000000',
      outputSettler: '0x0000000000000000000000000000000000000000',
      liquidityVault: '0x0000000000000000000000000000000000000000',
      governance: '0x0000000000000000000000000000000000000000',
      oracle: '0x0000000000000000000000000000000000000000',
      registryHub: '0x0000000000000000000000000000000000000000',
    };

    const genesisHash = '0x0000000000000000000000000000000000000000000000000000000000000000';

    console.log(chalk.cyan('Sending transaction...'));

    const hash = await walletClient.writeContract({
      address: registryAddress as `0x${string}`,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'registerNetwork',
      args: [
        BigInt(options.chainId),
        options.name,
        options.rpc,
        options.explorer || '',
        options.ws || '',
        contracts,
        genesisHash,
      ],
      value: stakeAmount,
    });

    console.log(`  Transaction: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });

    console.log(chalk.green('\nSuccessfully joined the Jeju Federation!'));
    console.log(`\nNext steps:`);
    console.log(`  1. Deploy your IdentityRegistry: jeju deploy identity`);
    console.log(`  2. Register your registries: jeju federation register-registry`);
    console.log(`  3. Check status: jeju federation status --chain-id ${options.chainId}`);
  });

// ============================================================================
// status - Check federation status
// ============================================================================

federationCommand
  .command('status')
  .description('Check federation status')
  .option('--chain-id <id>', 'Specific chain ID to check')
  .action(async (options) => {
    logger.header('FEDERATION STATUS');

    const parent = federationCommand.opts();
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) });
    
    const registryAddress = parent.networkRegistry || DEFAULT_NETWORK_REGISTRY;
    const hubAddress = parent.registryHub || DEFAULT_REGISTRY_HUB;

    if (registryAddress === DEFAULT_NETWORK_REGISTRY) {
      console.log(chalk.yellow('NetworkRegistry not deployed yet.\n'));
      console.log('Deploy with: jeju deploy federation --network mainnet');
      return;
    }

    const registry = getContract({ address: registryAddress as `0x${string}`, abi: NETWORK_REGISTRY_ABI, client: publicClient });
    const hub = getContract({ address: hubAddress as `0x${string}`, abi: REGISTRY_HUB_ABI, client: publicClient });

    if (options.chainId) {
      // Show specific network
      const network = await registry.read.getNetwork([BigInt(options.chainId)]) as { chainId: bigint; name: string; rpcUrl: string; operator: string; stake: bigint; trustTier: number; isActive: boolean; isVerified: boolean; isSuperchain: boolean; registeredAt: bigint };
      
      console.log(chalk.cyan('\nNetwork Details:'));
      console.log(`  Chain ID: ${network.chainId}`);
      console.log(`  Name: ${network.name}`);
      console.log(`  RPC: ${network.rpcUrl}`);
      console.log(`  Operator: ${network.operator}`);
      console.log(`  Stake: ${formatEther(network.stake)} ETH`);
      console.log(`  Trust Tier: ${TRUST_TIERS[network.trustTier]}`);
      console.log(`  Active: ${network.isActive}`);
      console.log(`  Verified: ${network.isVerified}`);
      console.log(`  Superchain: ${network.isSuperchain}`);
      console.log(`  Registered: ${new Date(Number(network.registeredAt) * 1000).toISOString()}`);

      const canConsensus = await registry.read.canParticipateInConsensus([BigInt(options.chainId)]) as boolean;
      const canSequence = await registry.read.isSequencerEligible([BigInt(options.chainId)]) as boolean;

      console.log(chalk.cyan('\nCapabilities:'));
      console.log(`  Consensus Participation: ${canConsensus ? chalk.green('Yes') : chalk.red('No')}`);
      console.log(`  Sequencer Eligible: ${canSequence ? chalk.green('Yes') : chalk.red('No')}`);
    } else {
      // Show overall stats
      const totalNetworks = await registry.read.totalNetworks() as bigint;
      const activeNetworks = await registry.read.activeNetworks() as bigint;
      const verifiedNetworks = await registry.read.verifiedNetworks() as bigint;

      console.log(chalk.cyan('\nFederation Overview:'));
      console.log(`  Total Networks: ${totalNetworks}`);
      console.log(`  Active Networks: ${activeNetworks}`);
      console.log(`  Verified Networks: ${verifiedNetworks}`);

      if (hubAddress !== DEFAULT_REGISTRY_HUB) {
        const totalChains = await hub.read.totalChains() as bigint;
        const totalRegistries = await hub.read.totalRegistries() as bigint;
        const totalStaked = await hub.read.totalStaked() as bigint;

        console.log(chalk.cyan('\nRegistry Hub:'));
        console.log(`  Chains Tracked: ${totalChains}`);
        console.log(`  Registries Tracked: ${totalRegistries}`);
        console.log(`  Total Staked: ${formatEther(totalStaked)} ETH`);
      }
    }
  });

// ============================================================================
// list - List all federated networks
// ============================================================================

federationCommand
  .command('list')
  .description('List all federated networks')
  .option('--staked-only', 'Only show staked networks')
  .option('--verified-only', 'Only show verified networks')
  .action(async (options) => {
    logger.header('FEDERATED NETWORKS');

    const parent = federationCommand.opts();
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) });
    
    const registryAddress = parent.networkRegistry || DEFAULT_NETWORK_REGISTRY;
    if (registryAddress === DEFAULT_NETWORK_REGISTRY) {
      console.log(chalk.yellow('NetworkRegistry not deployed yet.'));
      return;
    }

    const registry = getContract({ address: registryAddress as `0x${string}`, abi: NETWORK_REGISTRY_ABI, client: publicClient });

    const chainIds = await registry.read.getAllNetworkIds() as readonly bigint[];

    console.log(chalk.cyan(`\nFound ${chainIds.length} networks:\n`));

    for (const chainId of chainIds) {
      const network = await registry.read.getNetwork([chainId]) as { chainId: bigint; name: string; rpcUrl: string; stake: bigint; trustTier: number; isActive: boolean };
      
      const tier = TRUST_TIERS[network.trustTier];
      if (options.stakedOnly && network.trustTier < 1) continue;
      if (options.verifiedOnly && network.trustTier < 2) continue;

      const tierColor = network.trustTier === 2 ? chalk.green :
                        network.trustTier === 1 ? chalk.yellow : chalk.gray;

      console.log(`${network.isActive ? '🟢' : '🔴'} ${chalk.bold(network.name)} (${network.chainId})`);
      console.log(`   Tier: ${tierColor(tier)} | Stake: ${formatEther(network.stake)} ETH`);
      console.log(`   RPC: ${network.rpcUrl}`);
      console.log();
    }
  });

// ============================================================================
// add-stake - Add stake to upgrade tier
// ============================================================================

federationCommand
  .command('add-stake')
  .description('Add stake to upgrade trust tier')
  .requiredOption('--chain-id <id>', 'Your chain ID')
  .requiredOption('--amount <eth>', 'ETH amount to stake')
  .requiredOption('--private-key <key>', 'Operator private key')
  .action(async (options) => {
    logger.header('ADD FEDERATION STAKE');

    const parent = federationCommand.opts();
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) });
    const account = privateKeyToAccount(options.privateKey as `0x${string}`);
    const walletClient = createWalletClient({ account, transport: http(parent.hubRpc) });
    
    const registryAddress = parent.networkRegistry || DEFAULT_NETWORK_REGISTRY;

    const amount = parseEther(options.amount);

    console.log(chalk.cyan('Adding stake...'));
    console.log(`  Chain ID: ${options.chainId}`);
    console.log(`  Amount: ${options.amount} ETH`);

    const hash = await walletClient.writeContract({
      address: registryAddress as `0x${string}`,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'addStake',
      args: [BigInt(options.chainId)],
      value: amount,
    });
    console.log(`  Transaction: ${hash}`);
    await publicClient.waitForTransactionReceipt({ hash });

    console.log(chalk.green('\nStake added successfully!'));
    console.log(`Run 'jeju federation status --chain-id ${options.chainId}' to see your new tier.`);
  });

// ============================================================================
// registries - List all federated registries
// ============================================================================

federationCommand
  .command('registries')
  .description('List all federated registries')
  .option('--type <type>', 'Filter by type (identity, compute, storage, solver, package, container, model)')
  .option('--chain <chainId>', 'Filter by chain ID')
  .action(async (options) => {
    logger.header('FEDERATED REGISTRIES');

    const parent = federationCommand.opts();
    const publicClient = createPublicClient({ transport: http(parent.hubRpc) });
    
    const hubAddress = parent.registryHub || DEFAULT_REGISTRY_HUB;
    if (hubAddress === DEFAULT_REGISTRY_HUB) {
      console.log(chalk.yellow('RegistryHub not deployed yet.'));
      return;
    }

    const hub = getContract({ address: hubAddress as `0x${string}`, abi: REGISTRY_HUB_ABI, client: publicClient });

    let registryIds: readonly `0x${string}`[];
    
    if (options.type) {
      const typeIndex = REGISTRY_TYPES.findIndex(t => t.toLowerCase() === options.type.toLowerCase());
      if (typeIndex === -1) {
        console.log(chalk.red(`Invalid type. Choose from: ${REGISTRY_TYPES.join(', ')}`));
        return;
      }
      registryIds = await hub.read.getRegistriesByType([typeIndex]) as readonly `0x${string}`[];
    } else {
      registryIds = await hub.read.getAllRegistryIds() as readonly `0x${string}`[];
    }

    console.log(chalk.cyan(`\nFound ${registryIds.length} registries:\n`));

    for (const registryId of registryIds) {
      const registry = await hub.read.getRegistry([registryId]) as { chainId: bigint; name: string; registryType: number; contractAddress: string; entryCount: bigint; lastSyncBlock: bigint };
      
      if (options.chain && registry.chainId.toString() !== options.chain) continue;

      const typeName = REGISTRY_TYPES[registry.registryType];
      
      console.log(`📦 ${chalk.bold(registry.name)} (${typeName})`);
      console.log(`   Chain: ${registry.chainId} | Entries: ${registry.entryCount}`);
      console.log(`   Contract: ${registry.contractAddress.slice(0, 20)}...`);
      console.log(`   Last Sync: Block ${registry.lastSyncBlock}`);
      console.log();
    }
  });

// ============================================================================
// sync - Trigger registry sync
// ============================================================================

federationCommand
  .command('sync')
  .description('Sync registry data from all chains')
  .option('--registry-id <id>', 'Sync specific registry')
  .action(async (_options) => {
    logger.header('SYNC REGISTRIES');

    console.log(chalk.cyan('Triggering federation sync...\n'));
    
    // In production, this would call the indexer API
    console.log('This command triggers the federated indexer to:');
    console.log('  1. Query all registered chains');
    console.log('  2. Fetch registry contract events');
    console.log('  3. Aggregate and deduplicate entries');
    console.log('  4. Update the unified GraphQL API');
    console.log();
    console.log(chalk.yellow('TODO: Implement indexer sync API call'));
  });

// ============================================================================
// AI DAO Governance Commands
// ============================================================================

federationCommand
  .command('proposals')
  .description('List pending AI DAO governance proposals for network verification')
  .action(async () => {
    logger.header('NETWORK VERIFICATION PROPOSALS');

    console.log(chalk.cyan('How Network Verification Works:\n'));
    console.log('1. Network stakes 10+ ETH → Auto-creates governance proposal');
    console.log('2. AI Oracle evaluates: uptime, uniqueness, RPC health, operator reputation');
    console.log('3. Prediction market: "Should this network be VERIFIED?"');
    console.log('4. If market confidence > 60% AND AI score > 70 → Autocrat review');
    console.log('5. AI DAO (Autocrat) gives final approval');
    console.log('6. 7-day timelock before VERIFIED status active');
    console.log();

    console.log(chalk.cyan('Trust Tier Requirements:'));
    console.log(`  ${chalk.gray('UNSTAKED')} (0 ETH): Listed only, no consensus`);
    console.log(`  ${chalk.yellow('STAKED')} (1+ ETH): Federation consensus participation`);
    console.log(`  ${chalk.green('VERIFIED')} (10+ ETH + AI DAO): Sequencer eligible`);
    console.log();

    console.log(chalk.yellow('TODO: Query FederationGovernance for pending proposals'));
  });

federationCommand
  .command('challenge')
  .description('Challenge a verified network (requires 1 ETH bond)')
  .requiredOption('--chain-id <id>', 'Chain ID to challenge')
  .requiredOption('--reason <reason>', 'Reason: sybil | downtime | malicious | invalid_genesis | rpc_failure | other')
  .requiredOption('--evidence <ipfs>', 'IPFS hash of evidence')
  .option('--private-key <key>', 'Challenger private key')
  .action(async (options) => {
    logger.header('CHALLENGE NETWORK');

    const validReasons = ['sybil', 'downtime', 'malicious', 'invalid_genesis', 'rpc_failure', 'other'];
    if (!validReasons.includes(options.reason)) {
      console.log(chalk.red(`Invalid reason. Choose from: ${validReasons.join(', ')}`));
      process.exit(1);
    }

    console.log(chalk.cyan('Challenge Details:'));
    console.log(`  Chain ID: ${options.chainId}`);
    console.log(`  Reason: ${options.reason.toUpperCase()}`);
    console.log(`  Evidence: ${options.evidence}`);
    console.log();

    console.log(chalk.yellow('Challenge Requirements:'));
    console.log('  • 1 ETH bond required');
    console.log('  • If upheld by guardians → bond returned + network revoked');
    console.log('  • If rejected → bond forfeited to treasury');
    console.log();

    console.log(chalk.cyan('Guardian Review Process:'));
    console.log('  • Minimum 3 guardian votes required');
    console.log('  • Majority vote determines outcome');
    console.log('  • Network downgraded to STAKED if challenge upheld');
    console.log();

    console.log(chalk.yellow('TODO: Implement FederationGovernance.challengeNetwork() call'));
  });

federationCommand
  .command('sequencer')
  .description('View current sequencer and rotation schedule')
  .action(async () => {
    logger.header('SEQUENCER STATUS');

    console.log(chalk.cyan('Sequencer Rotation Rules:\n'));
    console.log('  • Only VERIFIED networks can be sequencers');
    console.log('  • Round-robin rotation every 24 hours');
    console.log('  • Revoked networks removed from rotation');
    console.log();

    console.log(chalk.cyan('Sybil Protection:\n'));
    console.log('  • Max 5 networks per operator');
    console.log('  • 10 ETH minimum stake per network');
    console.log('  • AI DAO must approve each network');
    console.log('  • Guardians can challenge at any time');
    console.log('  • Economic penalty for malicious behavior');
    console.log();

    console.log(chalk.yellow('TODO: Query FederationGovernance for current sequencer'));
  });

federationCommand
  .command('guardians')
  .description('List federation guardians and their stats')
  .action(async () => {
    logger.header('FEDERATION GUARDIANS');

    console.log(chalk.cyan('Guardian Responsibilities:\n'));
    console.log('  • Vote on network challenges');
    console.log('  • Review appeals from banned networks');
    console.log('  • Monitor network quality metrics');
    console.log('  • Participate in AI DAO governance');
    console.log();

    console.log(chalk.cyan('Becoming a Guardian:\n'));
    console.log('  • Must operate a VERIFIED network, OR');
    console.log('  • Must be HIGH tier staker in IdentityRegistry');
    console.log('  • Appointed by governance');
    console.log('  • Performance tracked over time');
    console.log();

    console.log(chalk.yellow('TODO: Query FederationGovernance for guardian list'));
  });

// ============================================================================
// configure-remotes - Configure Hyperlane trusted remotes for cross-chain
// ============================================================================

federationCommand
  .command('configure-remotes')
  .description('Configure Hyperlane trusted remotes for cross-chain identity sync')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'testnet')
  .action(async (options) => {
    logger.header('CONFIGURE HYPERLANE REMOTES');

    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'scripts/configure-hyperlane-remotes.ts');

    if (!existsSync(scriptPath)) {
      logger.error('Configure remotes script not found');
      process.exit(1);
    }

    const args: string[] = [];
    if (options.network) {
      args.push('--network', options.network);
    }

    await execa('bun', ['run', scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

export default federationCommand;

