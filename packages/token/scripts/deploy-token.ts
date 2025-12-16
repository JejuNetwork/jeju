#!/usr/bin/env bun
/**
 * @deprecated Use 'jeju token deploy:ecosystem' instead
 * 
 * BBLN Token Deployment Script
 *
 * Deploys the full Babylon token ecosystem:
 * - BabylonToken (ERC-20)
 * - TokenVesting (team/treasury allocations)
 * - Airdrop (with daily drip)
 * - FeeDistributor
 * - CCALauncher (for public sale)
 *
 * Supports:
 * - Localnet (Hardhat/Anvil)
 * - Testnet (Base Sepolia, Arbitrum Sepolia, Sepolia)
 * - Mainnet (Base, Arbitrum, Ethereum, Optimism, BSC)
 *
 * Cross-chain deployment via Hyperlane warp routes.
 *
 * Usage:
 *   jeju token deploy:ecosystem --network localnet|testnet|mainnet
 *
 * Requires DEPLOYER_PRIVATE_KEY in .env for testnet/mainnet
 */

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

// Load .env from workspace root (babylon/)
const envPath = resolve(import.meta.dir, '../../../.env');
if (existsSync(envPath)) {
  const envFile = Bun.file(envPath);
  const envContent = await envFile.text();
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key, ...valueParts] = trimmed.split('=');
    if (key && !process.env[key]) {
      process.env[key] = valueParts.join('=');
    }
  }
}

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  formatEther,
  parseEther,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat, baseSepolia, sepolia, base, arbitrum } from 'viem/chains';
import {
  deployContract,
  deployContractCreate2,
  type ContractName,
} from '../src/deployer/contract-deployer';
import {
  TOTAL_SUPPLY_WEI,
  TOKEN_NAME,
  TOKEN_SYMBOL,
  BABYLON_LABS_TOKENS,
  TREASURY_TOKENS,
  AIRDROP_TOKENS,
  LIQUIDITY_TOKENS,
  PUBLIC_SALE_TOKENS,
  BABYLON_LABS_CLIFF,
  BABYLON_LABS_VESTING,
  TREASURY_CLIFF,
  TREASURY_VESTING,
  tokensToWei,
} from '../src/config/tokenomics';

// =============================================================================
// CONFIGURATION
// =============================================================================

type NetworkType = 'localnet' | 'testnet' | 'mainnet';

interface DeploymentAddresses {
  token: Address;
  vesting: Address;
  airdrop: Address;
  feeDistributor: Address;
  ccaLauncher: Address;
  warpRoute?: Address;
}

interface DeploymentResult {
  network: string;
  chainId: number;
  addresses: DeploymentAddresses;
  txHashes: Hex[];
}

// Network configurations
const NETWORK_CONFIGS = {
  localnet: {
    chain: hardhat,
    rpcUrl: 'http://localhost:8545',
    isHomeChain: true,
  },
  testnet: {
    chain: baseSepolia,
    rpcUrl: process.env.BASE_SEPOLIA_RPC_URL ?? 'https://sepolia.base.org',
    isHomeChain: false,
  },
  'testnet-sepolia': {
    chain: sepolia,
    rpcUrl: process.env.SEPOLIA_RPC_URL ?? 'https://rpc.sepolia.org',
    isHomeChain: true,
  },
  mainnet: {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL ?? 'https://mainnet.base.org',
    isHomeChain: true,
  },
};

// =============================================================================
// DEPLOYMENT FUNCTIONS
// =============================================================================

async function deployBabylonToken(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  owner: Address,
  isHomeChain: boolean,
  useCREATE2: boolean,
  salt?: Hex
): Promise<{ address: Address; txHash: Hex }> {
  console.log('\n📦 Deploying BabylonToken...');
  console.log(`   Name: ${TOKEN_NAME}`);
  console.log(`   Symbol: ${TOKEN_SYMBOL}`);
  console.log(`   Total Supply: ${TOTAL_SUPPLY_WEI.toString()} wei`);
  console.log(`   Is Home Chain: ${isHomeChain}`);

  const args = [
    TOKEN_NAME,
    TOKEN_SYMBOL,
    isHomeChain ? TOTAL_SUPPLY_WEI : 0n, // Only mint on home chain
    owner,
    isHomeChain,
  ] as const;

  if (useCREATE2 && salt) {
    return deployContractCreate2(
      publicClient,
      walletClient,
      'BabylonToken',
      args,
      salt
    );
  }

  return deployContract(publicClient, walletClient, 'BabylonToken', args);
}

