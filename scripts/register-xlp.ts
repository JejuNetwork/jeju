#!/usr/bin/env bun
/**
 * XLP Registration Script - Registers XLPs on EIL L1StakeManager
 * 
 * Usage:
 *   bun scripts/register-xlp.ts --network testnet --stake 1.0
 *   bun scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5
 *   bun scripts/register-xlp.ts --status
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName } from './shared/chains';

const logger = new Logger('register-xlp');

const L1_STAKE_MANAGER_ABI = [
  'function register(uint256[] calldata supportedChains) external payable',
  'function getStake(address xlp) external view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt))',
  'function getXLPChains(address xlp) external view returns (uint256[])',
  'function MIN_STAKE() external view returns (uint256)',
  'function l2Paymasters(uint256 chainId) external view returns (address)',
];

const PAYMASTER_ABI = [
  'function depositETH() external payable',
  'function getXLPETH(address xlp) external view returns (uint256)',
  'function xlpVerifiedStake(address xlp) external view returns (uint256)',
];

interface EILConfig {
  hub: { chainId: number; name: string; l1StakeManager: string };
  chains: Record<string, { chainId: number; name: string; crossChainPaymaster: string }>;
}

function loadEILConfig(network: 'testnet' | 'mainnet'): EILConfig | null {
  const path = resolve(process.cwd(), 'packages/config/eil.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'))[network] || null;
}

async function getRegisteredPaymasters(provider: ethers.JsonRpcProvider, stakeManager: string, chainIds: number[]): Promise<number[]> {
  const contract = new ethers.Contract(stakeManager, L1_STAKE_MANAGER_ABI, provider);
  const registered: number[] = [];
  for (const id of chainIds) {
    const addr = await contract.l2Paymasters(id);
    if (addr !== ethers.ZeroAddress) registered.push(id);
  }
  return registered;
}

async function registerXLP(config: EILConfig, chains: number[], stakeAmount: string, privateKey: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpc = PUBLIC_RPCS[config.hub.chainId];
  if (!rpc) return { success: false, error: `No RPC for hub chain ${config.hub.chainId}` };
  if (!config.hub.l1StakeManager) return { success: false, error: 'L1StakeManager not deployed' };

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(config.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, wallet);

  // Check current status
  const stakeData = await contract.getStake(wallet.address);
  if (stakeData.isActive) {
    logger.info(`Already registered: ${ethers.formatEther(stakeData.stakedAmount)} ETH staked`);
    return { success: true };
  }

  // Check which chains have paymasters registered
  const registered = await getRegisteredPaymasters(provider, config.hub.l1StakeManager, chains);
  if (registered.length === 0) {
    return { success: false, error: 'No L2 paymasters registered. Deploy first: bun scripts/deploy/eil-paymaster.ts --all' };
  }

  const minStake = await contract.MIN_STAKE();
  const stake = ethers.parseEther(stakeAmount);
  if (stake < minStake) return { success: false, error: `Stake below min ${ethers.formatEther(minStake)} ETH` };

  const balance = await provider.getBalance(wallet.address);
  if (balance < stake) return { success: false, error: `Insufficient balance: ${ethers.formatEther(balance)} ETH` };

  logger.info(`Registering XLP on ${config.hub.name} with ${stakeAmount} ETH...`);
  logger.info(`  Chains: ${registered.map(chainName).join(', ')}`);

  const tx = await contract.register(registered, { value: stake });
  logger.info(`  TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  if (receipt.status === 0) return { success: false, error: 'Transaction reverted' };

  return { success: true, txHash: tx.hash };
}

async function depositLiquidity(chainId: number, paymaster: string, amount: string, privateKey: string): Promise<{ success: boolean; txHash?: string; error?: string }> {
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) return { success: false, error: `No RPC for chain ${chainId}` };

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(paymaster, PAYMASTER_ABI, wallet);

  const depositAmount = ethers.parseEther(amount);
  const balance = await provider.getBalance(wallet.address);
  if (balance < depositAmount) return { success: false, error: `Insufficient balance: ${ethers.formatEther(balance)} ETH` };

  logger.info(`Depositing ${amount} ETH to ${chainName(chainId)} paymaster...`);
  const tx = await contract.depositETH({ value: depositAmount });
  logger.info(`  TX: ${tx.hash}`);
  
  const receipt = await tx.wait();
  if (receipt.status === 0) return { success: false, error: 'Transaction reverted' };

  return { success: true, txHash: tx.hash };
}

async function showStatus(config: EILConfig, address: string) {
  console.log('\n═══ XLP Status ═══\n');

  const hubRpc = PUBLIC_RPCS[config.hub.chainId];
  if (hubRpc && config.hub.l1StakeManager) {
    const provider = new ethers.JsonRpcProvider(hubRpc);
    const contract = new ethers.Contract(config.hub.l1StakeManager, L1_STAKE_MANAGER_ABI, provider);
    
    const stakeData = await contract.getStake(address);
    console.log(`L1 Hub (${config.hub.name}):`);
    console.log(`  Status: ${stakeData.isActive ? '✅ Active' : '❌ Not registered'}`);
    console.log(`  Stake: ${ethers.formatEther(stakeData.stakedAmount)} ETH`);
    
    if (stakeData.isActive) {
      const chains = (await contract.getXLPChains(address)).map((c: bigint) => Number(c));
      console.log(`  Chains: ${chains.map(chainName).join(', ')}`);
    }

    const allChainIds = [84532, 11155420, 421614, 420690];
    const registered = await getRegisteredPaymasters(provider, config.hub.l1StakeManager, allChainIds);
    console.log(`  L2 Paymasters: ${registered.length > 0 ? registered.map(chainName).join(', ') : '⚠️ None registered'}`);
    console.log('');
  }

  for (const chain of Object.values(config.chains)) {
    if (!chain.crossChainPaymaster) continue;
    const rpc = PUBLIC_RPCS[chain.chainId];
    if (!rpc) continue;

    const provider = new ethers.JsonRpcProvider(rpc);
    const contract = new ethers.Contract(chain.crossChainPaymaster, PAYMASTER_ABI, provider);
    const ethBalance = await contract.getXLPETH(address);
    const stake = await contract.xlpVerifiedStake(address);
    
    console.log(`${chain.name}:`);
    console.log(`  ETH Liquidity: ${ethers.formatEther(ethBalance)} ETH`);
    console.log(`  Verified Stake: ${ethers.formatEther(stake)} ETH\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const network = (args[args.indexOf('--network') + 1] as 'testnet' | 'mainnet') || 'testnet';
  const stakeAmount = args[args.indexOf('--stake') + 1] || '1.0';
  const depositChainId = args.includes('--deposit') ? parseInt(args[args.indexOf('--chain') + 1]) : null;
  const depositAmount = args[args.indexOf('--amount') + 1] || '0.1';
  const showStatusMode = args.includes('--status');

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║              EIL XLP Registration                              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const privateKey = process.env.XLP_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!privateKey) {
    logger.error('Set XLP_PRIVATE_KEY, DEPLOYER_PRIVATE_KEY, or PRIVATE_KEY');
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey);
  logger.info(`XLP: ${wallet.address} | Network: ${network}\n`);

  const config = loadEILConfig(network);
  if (!config) {
    logger.error(`EIL not configured for ${network}. Check packages/config/eil.json`);
    process.exit(1);
  }

  // Status mode
  if (showStatusMode) {
    await showStatus(config, wallet.address);
    process.exit(0);
  }

  // Deposit mode
  if (depositChainId) {
    const chain = Object.values(config.chains).find(c => c.chainId === depositChainId);
    if (!chain?.crossChainPaymaster) {
      logger.error(`No paymaster on chain ${depositChainId}`);
      process.exit(1);
    }
    const result = await depositLiquidity(depositChainId, chain.crossChainPaymaster, depositAmount, privateKey);
    if (result.success) logger.success(`Deposited ${depositAmount} ETH`);
    else logger.error(result.error!);
    process.exit(result.success ? 0 : 1);
  }

  // Register mode
  if (!config.hub.l1StakeManager) {
    logger.error('L1StakeManager not deployed. Run: bun scripts/deploy/eil.ts testnet');
    process.exit(1);
  }

  const supportedChains = Object.values(config.chains).filter(c => c.crossChainPaymaster).map(c => c.chainId);
  if (supportedChains.length === 0) supportedChains.push(84532, 11155420, 421614, 420690);

  console.log(`Hub: ${config.hub.name} | Stake: ${stakeAmount} ETH`);
  console.log(`Chains: ${supportedChains.map(chainName).join(', ')}\n`);

  const result = await registerXLP(config, supportedChains, stakeAmount, privateKey);
  if (result.success) {
    logger.success('XLP registered');
    console.log('\nNext: bun scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5');
  } else {
    logger.error(result.error!);
  }
  process.exit(result.success ? 0 : 1);
}

main().catch(err => {
  logger.error(err.message);
  process.exit(1);
});
