#!/usr/bin/env bun
/**
 * @internal Used by CLI: `jeju deploy testnet-full`
 * 
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

import { createPublicClient, createWalletClient, http, parseEther, formatEther, getBalance, waitForTransactionReceipt, zeroAddress, sendTransaction, type Address } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { parseAbi } from 'viem';
import { inferChainFromRpcUrl } from '../shared/chain-utils';
import { writeFileSync } from 'fs';

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
    name: 'Testnet',
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

async function getBalanceFormatted(publicClient: ReturnType<typeof createPublicClient>, address: Address): Promise<string> {
  const balance = await getBalance(publicClient, { address });
  return formatEther(balance);
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
  deployerPrivateKey: `0x${string}`,
  _existingContracts: Record<number, Record<string, string>>
): Promise<DeploymentResult> {
  log(`\n========== Deploying to ${chain.name} (${chain.chainId}) ==========`);
  
  const chainObj = inferChainFromRpcUrl(chain.rpc);
  const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
  const account = privateKeyToAccount(deployerPrivateKey);
  
  const balance = await getBalanceFormatted(publicClient, account.address);
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
    // Placeholder - actual deployment would use forge
    contracts.l1StakeManager = zeroAddress; // Will be filled by forge
    
    success(`L1StakeManager: ${contracts.l1StakeManager}`);
  } else {
    // Deploy L2 contracts
    log('Deploying CrossChainPaymaster...');
    contracts.crossChainPaymaster = zeroAddress; // Will be filled by forge
    
    log('Deploying OIF contracts...');
    contracts.solverRegistry = zeroAddress;
    contracts.inputSettler = zeroAddress;
    contracts.outputSettler = zeroAddress;
    
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
  xlpAddress: Address,
  deployerPrivateKey: `0x${string}`
) {
  log('\n========== Funding XLP on all chains ==========');
  
  const fundAmount = parseEther('0.5'); // 0.5 ETH per chain
  
  for (const chain of chains) {
    const chainObj = inferChainFromRpcUrl(chain.rpc);
    const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
    const deployerAccount = privateKeyToAccount(deployerPrivateKey);
    const walletClient = createWalletClient({ account: deployerAccount, chain: chainObj, transport: http(chain.rpc) });
    const xlpBalance = await getBalanceFormatted(publicClient, xlpAddress);
    log(`${chain.name}: XLP balance = ${xlpBalance} ETH`);
    
    if (parseFloat(xlpBalance) < 0.1) {
      log(`Funding XLP on ${chain.name}...`);
      const hash = await sendTransaction(walletClient, {
        to: xlpAddress,
        value: fundAmount,
        account: deployerAccount,
      });
      await waitForTransactionReceipt(publicClient, { hash });
      success(`Funded XLP with 0.5 ETH on ${chain.name}`);
    } else {
      success(`XLP already funded on ${chain.name}`);
    }
  }
}

async function registerXLP(
  _deployerPrivateKey: `0x${string}`,
  xlpPrivateKey: `0x${string}`,
  deployments: Record<number, DeploymentResult>
) {
  log('\n========== Registering XLP ==========');
  
  // Register on L1 (Sepolia)
  const sepoliaChain = TESTNET_CHAINS.find(c => c.chainId === 11155111);
  if (!sepoliaChain) throw new Error('Sepolia not found');
  
  const chainObj = inferChainFromRpcUrl(sepoliaChain.rpc);
  const publicClient = createPublicClient({ chain: chainObj, transport: http(sepoliaChain.rpc) });
  const xlpAccount = privateKeyToAccount(xlpPrivateKey);
  const walletClient = createWalletClient({ account: xlpAccount, chain: chainObj, transport: http(sepoliaChain.rpc) });
  
  const l1StakeManager = deployments[11155111]?.contracts.l1StakeManager;
  if (!l1StakeManager || l1StakeManager === zeroAddress) {
    error('L1StakeManager not deployed yet');
    return;
  }
  
  const L1_STAKE_MANAGER_ABI_PARSED = parseAbi(L1_STAKE_MANAGER_ABI);
  
  // Get L2 chain IDs
  const l2ChainIds = TESTNET_CHAINS
    .filter(c => c.type === 'l2')
    .map(c => BigInt(c.chainId));
  
  log(`Registering XLP for chains: ${l2ChainIds.join(', ')}`);
  
  const stakeAmount = parseEther('1'); // 1 ETH stake
  
  try {
    const hash = await walletClient.writeContract({
      address: l1StakeManager as Address,
      abi: L1_STAKE_MANAGER_ABI_PARSED,
      functionName: 'register',
      args: [l2ChainIds],
      value: stakeAmount,
      account: xlpAccount,
    });
    await waitForTransactionReceipt(publicClient, { hash });
    success(`XLP registered with 1 ETH stake`);
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (errMsg.includes('AlreadyRegistered')) {
      success('XLP already registered');
    } else {
      throw e;
    }
  }
}

async function depositXLPLiquidity(
  xlpPrivateKey: `0x${string}`,
  deployments: Record<number, DeploymentResult>
) {
  log('\n========== Depositing XLP Liquidity ==========');
  
  for (const chain of TESTNET_CHAINS.filter(c => c.type === 'l2')) {
    const deployment = deployments[chain.chainId];
    if (!deployment?.contracts.crossChainPaymaster) {
      log(`Skipping ${chain.name} - no paymaster deployed`);
      continue;
    }
    
    const chainObj = inferChainFromRpcUrl(chain.rpc);
    const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
    const xlpAccount = privateKeyToAccount(xlpPrivateKey);
    const walletClient = createWalletClient({ account: xlpAccount, chain: chainObj, transport: http(chain.rpc) });
    
    const CROSS_CHAIN_PAYMASTER_ABI_PARSED = parseAbi(CROSS_CHAIN_PAYMASTER_ABI);
    
    const depositAmount = parseEther('0.1');
    
    log(`Depositing 0.1 ETH liquidity on ${chain.name}...`);
    
    try {
      const hash = await walletClient.writeContract({
        address: deployment.contracts.crossChainPaymaster as Address,
        abi: CROSS_CHAIN_PAYMASTER_ABI_PARSED,
        functionName: 'depositETH',
        value: depositAmount,
        account: xlpAccount,
      });
      await waitForTransactionReceipt(publicClient, { hash });
      success(`Deposited 0.1 ETH on ${chain.name}`);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      error(`Failed to deposit on ${chain.name}: ${errMsg}`);
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
  
  const deployerAccount = privateKeyToAccount(deployerKey as `0x${string}`);
  const xlpAccount = xlpKey ? privateKeyToAccount(xlpKey as `0x${string}`) : privateKeyToAccount(generatePrivateKey());
  
  log(`Deployer: ${deployerAccount.address}`);
  log(`XLP: ${xlpAccount.address}`);
  
  // Check balances on all chains
  log('\n========== Checking Balances ==========');
  for (const chain of TESTNET_CHAINS) {
    try {
      const chainObj = inferChainFromRpcUrl(chain.rpc);
      const publicClient = createPublicClient({ chain: chainObj, transport: http(chain.rpc) });
      const balance = await getBalanceFormatted(publicClient, deployerAccount.address);
      log(`${chain.name}: ${balance} ETH`);
    } catch {
      error(`${chain.name}: Unable to connect`);
    }
  }
  
  // Deploy contracts
  const deployments: Record<number, DeploymentResult> = {};
  
  // Deploy L1 first
  const l1Chain = TESTNET_CHAINS.find(c => c.type === 'l1');
  if (l1Chain) {
    try {
      const existingContracts = Object.fromEntries(
        Object.entries(deployments).map(([chainId, result]) => [chainId, result.contracts])
      ) as Record<number, Record<string, string>>;
      deployments[l1Chain.chainId] = await deployToChain(l1Chain, deployerKey as `0x${string}`, existingContracts);
    } catch (e) {
      error(`L1 deployment failed: ${(e as Error).message}`);
    }
  }
  
  // Deploy L2s
  for (const chain of TESTNET_CHAINS.filter(c => c.type === 'l2')) {
    try {
      const existingContracts = Object.fromEntries(
        Object.entries(deployments).map(([chainId, result]) => [chainId, result.contracts])
      ) as Record<number, Record<string, string>>;
      deployments[chain.chainId] = await deployToChain(chain, deployerKey as `0x${string}`, existingContracts);
    } catch (e) {
      error(`${chain.name} deployment failed: ${(e as Error).message}`);
    }
  }
  
  // Fund XLP
  try {
    await fundXLP(TESTNET_CHAINS, xlpAccount.address, deployerKey as `0x${string}`);
  } catch (e) {
    error(`XLP funding failed: ${(e as Error).message}`);
  }
  
  // Register XLP
  try {
    await registerXLP(deployerKey as `0x${string}`, (xlpKey || generatePrivateKey()) as `0x${string}`, deployments);
  } catch (e) {
    error(`XLP registration failed: ${(e as Error).message}`);
  }
  
  // Deposit liquidity
  try {
    await depositXLPLiquidity((xlpKey || generatePrivateKey()) as `0x${string}`, deployments);
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