async function deployTokenVesting(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  tokenAddress: Address,
  owner: Address
): Promise<{ address: Address; txHash: Hex }> {
  console.log('\n📦 Deploying TokenVesting...');

  return deployContract(publicClient, walletClient, 'TokenVesting', [
    tokenAddress,
    owner,
  ]);
}

async function deployAirdrop(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  tokenAddress: Address,
  owner: Address
): Promise<{ address: Address; txHash: Hex }> {
  console.log('\n📦 Deploying Airdrop...');

  return deployContract(publicClient, walletClient, 'Airdrop', [
    tokenAddress,
    owner,
  ]);
}

async function deployFeeDistributor(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  tokenAddress: Address,
  owner: Address
): Promise<{ address: Address; txHash: Hex }> {
  console.log('\n📦 Deploying FeeDistributor...');

  // Minimum stake period: 7 days in seconds
  const minimumStakePeriod = 7n * 24n * 60n * 60n;

  return deployContract(publicClient, walletClient, 'FeeDistributor', [
    tokenAddress,
    owner,
    minimumStakePeriod,
  ]);
}

async function deployCCALauncher(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  tokenAddress: Address,
  owner: Address
): Promise<{ address: Address; txHash: Hex }> {
  console.log('\n📦 Deploying CCALauncher...');

  // Use ETH as payment token (address(0))
  return deployContract(publicClient, walletClient, 'CCALauncher', [
    tokenAddress,
    '0x0000000000000000000000000000000000000000', // ETH payment
    owner,
  ]);
}

// =============================================================================
// POST-DEPLOYMENT SETUP
// =============================================================================

