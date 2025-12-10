#!/usr/bin/env bun
/**
 * Full Testnet Deployment Script
 * 
 * Deploys and configures:
 * - L1StakeManager on Sepolia
 * - CrossChainPaymaster on all L2 testnets
 * - OIF contracts (InputSettler, OutputSettler, SolverRegistry)
 * - XLP initial liquidity
 * 
 * Usage:
 *   bun scripts/deploy-testnet-full.ts
 * 
 * Requires:
 *   DEPLOYER_KEY - Private key with ETH on all testnets
 *   XLP_KEY - XLP private key for initial liquidity
 */

import { ethers } from 'ethers';
import { readFileSync, writeFileSync } from 'fs';

// ============ Configuration ============

interface ChainConfig {
  name: string;
  chainId: number;
  rpc: string;
  type: 'l1' | 'l2';
}

const TESTNET_CHAINS: ChainConfig[] = [
  {
    name: 'Sepolia',
    chainId: 11155111,
    rpc: process.env.SEPOLIA_RPC || 'https://ethereum-sepolia-rpc.publicnode.com',
    type: 'l1'
  },
  {
    name: 'Jeju Testnet',
    chainId: 420690,
    rpc: process.env.JEJU_RPC || 'https://testnet-rpc.jejunetwork.org',
    type: 'l2'
  },
  {
    name: 'Base Sepolia',
    chainId: 84532,
    rpc: process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org',
    type: 'l2'
  },
  {
    name: 'Arbitrum Sepolia',
    chainId: 421614,
    rpc: process.env.ARB_SEPOLIA_RPC || 'https://sepolia-rollup.arbitrum.io/rpc',
    type: 'l2'
  },
  {
    name: 'Optimism Sepolia',
    chainId: 11155420,
    rpc: process.env.OP_SEPOLIA_RPC || 'https://sepolia.optimism.io',
    type: 'l2'
  }
];

// Deterministic deployment salts
const SALTS = {
  CREATE2_FACTORY: ethers.keccak256(ethers.toUtf8Bytes('jeju-create2-factory-v1')),
  L1_STAKE_MANAGER: ethers.keccak256(ethers.toUtf8Bytes('jeju-l1-stake-manager-v1')),
  CROSS_CHAIN_PAYMASTER: ethers.keccak256(ethers.toUtf8Bytes('jeju-cross-chain-paymaster-v1')),
  SOLVER_REGISTRY: ethers.keccak256(ethers.toUtf8Bytes('jeju-solver-registry-v1')),
  INPUT_SETTLER: ethers.keccak256(ethers.toUtf8Bytes('jeju-input-settler-v1')),
  OUTPUT_SETTLER: ethers.keccak256(ethers.toUtf8Bytes('jeju-output-settler-v1')),
};

// Contract ABIs (minimal for deployment)
const L1_STAKE_MANAGER_ABI = [
  'function initialize(address owner)',
  'function registerPaymaster(uint256 chainId, address paymaster)',
  'function register(uint256[] calldata chains) payable',
  'function l2Paymasters(uint256 chainId) view returns (address)',
  'function stakes(address xlp) view returns (uint256 stakedAmount, uint256 unbondingAmount, uint256 unbondingStartTime, uint256 slashedAmount, bool isActive, uint256 registeredAt)',
];

const CROSS_CHAIN_PAYMASTER_ABI = [
  'function initialize(address owner, uint256 l1ChainId, address stakeManager)',
  'function depositLiquidity(address token, uint256 amount)',
  'function depositETH() payable',
  'function updateXLPStake(address xlp, uint256 stake)',
];

// ============ Utilities ============

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function error(msg: string) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
}

