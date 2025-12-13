#!/usr/bin/env bun
import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName } from './shared/chains';

const logger = new Logger('register-xlp');

const STAKE_ABI = [
  'function register(uint256[] calldata chains) external payable',
  'function getStake(address) view returns (tuple(uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt))',
  'function getXLPChains(address) view returns (uint256[])',
  'function MIN_STAKE() view returns (uint256)',
  'function l2Paymasters(uint256) view returns (address)',
];

const PAYMASTER_ABI = [
  'function depositETH() external payable',
  'function getXLPETH(address) view returns (uint256)',
  'function xlpVerifiedStake(address) view returns (uint256)',
];

interface EILConfig {
  hub: { chainId: number; name: string; l1StakeManager: string };
  chains: Record<string, { chainId: number; name: string; crossChainPaymaster: string }>;
}

function loadConfig(network: string): EILConfig {
  const path = resolve(process.cwd(), 'packages/config/eil.json');
  if (!existsSync(path)) throw new Error('eil.json not found');
  const cfg = JSON.parse(readFileSync(path, 'utf-8'))[network];
  if (!cfg) throw new Error(`No EIL config for ${network}`);
  return cfg;
}

async function getRegisteredPaymasters(provider: ethers.JsonRpcProvider, manager: string, chains: number[]): Promise<number[]> {
  const contract = new ethers.Contract(manager, STAKE_ABI, provider);
  const out: number[] = [];
  for (const id of chains) {
    const addr = await contract.l2Paymasters(id);
    if (addr !== ethers.ZeroAddress) out.push(id);
  }
  return out;
}

async function registerXLP(config: EILConfig, chains: number[], stake: string, pk: string) {
  const rpc = PUBLIC_RPCS[config.hub.chainId];
  if (!rpc) throw new Error(`No RPC for hub ${config.hub.chainId}`);
  if (!config.hub.l1StakeManager) throw new Error('L1StakeManager not deployed');

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(config.hub.l1StakeManager, STAKE_ABI, wallet);

  const data = await contract.getStake(wallet.address);
  if (data.isActive) {
    logger.info(`Already registered: ${ethers.formatEther(data.stakedAmount)} ETH`);
    return;
  }

  const registered = await getRegisteredPaymasters(provider, config.hub.l1StakeManager, chains);
  if (registered.length === 0) throw new Error('No L2 paymasters registered');

  const minStake = await contract.MIN_STAKE();
  const amount = ethers.parseEther(stake);
  if (amount < minStake) throw new Error(`Stake below min ${ethers.formatEther(minStake)} ETH`);

  const balance = await provider.getBalance(wallet.address);
  if (balance < amount) throw new Error(`Balance ${ethers.formatEther(balance)} < stake ${stake} ETH`);

  logger.info(`Registering on ${config.hub.name} with ${stake} ETH...`);
  logger.info(`  Chains: ${registered.map(chainName).join(', ')}`);

  const tx = await contract.register(registered, { value: amount });
  logger.info(`  TX: ${tx.hash}`);
  await tx.wait();
}

async function deposit(chainId: number, paymaster: string, amount: string, pk: string) {
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) throw new Error(`No RPC for ${chainId}`);

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(paymaster, PAYMASTER_ABI, wallet);

  const value = ethers.parseEther(amount);
  const balance = await provider.getBalance(wallet.address);
  if (balance < value) throw new Error(`Balance ${ethers.formatEther(balance)} < ${amount} ETH`);

  logger.info(`Depositing ${amount} ETH to ${chainName(chainId)}...`);
  const tx = await contract.depositETH({ value });
  logger.info(`  TX: ${tx.hash}`);
  await tx.wait();
}

async function showStatus(config: EILConfig, address: string) {
  console.log('\n═══ XLP Status ═══\n');

  const rpc = PUBLIC_RPCS[config.hub.chainId];
  if (rpc && config.hub.l1StakeManager) {
    const provider = new ethers.JsonRpcProvider(rpc);
    const contract = new ethers.Contract(config.hub.l1StakeManager, STAKE_ABI, provider);
    
    const data = await contract.getStake(address);
    console.log(`L1 Hub (${config.hub.name}):`);
    console.log(`  Status: ${data.isActive ? '✅ Active' : '❌ Not registered'}`);
    console.log(`  Stake: ${ethers.formatEther(data.stakedAmount)} ETH`);
    
    if (data.isActive) {
      const chains = (await contract.getXLPChains(address)).map((c: bigint) => Number(c));
      console.log(`  Chains: ${chains.map(chainName).join(', ')}`);
    }
    console.log('');
  }

  for (const chain of Object.values(config.chains)) {
    if (!chain.crossChainPaymaster) continue;
    const rpc = PUBLIC_RPCS[chain.chainId];
    if (!rpc) continue;

    const provider = new ethers.JsonRpcProvider(rpc);
    const contract = new ethers.Contract(chain.crossChainPaymaster, PAYMASTER_ABI, provider);
    const eth = await contract.getXLPETH(address);
    const stake = await contract.xlpVerifiedStake(address);
    
    console.log(`${chain.name}: ${ethers.formatEther(eth)} ETH, verified: ${ethers.formatEther(stake)} ETH`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const network = args[args.indexOf('--network') + 1] || 'testnet';
  const stake = args[args.indexOf('--stake') + 1] || '1.0';
  const depositChain = args.includes('--deposit') ? parseInt(args[args.indexOf('--chain') + 1]) : null;
  const depositAmt = args[args.indexOf('--amount') + 1] || '0.1';
  const status = args.includes('--status');

  console.log('═══ EIL XLP Registration ═══\n');

  const pk = process.env.XLP_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('Set XLP_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');

  const wallet = new ethers.Wallet(pk);
  logger.info(`XLP: ${wallet.address} | Network: ${network}\n`);

  const config = loadConfig(network);

  if (status) {
    await showStatus(config, wallet.address);
    return;
  }

  if (depositChain) {
    const chain = Object.values(config.chains).find(c => c.chainId === depositChain);
    if (!chain?.crossChainPaymaster) throw new Error(`No paymaster on ${depositChain}`);
    await deposit(depositChain, chain.crossChainPaymaster, depositAmt, pk);
    logger.success(`Deposited ${depositAmt} ETH`);
    return;
  }

  const chains = Object.values(config.chains).filter(c => c.crossChainPaymaster).map(c => c.chainId);
  console.log(`Hub: ${config.hub.name} | Stake: ${stake} ETH`);
  console.log(`Chains: ${chains.map(chainName).join(', ')}\n`);

  await registerXLP(config, chains, stake, pk);
  logger.success('XLP registered');
  console.log('\nNext: bun scripts/register-xlp.ts --deposit --chain 84532 --amount 0.5');
}

main().catch(e => { logger.error(e.message); process.exit(1); });
