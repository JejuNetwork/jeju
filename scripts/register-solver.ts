#!/usr/bin/env bun
import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PUBLIC_RPCS, chainName, TESTNET_CHAIN_IDS } from './shared/chains';

const logger = new Logger('register-solver');

const ABI = [
  'function register(uint256[] calldata chains) external payable',
  'function addChain(uint256 chainId) external',
  'function isSolverActive(address) view returns (bool)',
  'function getSolverStake(address) view returns (uint256)',
  'function getSolverChains(address) view returns (uint256[])',
  'function MIN_STAKE() view returns (uint256)',
];

function loadDeployments(network: 'testnet' | 'mainnet') {
  const path = resolve(process.cwd(), `packages/contracts/deployments/oif-${network}.json`);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf-8')).chains || {};
}

function getDeployedChains(): number[] {
  const all = { ...loadDeployments('testnet'), ...loadDeployments('mainnet') };
  return Object.entries(all)
    .filter(([, d]: [string, { status: string; contracts?: { solverRegistry: string } }]) => 
      d.status === 'deployed' && d.contracts?.solverRegistry)
    .map(([id]) => parseInt(id));
}

function isTestnet(chainId: number): boolean {
  return TESTNET_CHAIN_IDS.includes(chainId);
}

async function register(chainId: number, supportedChains: number[], stake: string, pk: string) {
  const rpc = PUBLIC_RPCS[chainId];
  if (!rpc) throw new Error(`No RPC for ${chainId}`);

  const deployments = loadDeployments(isTestnet(chainId) ? 'testnet' : 'mainnet');
  const registry = (deployments[chainId.toString()] as { contracts?: { solverRegistry: string } })?.contracts?.solverRegistry;
  if (!registry) throw new Error(`No SolverRegistry on ${chainName(chainId)}`);

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(registry, ABI, wallet);

  if (await contract.isSolverActive(wallet.address)) {
    const current = await contract.getSolverStake(wallet.address);
    logger.info(`Already registered: ${ethers.formatEther(current)} ETH`);
    
    const chains = (await contract.getSolverChains(wallet.address)).map((c: bigint) => Number(c));
    for (const c of supportedChains.filter(x => !chains.includes(x))) {
      await (await contract.addChain(c)).wait();
      logger.info(`  Added ${chainName(c)}`);
    }
    return;
  }

  const minStake = await contract.MIN_STAKE();
  const amount = ethers.parseEther(stake);
  if (amount < minStake) throw new Error(`Stake below min ${ethers.formatEther(minStake)} ETH`);

  const balance = await provider.getBalance(wallet.address);
  if (balance < amount) throw new Error(`Balance ${ethers.formatEther(balance)} < stake ${stake} ETH`);

  logger.info(`Registering on ${chainName(chainId)} with ${stake} ETH...`);
  const tx = await contract.register(supportedChains, { value: amount });
  logger.info(`  TX: ${tx.hash}`);
  await tx.wait();
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const chainIdx = args.indexOf('--chain');
  const stakeIdx = args.indexOf('--stake');
  
  const chainId = chainIdx !== -1 ? parseInt(args[chainIdx + 1]) : null;
  const stake = stakeIdx !== -1 ? args[stakeIdx + 1] : '0.5';

  console.log('═══ OIF Solver Registration ═══\n');

  const pk = process.env.SOLVER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error('Set SOLVER_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY');

  logger.info(`Solver: ${new ethers.Wallet(pk).address}\n`);

  const deployed = getDeployedChains();
  if (deployed.length === 0) throw new Error('No OIF deployed');

  const targets = chainId ? [chainId] : all ? deployed : [];
  if (targets.length === 0) {
    console.log(`Deployed: ${deployed.map(c => `${chainName(c)} (${c})`).join(', ')}`);
    console.log('\nUsage: --chain 84532 or --all --stake 0.5');
    return;
  }

  console.log(`Stake: ${stake} ETH | Chains: ${targets.map(chainName).join(', ')}\n`);

  let ok = 0;
  for (const id of targets) {
    try {
      await register(id, deployed, stake, pk);
      logger.success(chainName(id));
      ok++;
    } catch (e) {
      logger.error(`${chainName(id)}: ${(e as Error).message}`);
    }
  }

  console.log(`\n═══ ${ok}/${targets.length} registered ═══`);
  process.exit(ok === targets.length ? 0 : 1);
}

main().catch(e => { logger.error(e.message); process.exit(1); });