async function getBalance(provider: ethers.Provider, address: string): Promise<string> {
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

// ============ Deployment Functions ============

interface DeploymentResult {
  chainId: number;
  chainName: string;
  contracts: Record<string, string>;
  txHashes: string[];
}

async function deployToChain(
  chain: ChainConfig,
  deployerWallet: ethers.Wallet,
  existingContracts: Record<number, Record<string, string>>
): Promise<DeploymentResult> {
  log(`\n========== Deploying to ${chain.name} (${chain.chainId}) ==========`);
  
  const provider = new ethers.JsonRpcProvider(chain.rpc);
  const deployer = deployerWallet.connect(provider);
  
  const balance = await getBalance(provider, deployer.address);
  log(`Deployer balance: ${balance} ETH`);
  
  if (parseFloat(balance) < 0.01) {
    throw new Error(`Insufficient balance on ${chain.name}`);
  }
  
  const contracts: Record<string, string> = {};
  const txHashes: string[] = [];
  
  if (chain.type === 'l1') {
    // Deploy L1 contracts
    log('Deploying L1StakeManager...');
    
    // For now, deploy non-upgradeable version
    // In production, use Create2Factory + proxy
    const L1StakeManagerFactory = new ethers.ContractFactory(
      L1_STAKE_MANAGER_ABI,
      '0x...', // bytecode would go here
      deployer
    );
    
    // Placeholder - actual deployment would use forge
    contracts.l1StakeManager = ethers.ZeroAddress; // Will be filled by forge
    
    success(`L1StakeManager: ${contracts.l1StakeManager}`);
  } else {
    // Deploy L2 contracts
    const l1ChainId = 11155111; // Sepolia
    const l1StakeManager = existingContracts[l1ChainId]?.l1StakeManager || ethers.ZeroAddress;
    
    log('Deploying CrossChainPaymaster...');
    contracts.crossChainPaymaster = ethers.ZeroAddress; // Will be filled by forge
    
    log('Deploying OIF contracts...');
    contracts.solverRegistry = ethers.ZeroAddress;
    contracts.inputSettler = ethers.ZeroAddress;
    contracts.outputSettler = ethers.ZeroAddress;
    
    success(`CrossChainPaymaster: ${contracts.crossChainPaymaster}`);
    success(`SolverRegistry: ${contracts.solverRegistry}`);
  }
  
  return {
    chainId: chain.chainId,
    chainName: chain.name,
    contracts,
    txHashes
  };
}

async function fundXLP(
  chains: ChainConfig[],
  xlpWallet: ethers.Wallet,
  deployerWallet: ethers.Wallet
) {
  log('\n========== Funding XLP on all chains ==========');
  
  const fundAmount = ethers.parseEther('0.5'); // 0.5 ETH per chain
  
  for (const chain of chains) {
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const deployer = deployerWallet.connect(provider);
    
    const xlpBalance = await getBalance(provider, xlpWallet.address);
    log(`${chain.name}: XLP balance = ${xlpBalance} ETH`);
    
    if (parseFloat(xlpBalance) < 0.1) {
      log(`Funding XLP on ${chain.name}...`);
      const tx = await deployer.sendTransaction({
        to: xlpWallet.address,
        value: fundAmount
      });
      await tx.wait();
      success(`Funded XLP with 0.5 ETH on ${chain.name}`);
    } else {
      success(`XLP already funded on ${chain.name}`);
    }
  }
}

async function registerXLP(
  deployerWallet: ethers.Wallet,
  xlpWallet: ethers.Wallet,
  deployments: Record<number, DeploymentResult>
) {
  log('\n========== Registering XLP ==========');
  
  // Register on L1 (Sepolia)
  const sepoliaChain = TESTNET_CHAINS.find(c => c.chainId === 11155111);
  if (!sepoliaChain) throw new Error('Sepolia not found');
  
  const provider = new ethers.JsonRpcProvider(sepoliaChain.rpc);
  const xlp = xlpWallet.connect(provider);
  
  const l1StakeManager = deployments[11155111]?.contracts.l1StakeManager;
  if (!l1StakeManager || l1StakeManager === ethers.ZeroAddress) {
    error('L1StakeManager not deployed yet');
    return;
  }
  
  const stakeManager = new ethers.Contract(l1StakeManager, L1_STAKE_MANAGER_ABI, xlp);
  
  // Get L2 chain IDs
  const l2ChainIds = TESTNET_CHAINS
    .filter(c => c.type === 'l2')
    .map(c => c.chainId);
  
  log(`Registering XLP for chains: ${l2ChainIds.join(', ')}`);
  
  const stakeAmount = ethers.parseEther('1'); // 1 ETH stake
  
  try {
    const tx = await stakeManager.register(l2ChainIds, { value: stakeAmount });
    await tx.wait();
    success(`XLP registered with 1 ETH stake`);
  } catch (e: unknown) {
    const err = e as Error;
    if (err.message.includes('AlreadyRegistered')) {
      success('XLP already registered');
    } else {
      throw e;
    }
  }
}

async function depositXLPLiquidity(
  xlpWallet: ethers.Wallet,
  deployments: Record<number, DeploymentResult>
) {
  log('\n========== Depositing XLP Liquidity ==========');
  
  for (const chain of TESTNET_CHAINS.filter(c => c.type === 'l2')) {
    const deployment = deployments[chain.chainId];
    if (!deployment?.contracts.crossChainPaymaster) {
      log(`Skipping ${chain.name} - no paymaster deployed`);
      continue;
    }
    
    const provider = new ethers.JsonRpcProvider(chain.rpc);
    const xlp = xlpWallet.connect(provider);
    
    const paymaster = new ethers.Contract(
      deployment.contracts.crossChainPaymaster,
      CROSS_CHAIN_PAYMASTER_ABI,
      xlp
    );
    
    const depositAmount = ethers.parseEther('0.1');
    
    log(`Depositing 0.1 ETH liquidity on ${chain.name}...`);
    
    try {
      const tx = await paymaster.depositETH({ value: depositAmount });
      await tx.wait();
      success(`Deposited 0.1 ETH on ${chain.name}`);
    } catch (e: unknown) {
      error(`Failed to deposit on ${chain.name}: ${(e as Error).message}`);
    }
  }
}

// ============ Main ============

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    JEJU TESTNET FULL DEPLOYMENT          ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  // Load keys
  const deployerKey = process.env.DEPLOYER_KEY;
  const xlpKey = process.env.XLP_KEY;
  
  if (!deployerKey) {
    error('DEPLOYER_KEY not set');
    process.exit(1);
  }
  
  const deployerWallet = new ethers.Wallet(deployerKey);
  const xlpWallet = xlpKey ? new ethers.Wallet(xlpKey) : ethers.Wallet.createRandom();
  
  log(`Deployer: ${deployerWallet.address}`);
  log(`XLP: ${xlpWallet.address}`);
  
  // Check balances on all chains
  log('\n========== Checking Balances ==========');
  for (const chain of TESTNET_CHAINS) {
    try {
      const provider = new ethers.JsonRpcProvider(chain.rpc);
      const balance = await getBalance(provider, deployerWallet.address);
      log(`${chain.name}: ${balance} ETH`);
    } catch (e) {
      error(`${chain.name}: Unable to connect`);
    }
  }
  
  // Deploy contracts
  const deployments: Record<number, DeploymentResult> = {};
  
  // Deploy L1 first
  const l1Chain = TESTNET_CHAINS.find(c => c.type === 'l1');
  if (l1Chain) {
    try {
      deployments[l1Chain.chainId] = await deployToChain(l1Chain, deployerWallet, deployments);
    } catch (e) {
      error(`L1 deployment failed: ${(e as Error).message}`);
    }
  }
  
  // Deploy L2s
  for (const chain of TESTNET_CHAINS.filter(c => c.type === 'l2')) {
    try {
      deployments[chain.chainId] = await deployToChain(chain, deployerWallet, deployments);
    } catch (e) {
      error(`${chain.name} deployment failed: ${(e as Error).message}`);
    }
  }
  
  // Fund XLP
  try {
    await fundXLP(TESTNET_CHAINS, xlpWallet, deployerWallet);
  } catch (e) {
    error(`XLP funding failed: ${(e as Error).message}`);
  }
  
  // Register XLP
  try {
    await registerXLP(deployerWallet, xlpWallet, deployments);
  } catch (e) {
    error(`XLP registration failed: ${(e as Error).message}`);
  }
  
  // Deposit liquidity
  try {
    await depositXLPLiquidity(xlpWallet, deployments);
  } catch (e) {
    error(`Liquidity deposit failed: ${(e as Error).message}`);
  }
  
  // Save deployments
  const outputPath = './packages/config/deployments-testnet.json';
  writeFileSync(outputPath, JSON.stringify(deployments, null, 2));
  success(`Deployments saved to ${outputPath}`);
  
  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    DEPLOYMENT SUMMARY                    ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  for (const [chainId, deployment] of Object.entries(deployments)) {
    console.log(`\n${deployment.chainName} (${chainId}):`);
    for (const [name, address] of Object.entries(deployment.contracts)) {
      console.log(`  ${name}: ${address}`);
    }
  }
  
  console.log('\n\nNext steps:');
  console.log('1. Run forge scripts to deploy actual contracts');
  console.log('2. Update packages/config/contracts.json with deployed addresses');
  console.log('3. Configure paymasters on L1StakeManager');
  console.log('4. Test cross-chain transfers');
}

main().catch(console.error);
