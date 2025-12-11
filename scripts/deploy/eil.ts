#!/usr/bin/env bun
/**
 * @fileoverview EIL (Ethereum Interop Layer) Deployment Script
 * 
 * Deploys:
 * - L1StakeManager on L1 (Base/Ethereum)
 * - CrossChainPaymaster on L2 (Jeju)
 * 
 * Usage:
 *   bun run scripts/deploy/eil.ts [network]
 *   network: localnet | testnet | mainnet
 */

import { ethers } from 'ethers';
import { Logger } from '../shared/logger';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const logger = new Logger({ prefix: 'deploy-eil' });

const CONTRACTS_DIR = resolve(process.cwd(), 'packages/contracts');
const CONFIG_DIR = resolve(process.cwd(), 'packages/config');

interface NetworkConfig {
  l1RpcUrl: string;
  l2RpcUrl: string;
  l1ChainId: number;
  l2ChainId: number;
  l1CrossDomainMessenger: string;
  l2CrossDomainMessenger: string;
  entryPoint: string;
}

interface DeploymentResult {
  network: string;
  l1StakeManager: string;
  crossChainPaymaster: string;
  entryPoint: string;
  deployedAt: string;
}

const NETWORK_CONFIGS: Record<string, NetworkConfig> = {
  localnet: {
    l1RpcUrl: 'http://127.0.0.1:8545',
    l2RpcUrl: 'http://127.0.0.1:9545',
    l1ChainId: 1337,
    l2ChainId: 420690,
    l1CrossDomainMessenger: '0x0000000000000000000000000000000000000000',
    l2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
    entryPoint: '0x0000000000000000000000000000000000000000', // Will deploy mock
  },
  testnet: {
    l1RpcUrl: process.env.SEPOLIA_RPC_URL || 'https://sepolia.ethereum.org',
    l2RpcUrl: process.env.JEJU_TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
    l1ChainId: 11155111,
    l2ChainId: 420690,
    l1CrossDomainMessenger: '0x4200000000000000000000000000000000000007', // Sepolia L1 messenger
    l2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789', // Standard ERC-4337 EntryPoint
  },
  mainnet: {
    l1RpcUrl: process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
    l2RpcUrl: process.env.JEJU_RPC_URL || 'https://rpc.jeju.network',
    l1ChainId: 1,
    l2ChainId: 420691,
    l1CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
    l2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  },
};

async function runForgeCreate(
  contract: string,
  rpcUrl: string,
  privateKey: string,
  constructorArgs: string[] = []
): Promise<string> {
  const args = [
    'create', contract,
    '--rpc-url', rpcUrl,
    '--private-key', privateKey,
    '--broadcast',
    '--json'
  ];
  
  if (constructorArgs.length > 0) {
    args.push('--constructor-args', ...constructorArgs);
  }
  
  logger.info(`Deploying ${contract.split(':')[1]}...`);
  
  const proc = Bun.spawn(['forge', ...args], {
    cwd: CONTRACTS_DIR,
    stdout: 'pipe',
    stderr: 'pipe'
  });
  
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  
  if (exitCode !== 0) {
    throw new Error(`Deployment failed: ${stderr || stdout}`);
  }
  
  // Parse JSON output
  const lines = stdout.split('\n').filter(l => l.trim());
  for (const line of lines) {
    if (line.includes('deployedTo')) {
      const json = JSON.parse(line);
      return json.deployedTo;
    }
  }
  
  // Fallback to regex
  const match = (stdout + stderr).match(/Deployed to: (0x[a-fA-F0-9]{40})/);
  if (!match) throw new Error(`Failed to parse deployment address: ${stdout.slice(0, 500)}`);
  return match[1];
}

