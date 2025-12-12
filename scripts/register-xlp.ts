#!/usr/bin/env bun
/**
 * @fileoverview XLP (Cross-chain Liquidity Provider) Registration Script
 * 
 * Registers an XLP on the EIL L1StakeManager and deposits liquidity
 * to CrossChainPaymaster contracts on L2s.
 * 
 * XLPs enable:
 * - Trustless cross-chain transfers without bridges
 * - Multi-token gas sponsorship for users
 * - Liquidity provision across chains
 * 
 * Usage:
 *   bun run scripts/register-xlp.ts --network testnet --stake 1.0
 *   bun run scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5
 * 
 * Environment:
 *   DEPLOYER_PRIVATE_KEY or XLP_PRIVATE_KEY - XLP's private key
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger('register-xlp');

const L1_STAKE_MANAGER_ABI = [
  'function register(uint256[] calldata supportedChains) external payable',
  'function addStake() external payable',
  'function startUnbonding(uint256 amount) external',
  'function completeUnbonding() external',
  'function isXLPActive(address xlp) external view returns (bool)',
  'function getStake(address xlp) external view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt))',
  'function getXLPChains(address xlp) external view returns (uint256[])',
  'function getProtocolStats() external view returns (uint256 totalStaked, uint256 totalSlashed, uint256 activeXLPs)',
  'function MIN_STAKE() external view returns (uint256)',
  'function l2Paymasters(uint256 chainId) external view returns (address)',
];

const CROSS_CHAIN_PAYMASTER_ABI = [
  'function depositLiquidity(address token, uint256 amount) external',
  'function depositETH() external payable',
  'function withdrawLiquidity(address token, uint256 amount) external',
  'function withdrawETH(uint256 amount) external',
  'function getXLPLiquidity(address xlp, address token) external view returns (uint256)',
  'function getXLPETH(address xlp) external view returns (uint256)',
  'function xlpVerifiedStake(address xlp) external view returns (uint256)',
  'function supportedTokens(address token) external view returns (bool)',
  'function totalETHLiquidity() external view returns (uint256)',
];

// Public RPC URLs
const PUBLIC_RPCS: Record<number, string> = {
  11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
  84532: 'https://sepolia.base.org',
  421614: 'https://sepolia-rollup.arbitrum.io/rpc',
  11155420: 'https://sepolia.optimism.io',
  420690: 'https://testnet-rpc.jeju.network',
  1: 'https://eth.llamarpc.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  10: 'https://mainnet.optimism.io',
  420691: 'https://rpc.jeju.network',
};

// Chain names
const CHAIN_NAMES: Record<number, string> = {
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'Optimism Sepolia',
  420690: 'Jeju Testnet',
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  420691: 'Jeju Mainnet',
};

interface EILConfig {
  hub: {
    chainId: number;
    name: string;
    l1StakeManager: string;
  };
  chains: Record<string, {
    chainId: number;
    name: string;
    crossChainPaymaster: string;
  }>;
}

function loadEILConfig(network: 'testnet' | 'mainnet'): EILConfig | null {
  const eilPath = resolve(process.cwd(), 'packages/config/eil.json');
  if (!existsSync(eilPath)) return null;
  const eil = JSON.parse(readFileSync(eilPath, 'utf-8'));
  return eil[network] || null;
}

async function getXLPStatus(
  provider: ethers.JsonRpcProvider,
  stakeManagerAddress: string,
  xlpAddress: string
): Promise<{
  isRegistered: boolean;
  isActive: boolean;
  stake: bigint;
  chains: number[];
}> {
  const manager = new ethers.Contract(stakeManagerAddress, L1_STAKE_MANAGER_ABI, provider);
  
  const stakeData = await manager.getStake(xlpAddress);
  const isActive = stakeData.isActive;
  const stake = stakeData.stakedAmount;
  let chains: number[] = [];
  
  if (isActive) {
    const chainsRaw = await manager.getXLPChains(xlpAddress);
    chains = chainsRaw.map((c: bigint) => Number(c));
  }
  
  return {
    isRegistered: stake > 0n || isActive,
    isActive,
    stake,
    chains,
  };
}

async function getRegisteredPaymasters(
  provider: ethers.JsonRpcProvider,
  stakeManagerAddress: string,
  chainIds: number[]
): Promise<number[]> {
  const manager = new ethers.Contract(stakeManagerAddress, L1_STAKE_MANAGER_ABI, provider);
  const registered: number[] = [];
  
  for (const chainId of chainIds) {
    const paymaster = await manager.l2Paymasters(chainId);
    if (paymaster !== ethers.ZeroAddress) {
      registered.push(chainId);
    }
  }
  
  return registered;
}

async function registerXLP(
  eilConfig: EILConfig,
  supportedChains: number[],
  stakeAmount: string,
  privateKey: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const hubChainId = eilConfig.hub.chainId;
  const rpcUrl = PUBLIC_RPCS[hubChainId];
  
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for hub chain ${hubChainId}` };
  }

  if (!eilConfig.hub.l1StakeManager) {
    return { success: false, error: 'L1StakeManager not deployed' };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const manager = new ethers.Contract(eilConfig.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, wallet);

  // Check current status
  const status = await getXLPStatus(provider, eilConfig.hub.l1StakeManager, wallet.address);
  
  if (status.isActive) {
    logger.info(`XLP already registered on ${eilConfig.hub.name}`);
    logger.info(`  Stake: ${ethers.formatEther(status.stake)} ETH`);
    logger.info(`  Chains: ${status.chains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
    return { success: true };
  }

  // Check which chains have registered L2 paymasters
  const registeredPaymasters = await getRegisteredPaymasters(provider, eilConfig.hub.l1StakeManager, supportedChains);
  
  if (registeredPaymasters.length === 0) {
    return { 
      success: false, 
      error: 'No L2 CrossChainPaymaster contracts registered. Deploy paymasters first with: bun scripts/deploy/eil.ts testnet' 
    };
  }
  
  // Only register for chains with paymasters
  const chainsToRegister = registeredPaymasters;
  
  if (chainsToRegister.length < supportedChains.length) {
    logger.info(`Note: Only ${chainsToRegister.length}/${supportedChains.length} chains have registered paymasters`);
    logger.info(`  Registering for: ${chainsToRegister.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
  }

  // Get minimum stake
  const minStake = await manager.MIN_STAKE();
  const stake = ethers.parseEther(stakeAmount);
  
  if (stake < minStake) {
    return { 
      success: false, 
      error: `Stake ${stakeAmount} ETH is below minimum ${ethers.formatEther(minStake)} ETH` 
    };
  }

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  if (balance < stake) {
    return { 
      success: false, 
      error: `Insufficient balance: ${ethers.formatEther(balance)} ETH, need ${stakeAmount} ETH` 
    };
  }

  logger.info(`Registering XLP on ${eilConfig.hub.name} (L1 Hub)...`);
  logger.info(`  Stake: ${stakeAmount} ETH`);
  logger.info(`  Supported chains: ${chainsToRegister.map(c => CHAIN_NAMES[c] || c).join(', ')}`);

  const tx = await manager.register(chainsToRegister, { value: stake });
  logger.info(`  Transaction: ${tx.hash}`);
  
  const receipt = await tx.wait();
  
  if (receipt.status === 0) {
    return { success: false, error: 'Transaction reverted' };
  }

  return { success: true, txHash: tx.hash };
}

async function depositLiquidity(
  chainId: number,
  paymasterAddress: string,
  amount: string,
  privateKey: string,
  tokenAddress?: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpcUrl = PUBLIC_RPCS[chainId];
  if (!rpcUrl) {
    return { success: false, error: `No RPC URL for chain ${chainId}` };
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const paymaster = new ethers.Contract(paymasterAddress, CROSS_CHAIN_PAYMASTER_ABI, wallet);

  const depositAmount = ethers.parseEther(amount);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  if (balance < depositAmount) {
    return { 
      success: false, 
      error: `Insufficient balance: ${ethers.formatEther(balance)} ETH, need ${amount} ETH` 
    };
  }

  logger.info(`Depositing ${amount} ETH to ${CHAIN_NAMES[chainId]} paymaster...`);

  let tx: ethers.TransactionResponse;
  if (tokenAddress && tokenAddress !== ethers.ZeroAddress) {
    // ERC20 deposit
    tx = await paymaster.depositLiquidity(tokenAddress, depositAmount);
  } else {
    // ETH deposit
    tx = await paymaster.depositETH({ value: depositAmount });
  }
  
  logger.info(`  Transaction: ${tx.hash}`);
  const receipt = await tx.wait();
  
  if (receipt.status === 0) {
    return { success: false, error: 'Transaction reverted' };
  }

  return { success: true, txHash: tx.hash };
}

async function showXLPStatus(eilConfig: EILConfig, xlpAddress: string) {
  console.log('\n═══ XLP Status ═══\n');

  // Check L1 stake
  const hubRpc = PUBLIC_RPCS[eilConfig.hub.chainId];
  if (hubRpc && eilConfig.hub.l1StakeManager) {
    const provider = new ethers.JsonRpcProvider(hubRpc);
    
    try {
      const status = await getXLPStatus(provider, eilConfig.hub.l1StakeManager, xlpAddress);
      
      console.log(`L1 Hub (${eilConfig.hub.name}):`);
      console.log(`  Status: ${status.isActive ? '✅ Active' : '❌ Not registered'}`);
      console.log(`  Stake: ${ethers.formatEther(status.stake)} ETH`);
      if (status.chains.length > 0) {
        console.log(`  Chains: ${status.chains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
      }
      
      // Check registered paymasters
      const allChainIds = [84532, 11155420, 421614, 420690];
      const registeredPaymasters = await getRegisteredPaymasters(provider, eilConfig.hub.l1StakeManager, allChainIds);
      if (registeredPaymasters.length > 0) {
        console.log(`  Registered L2 Paymasters: ${registeredPaymasters.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
      } else {
        console.log(`  ⚠️ No L2 Paymasters registered yet`);
      }
    } catch (e) {
      console.log(`L1 Hub (${eilConfig.hub.name}): Error reading status - ${(e as Error).message.slice(0, 60)}`);
    }
    console.log('');
  }

  // Check L2 liquidity
  for (const [, chain] of Object.entries(eilConfig.chains)) {
    if (!chain.crossChainPaymaster) continue;
    
    const rpc = PUBLIC_RPCS[chain.chainId];
    if (!rpc) continue;

    try {
      const provider = new ethers.JsonRpcProvider(rpc);
      const paymaster = new ethers.Contract(chain.crossChainPaymaster, CROSS_CHAIN_PAYMASTER_ABI, provider);

      const ethBalance = await paymaster.getXLPETH(xlpAddress);
      const verifiedStake = await paymaster.xlpVerifiedStake(xlpAddress);
      
      console.log(`${chain.name}:`);
      console.log(`  ETH Liquidity: ${ethers.formatEther(ethBalance)} ETH`);
      console.log(`  Verified Stake: ${ethers.formatEther(verifiedStake)} ETH`);
      console.log('');
    } catch {
      // Paymaster not deployed or not accessible
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const networkArg = args.indexOf('--network');
  const stakeArg = args.indexOf('--stake');
  const depositArg = args.includes('--deposit');
  const chainArg = args.indexOf('--chain');
  const amountArg = args.indexOf('--amount');
  const statusArg = args.includes('--status');
  
  const network = networkArg !== -1 ? (args[networkArg + 1] as 'testnet' | 'mainnet') : 'testnet';
  const stakeAmount = stakeArg !== -1 ? args[stakeArg + 1] : '1.0';
  const depositChainId = chainArg !== -1 ? parseInt(args[chainArg + 1]) : null;
  const depositAmount = amountArg !== -1 ? args[amountArg + 1] : '0.1';

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              EIL XLP Registration                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get private key
  const privateKey = process.env.XLP_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('XLP_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY required');
    console.log('\nSet one of these environment variables with your XLP wallet private key');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  logger.info(`XLP address: ${wallet.address}`);
  logger.info(`Network: ${network}\n`);

  // Load EIL config
  const eilConfig = loadEILConfig(network);
  if (!eilConfig) {
    logger.error(`EIL not configured for ${network}`);
    console.log('\nCheck packages/config/eil.json');
    process.exit(1);
  }

  // Status mode
  if (statusArg) {
    await showXLPStatus(eilConfig, wallet.address);
    process.exit(0);
  }

  // Deposit mode
  if (depositArg) {
    if (!depositChainId) {
      logger.error('--chain required for deposit');
      console.log('\nUsage: bun run scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5');
      process.exit(1);
    }

    // Find paymaster for this chain
    const chainEntry = Object.entries(eilConfig.chains).find(
      ([, c]) => c.chainId === depositChainId
    );
    
    if (!chainEntry || !chainEntry[1].crossChainPaymaster) {
      logger.error(`No CrossChainPaymaster deployed on chain ${depositChainId}`);
      process.exit(1);
    }

    const result = await depositLiquidity(
      depositChainId,
      chainEntry[1].crossChainPaymaster,
      depositAmount,
      privateKey
    );

    if (result.success) {
      logger.success(`Deposited ${depositAmount} ETH successfully`);
      if (result.txHash) {
        console.log(`Transaction: ${result.txHash}`);
      }
    } else {
      logger.error(`Deposit failed: ${result.error}`);
    }
    
    process.exit(result.success ? 0 : 1);
  }

  // Register mode (default)
  if (!eilConfig.hub.l1StakeManager) {
    logger.error('L1StakeManager not deployed');
    console.log('\nDeploy EIL first: bun run scripts/deploy/eil.ts testnet');
    process.exit(1);
  }

  // Get supported chains from config
  const supportedChains = Object.values(eilConfig.chains)
    .filter(c => c.crossChainPaymaster)
    .map(c => c.chainId);

  if (supportedChains.length === 0) {
    // Default to all L2 chains if no paymasters deployed yet
    supportedChains.push(84532, 11155420, 421614, 420690);
  }

  console.log(`Hub: ${eilConfig.hub.name} (${eilConfig.hub.chainId})`);
  console.log(`L1StakeManager: ${eilConfig.hub.l1StakeManager}`);
  console.log(`Stake amount: ${stakeAmount} ETH`);
  console.log(`Supported chains: ${supportedChains.map(c => CHAIN_NAMES[c] || c).join(', ')}`);
  console.log('');

  const result = await registerXLP(eilConfig, supportedChains, stakeAmount, privateKey);

  if (result.success) {
    logger.success('XLP registered successfully');
    if (result.txHash) {
      console.log(`Transaction: ${result.txHash}`);
    }

    console.log('\nNext steps:');
    console.log('1. Deploy CrossChainPaymaster on L2s (if not done)');
    console.log('2. Deposit liquidity on each L2:');
    console.log('   bun run scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5');
    console.log('3. Check status:');
    console.log('   bun run scripts/register-xlp.ts --status');
  } else {
    logger.error(`Registration failed: ${result.error}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  logger.error(`Registration failed: ${err.message}`);
  process.exit(1);
});