async function setupTokenDistribution(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  addresses: DeploymentAddresses,
  owner: Address
): Promise<void> {
  console.log('\n🔧 Setting up token distribution...');

  const tokenAbi = [
    {
      name: 'transfer',
      type: 'function',
      inputs: [
        { name: 'to', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      outputs: [{ name: '', type: 'bool' }],
    },
  ] as const;

  // Transfer allocations to respective contracts
  const transfers = [
    { to: addresses.vesting, amount: tokensToWei(BABYLON_LABS_TOKENS + TREASURY_TOKENS), name: 'Vesting' },
    { to: addresses.airdrop, amount: tokensToWei(AIRDROP_TOKENS), name: 'Airdrop' },
    { to: addresses.ccaLauncher, amount: tokensToWei(PUBLIC_SALE_TOKENS), name: 'CCA Launcher' },
  ];

  for (const { to, amount, name } of transfers) {
    console.log(`   📤 Transferring ${formatEther(amount)} BBLN to ${name}...`);
    const hash = await walletClient.writeContract({
      address: addresses.token,
      abi: tokenAbi,
      functionName: 'transfer',
      args: [to, amount],
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`      ✅ Tx: ${hash}`);
  }

  // LIQUIDITY_TOKENS remain with deployer for market making setup
  console.log(`   💧 ${formatEther(tokensToWei(LIQUIDITY_TOKENS))} BBLN retained for liquidity provision`);
  console.log('   ⏭️  Token distribution setup complete');
}

async function setupVestingSchedules(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  vestingAddress: Address,
  owner: Address
): Promise<void> {
  console.log('\n🔧 Setting up vesting schedules...');

  const vestingAbi = [
    {
      name: 'createSchedule',
      type: 'function',
      inputs: [
        { name: 'beneficiary', type: 'address' },
        { name: 'totalAmount', type: 'uint256' },
        { name: 'cliffDuration', type: 'uint256' },
        { name: 'vestingDuration', type: 'uint256' },
        { name: 'tgeUnlockPercent', type: 'uint8' },
        { name: 'revocable', type: 'bool' },
        { name: 'category', type: 'uint8' },
      ],
      outputs: [{ name: 'scheduleId', type: 'uint256' }],
    },
  ] as const;

  // Read beneficiary addresses from environment
  const babylonLabsAddress = process.env.BABYLON_LABS_ADDRESS as Address | undefined;
  const treasuryAddress = process.env.TREASURY_ADDRESS as Address | undefined;

  if (!babylonLabsAddress || !treasuryAddress) {
    console.log('   ⚠️  BABYLON_LABS_ADDRESS or TREASURY_ADDRESS not set in env');
    console.log('   ⏭️  Skipping vesting schedule creation (set env vars to configure)');
    return;
  }

  // Babylon Labs: 4-year vesting with 1-year cliff, 0% TGE unlock
  console.log('   📅 Creating Babylon Labs vesting schedule...');
  const labsHash = await walletClient.writeContract({
    address: vestingAddress,
    abi: vestingAbi,
    functionName: 'createSchedule',
    args: [
      babylonLabsAddress,
      tokensToWei(BABYLON_LABS_TOKENS),
      BigInt(BABYLON_LABS_CLIFF),
      BigInt(BABYLON_LABS_VESTING),
      0, // 0% TGE unlock
      true, // revocable
      0, // category: Team
    ],
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: labsHash });
  console.log(`      ✅ Tx: ${labsHash}`);

  // Treasury: Long-term gradual unlock
  console.log('   📅 Creating Treasury vesting schedule...');
  const treasuryHash = await walletClient.writeContract({
    address: vestingAddress,
    abi: vestingAbi,
    functionName: 'createSchedule',
    args: [
      treasuryAddress,
      tokensToWei(TREASURY_TOKENS),
      BigInt(TREASURY_CLIFF),
      BigInt(TREASURY_VESTING),
      0, // 0% TGE unlock
      true, // revocable
      1, // category: Treasury
    ],
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: treasuryHash });
  console.log(`      ✅ Tx: ${treasuryHash}`);

  console.log('   ⏭️  Vesting schedules setup complete');
}

async function setupAirdrop(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  airdropAddress: Address,
  owner: Address
): Promise<void> {
  console.log('\n🔧 Setting up airdrop...');

  const airdropAbi = [
    {
      name: 'setMerkleRoot',
      type: 'function',
      inputs: [{ name: 'root', type: 'bytes32' }],
      outputs: [],
    },
    {
      name: 'setClaimWindow',
      type: 'function',
      inputs: [
        { name: 'start', type: 'uint256' },
        { name: 'end', type: 'uint256' },
      ],
      outputs: [],
    },
    {
      name: 'setDripper',
      type: 'function',
      inputs: [
        { name: 'dripper', type: 'address' },
        { name: 'authorized', type: 'bool' },
      ],
      outputs: [],
    },
  ] as const;

  // Read configuration from environment
  const merkleRoot = process.env.AIRDROP_MERKLE_ROOT as `0x${string}` | undefined;
  const dripperAddress = process.env.AIRDROP_DRIPPER_ADDRESS as Address | undefined;

  if (!merkleRoot) {
    console.log('   ⚠️  AIRDROP_MERKLE_ROOT not set in env');
    console.log('   ⏭️  Run generate-merkle.ts first to create the merkle tree');
    return;
  }

  // Set merkle root
  console.log('   🌳 Setting merkle root...');
  const rootHash = await walletClient.writeContract({
    address: airdropAddress,
    abi: airdropAbi,
    functionName: 'setMerkleRoot',
    args: [merkleRoot],
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: rootHash });
  console.log(`      ✅ Tx: ${rootHash}`);

  // Set claim window: starts immediately, ends in 90 days
  const startTime = BigInt(Math.floor(Date.now() / 1000));
  const endTime = startTime + BigInt(90 * 24 * 60 * 60); // 90 days
  console.log('   ⏰ Setting claim window (90 days)...');
  const windowHash = await walletClient.writeContract({
    address: airdropAddress,
    abi: airdropAbi,
    functionName: 'setClaimWindow',
    args: [startTime, endTime],
    account: owner,
  });
  await publicClient.waitForTransactionReceipt({ hash: windowHash });
  console.log(`      ✅ Tx: ${windowHash}`);

  // Authorize dripper if configured
  if (dripperAddress) {
    console.log('   🔓 Authorizing dripper service...');
    const dripperHash = await walletClient.writeContract({
      address: airdropAddress,
      abi: airdropAbi,
      functionName: 'setDripper',
      args: [dripperAddress, true],
      account: owner,
    });
    await publicClient.waitForTransactionReceipt({ hash: dripperHash });
    console.log(`      ✅ Tx: ${dripperHash}`);
  }

  console.log('   ⏭️  Airdrop setup complete');
}

// =============================================================================
// MAIN DEPLOYMENT
// =============================================================================

async function deploy(network: NetworkType): Promise<DeploymentResult> {
  console.log('═'.repeat(60));
  console.log(`🚀 BABYLON TOKEN DEPLOYMENT - ${network.toUpperCase()}`);
  console.log('═'.repeat(60));

  // Get configuration
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}`);
  }

  // Get deployer private key
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey && network !== 'localnet') {
    throw new Error('DEPLOYER_PRIVATE_KEY environment variable required');
  }

  // Use default Hardhat account for localnet
  const deployerKey = privateKey ?? 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  const account = privateKeyToAccount(deployerKey as Hex);

  console.log(`\n📍 Network: ${config.chain.name}`);
  console.log(`📍 Chain ID: ${config.chain.id}`);
  console.log(`📍 RPC: ${config.rpcUrl}`);
  console.log(`📍 Deployer: ${account.address}`);
  console.log(`📍 Is Home Chain: ${config.isHomeChain}`);

  // Create clients
  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  const walletClient = createWalletClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
    account,
  });

  // Check deployer balance
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`\n💰 Deployer Balance: ${formatEther(balance)} ETH`);

  if (balance < parseEther('0.01')) {
    console.warn('⚠️  Low deployer balance, deployment may fail');
  }

  const txHashes: Hex[] = [];

  // Deploy contracts
  const tokenResult = await deployBabylonToken(
    publicClient,
    walletClient,
    account.address,
    config.isHomeChain,
    false // Use standard deployment for now
  );
  txHashes.push(tokenResult.txHash);
  console.log(`   ✅ Token deployed at: ${tokenResult.address}`);

  const vestingResult = await deployTokenVesting(
    publicClient,
    walletClient,
    tokenResult.address,
    account.address
  );
  txHashes.push(vestingResult.txHash);
  console.log(`   ✅ Vesting deployed at: ${vestingResult.address}`);

  const airdropResult = await deployAirdrop(
    publicClient,
    walletClient,
    tokenResult.address,
    account.address
  );
  txHashes.push(airdropResult.txHash);
  console.log(`   ✅ Airdrop deployed at: ${airdropResult.address}`);

  const feeDistributorResult = await deployFeeDistributor(
    publicClient,
    walletClient,
    tokenResult.address,
    account.address
  );
  txHashes.push(feeDistributorResult.txHash);
  console.log(`   ✅ FeeDistributor deployed at: ${feeDistributorResult.address}`);

  const ccaResult = await deployCCALauncher(
    publicClient,
    walletClient,
    tokenResult.address,
    account.address
  );
  txHashes.push(ccaResult.txHash);
  console.log(`   ✅ CCALauncher deployed at: ${ccaResult.address}`);

  const addresses: DeploymentAddresses = {
    token: tokenResult.address,
    vesting: vestingResult.address,
    airdrop: airdropResult.address,
    feeDistributor: feeDistributorResult.address,
    ccaLauncher: ccaResult.address,
  };

  // Post-deployment setup (only on home chain)
  if (config.isHomeChain) {
    await setupTokenDistribution(
      publicClient,
      walletClient,
      addresses,
      account.address
    );
    await setupVestingSchedules(
      publicClient,
      walletClient,
      vestingResult.address,
      account.address
    );
    await setupAirdrop(
      publicClient,
      walletClient,
      airdropResult.address,
      account.address
    );
  }

  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log('📋 DEPLOYMENT SUMMARY');
  console.log('═'.repeat(60));
  console.log(`\nNetwork: ${config.chain.name} (${config.chain.id})`);
  console.log(`\nContract Addresses:`);
  console.log(`  Token:          ${addresses.token}`);
  console.log(`  Vesting:        ${addresses.vesting}`);
  console.log(`  Airdrop:        ${addresses.airdrop}`);
  console.log(`  FeeDistributor: ${addresses.feeDistributor}`);
  console.log(`  CCALauncher:    ${addresses.ccaLauncher}`);
  console.log('\n' + '═'.repeat(60));
  console.log('✅ DEPLOYMENT COMPLETE');
  console.log('═'.repeat(60));

  return {
    network: config.chain.name,
    chainId: config.chain.id,
    addresses,
    txHashes,
  };
}

// =============================================================================
// CLI
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const network = (args[0] ?? 'localnet') as NetworkType;

  if (!['localnet', 'testnet', 'mainnet'].includes(network)) {
    console.error(`Invalid network: ${network}`);
    console.error('Usage: bun run deploy-token.ts [localnet|testnet|mainnet]');
    process.exit(1);
  }

  const result = await deploy(network);

  // Save deployment result
  const outputPath = `deployments/${network}-${Date.now()}.json`;
  await Bun.write(outputPath, JSON.stringify(result, null, 2));
  console.log(`\n📄 Deployment saved to: ${outputPath}`);
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