async function deployEIL(network: string): Promise<DeploymentResult> {
  const config = NETWORK_CONFIGS[network];
  if (!config) {
    throw new Error(`Unknown network: ${network}. Use: localnet, testnet, mainnet`);
  }
  
  const privateKey = process.env.EVM_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('EVM_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY required');
  }
  
  logger.info(`Deploying EIL contracts to ${network}`);
  logger.info(`L1: ${config.l1RpcUrl} (chain ${config.l1ChainId})`);
  logger.info(`L2: ${config.l2RpcUrl} (chain ${config.l2ChainId})`);
  
  // Check deployer balance
  const l1Provider = new ethers.JsonRpcProvider(config.l1RpcUrl);
  const l2Provider = new ethers.JsonRpcProvider(config.l2RpcUrl);
  const deployer = new ethers.Wallet(privateKey);
  
  const l1Balance = await l1Provider.getBalance(deployer.address);
  const l2Balance = await l2Provider.getBalance(deployer.address);
  
  logger.info(`Deployer: ${deployer.address}`);
  logger.info(`L1 Balance: ${ethers.formatEther(l1Balance)} ETH`);
  logger.info(`L2 Balance: ${ethers.formatEther(l2Balance)} ETH`);
  
  if (l1Balance < ethers.parseEther('0.01')) {
    throw new Error('Insufficient L1 balance for deployment');
  }
  if (l2Balance < ethers.parseEther('0.01')) {
    throw new Error('Insufficient L2 balance for deployment');
  }
  
  // Deploy L1StakeManager
  logger.info('\n=== Deploying L1StakeManager on L1 ===');
  const l1StakeManager = await runForgeCreate(
    'src/eil/L1StakeManager.sol:L1StakeManager',
    config.l1RpcUrl,
    privateKey,
    []
  );
  logger.success(`L1StakeManager: ${l1StakeManager}`);
  
  // Deploy EntryPoint mock on localnet, use existing on testnet/mainnet
  let entryPoint = config.entryPoint;
  if (network === 'localnet') {
    logger.info('\n=== Deploying MockEntryPoint on L2 ===');
    entryPoint = await runForgeCreate(
      'src/eil/MockEntryPoint.sol:MockEntryPoint',
      config.l2RpcUrl,
      privateKey,
      []
    );
    logger.success(`MockEntryPoint: ${entryPoint}`);
  }
  
  // Deploy CrossChainPaymaster
  logger.info('\n=== Deploying CrossChainPaymaster on L2 ===');
  const crossChainPaymaster = await runForgeCreate(
    'src/eil/CrossChainPaymaster.sol:CrossChainPaymaster',
    config.l2RpcUrl,
    privateKey,
    [entryPoint, l1StakeManager, config.l2ChainId.toString()]
  );
  logger.success(`CrossChainPaymaster: ${crossChainPaymaster}`);
  
  // Configure L1StakeManager with L2 paymaster
  logger.info('\n=== Configuring L1StakeManager ===');
  const l1Signer = new ethers.Wallet(privateKey, l1Provider);
  const stakeManagerAbi = [
    'function registerL2Paymaster(uint256 chainId, address paymaster) external',
    'function setMessenger(address _messenger) external',
  ];
  const stakeManager = new ethers.Contract(l1StakeManager, stakeManagerAbi, l1Signer);
  
  // Register L2 paymaster
  const tx1 = await stakeManager.registerL2Paymaster(config.l2ChainId, crossChainPaymaster);
  await tx1.wait();
  logger.success(`Registered L2 paymaster for chain ${config.l2ChainId}`);
  
  // Set messenger if configured
  if (config.l1CrossDomainMessenger !== '0x0000000000000000000000000000000000000000') {
    const tx2 = await stakeManager.setMessenger(config.l1CrossDomainMessenger);
    await tx2.wait();
    logger.success(`Set L1 messenger: ${config.l1CrossDomainMessenger}`);
  }
  
  // Configure CrossChainPaymaster
  logger.info('\n=== Configuring CrossChainPaymaster ===');
  const l2Signer = new ethers.Wallet(privateKey, l2Provider);
  const paymasterAbi = [
    'function setTokenSupport(address token, bool supported) external',
    'function setMessenger(address _messenger) external',
  ];
  const paymaster = new ethers.Contract(crossChainPaymaster, paymasterAbi, l2Signer);
  
  // Enable native ETH support
  const tx3 = await paymaster.setTokenSupport('0x0000000000000000000000000000000000000000', true);
  await tx3.wait();
  logger.success('Enabled native ETH support');
  
  // Set messenger
  if (config.l2CrossDomainMessenger !== '0x0000000000000000000000000000000000000000') {
    const tx4 = await paymaster.setMessenger(config.l2CrossDomainMessenger);
    await tx4.wait();
    logger.success(`Set L2 messenger: ${config.l2CrossDomainMessenger}`);
  }
  
  // Save deployment
  const deployment: DeploymentResult = {
    network,
    l1StakeManager,
    crossChainPaymaster,
    entryPoint,
    deployedAt: new Date().toISOString(),
  };
  
  const deploymentsDir = resolve(CONTRACTS_DIR, 'deployments');
  if (!existsSync(deploymentsDir)) mkdirSync(deploymentsDir, { recursive: true });
  
  writeFileSync(
    resolve(deploymentsDir, `eil-${network}.json`),
    JSON.stringify(deployment, null, 2)
  );
  
  // Update contracts.json config
  const configPath = resolve(CONFIG_DIR, 'contracts.json');
  const contracts = JSON.parse(readFileSync(configPath, 'utf-8'));
  
  contracts[network].eil.l1StakeManager = l1StakeManager;
  contracts[network].eil.crossChainPaymaster = crossChainPaymaster;
  
  writeFileSync(configPath, JSON.stringify(contracts, null, 2));
  
  logger.info('\n' + '='.repeat(50));
  logger.success('EIL Deployment Complete!');
  logger.info('='.repeat(50));
  logger.info(`Network: ${network}`);
  logger.info(`L1StakeManager: ${l1StakeManager}`);
  logger.info(`CrossChainPaymaster: ${crossChainPaymaster}`);
  logger.info(`EntryPoint: ${entryPoint}`);
  logger.info(`\nSaved to: deployments/eil-${network}.json`);
  logger.info(`Config updated: packages/config/contracts.json`);
  
  return deployment;
}

// Main
const network = process.argv[2] || 'localnet';
deployEIL(network).catch((err) => {
  logger.error(`Deployment failed: ${err.message}`);
  process.exit(1);
});

