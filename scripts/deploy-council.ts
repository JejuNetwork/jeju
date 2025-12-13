#!/usr/bin/env bun
/**
 * Deploy Council Contracts
 * 
 * Deploys the AI Council DAO contracts:
 * - Council.sol - Main governance contract
 * - CEOAgent.sol - AI CEO management
 * 
 * Usage:
 *   DEPLOYER_KEY=0x... bun scripts/deploy-council.ts [network]
 * 
 * Networks: localnet, testnet, mainnet
 */

import { ethers, ContractFactory, Wallet, JsonRpcProvider, parseEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { $ } from 'bun';

// Contract ABIs and bytecode will be loaded after compilation
const CONTRACTS_DIR = join(import.meta.dir, '../packages/contracts');
const OUT_DIR = join(CONTRACTS_DIR, 'out');

interface NetworkConfig {
  name: string;
  chainId: number;
  rpcUrl: string;
  governanceToken: string;
  identityRegistry: string;
  reputationRegistry: string;
}

const NETWORKS: Record<string, NetworkConfig> = {
  localnet: {
    name: 'Jeju Localnet',
    chainId: 8545,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:9545',
    governanceToken: process.env.GOVERNANCE_TOKEN ?? '0x0000000000000000000000000000000000000000',
    identityRegistry: process.env.IDENTITY_REGISTRY ?? '0x0000000000000000000000000000000000000000',
    reputationRegistry: process.env.REPUTATION_REGISTRY ?? '0x0000000000000000000000000000000000000000',
  },
  testnet: {
    name: 'Jeju Testnet',
    chainId: 84532,
    rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
    governanceToken: process.env.GOVERNANCE_TOKEN ?? '0x0000000000000000000000000000000000000000',
    identityRegistry: process.env.IDENTITY_REGISTRY ?? '0x0000000000000000000000000000000000000000',
    reputationRegistry: process.env.REPUTATION_REGISTRY ?? '0x0000000000000000000000000000000000000000',
  },
  mainnet: {
    name: 'Jeju Mainnet',
    chainId: 8453,
    rpcUrl: process.env.RPC_URL ?? 'https://mainnet.base.org',
    governanceToken: process.env.GOVERNANCE_TOKEN ?? '',
    identityRegistry: process.env.IDENTITY_REGISTRY ?? '',
    reputationRegistry: process.env.REPUTATION_REGISTRY ?? '',
  }
};

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✓ ${msg}\x1b[0m`);
}

function error(msg: string) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
}

function loadContractArtifact(contractName: string): { abi: unknown[]; bytecode: string } {
  const artifactPath = join(OUT_DIR, `${contractName}.sol`, `${contractName}.json`);
  
  if (!existsSync(artifactPath)) {
    throw new Error(`Contract artifact not found: ${artifactPath}. Run 'forge build' first.`);
  }
  
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object
  };
}

async function deployContract(
  wallet: Wallet,
  contractName: string,
  constructorArgs: unknown[]
): Promise<string> {
  log(`Deploying ${contractName}...`);
  
  const { abi, bytecode } = loadContractArtifact(contractName);
  const factory = new ContractFactory(abi, bytecode, wallet);
  
  const contract = await factory.deploy(...constructorArgs);
  await contract.waitForDeployment();
  
  const address = await contract.getAddress();
  success(`${contractName} deployed at: ${address}`);
  
  return address;
}

async function main() {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     JEJU AI COUNCIL CONTRACT DEPLOYMENT   ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Parse arguments
  const network = process.argv[2] ?? 'localnet';
  const config = NETWORKS[network];
  
  if (!config) {
    error(`Unknown network: ${network}`);
    console.log('Available networks: localnet, testnet, mainnet');
    process.exit(1);
  }

  // Check for deployer key
  const deployerKey = process.env.DEPLOYER_KEY;
  if (!deployerKey) {
    error('DEPLOYER_KEY environment variable not set');
    console.log('\nUsage: DEPLOYER_KEY=0x... bun scripts/deploy-council.ts [network]');
    process.exit(1);
  }

  log(`Network: ${config.name} (Chain ID: ${config.chainId})`);
  log(`RPC: ${config.rpcUrl}`);

  // Compile contracts first
  log('Compiling contracts...');
  const compileResult = await $`cd ${CONTRACTS_DIR} && forge build --contracts src/council/ 2>&1`.text();
  if (compileResult.includes('Error')) {
    error('Compilation failed');
    console.log(compileResult);
    process.exit(1);
  }
  success('Contracts compiled');

  // Setup provider and wallet
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(deployerKey, provider);
  const deployerAddress = await wallet.getAddress();
  
  log(`Deployer: ${deployerAddress}`);
  
  const balance = await provider.getBalance(deployerAddress);
  log(`Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < parseEther('0.01')) {
    error('Insufficient balance for deployment');
    process.exit(1);
  }

  // For localnet, use deployer address as placeholders for required contracts
  // In production, these would be actual deployed contract addresses
  let governanceToken = config.governanceToken;
  let identityRegistry = config.identityRegistry;
  let reputationRegistry = config.reputationRegistry;

  if (network === 'localnet') {
    // Use deployer address as mock addresses since they just need to be non-zero
    if (governanceToken === '0x0000000000000000000000000000000000000000') {
      governanceToken = deployerAddress;
      log(`Using deployer as mock governance token: ${governanceToken}`);
    }
    if (identityRegistry === '0x0000000000000000000000000000000000000000') {
      identityRegistry = deployerAddress;
      log(`Using deployer as mock identity registry: ${identityRegistry}`);
    }
    if (reputationRegistry === '0x0000000000000000000000000000000000000000') {
      reputationRegistry = deployerAddress;
      log(`Using deployer as mock reputation registry: ${reputationRegistry}`);
    }
  }

  // Deploy Council
  const councilAddress = await deployContract(wallet, 'Council', [
    governanceToken,
    identityRegistry,
    reputationRegistry,
    deployerAddress // initialOwner
  ]);

  // Deploy CEOAgent
  const ceoAgentAddress = await deployContract(wallet, 'CEOAgent', [
    governanceToken,
    councilAddress,
    'claude-opus-4-5-20250514', // initialModelId
    deployerAddress // initialOwner
  ]);

  // Configure Council with CEO
  log('Configuring Council with CEO agent...');
  const councilArtifact = loadContractArtifact('Council');
  const council = new ethers.Contract(councilAddress, councilArtifact.abi, wallet);
  
  const tx = await council.setCEOAgent(ceoAgentAddress, 1);
  await tx.wait();
  success('CEO agent configured');

  // Save deployment info
  const deployment = {
    network,
    chainId: config.chainId,
    timestamp: new Date().toISOString(),
    deployer: deployerAddress,
    contracts: {
      Council: councilAddress,
      CEOAgent: ceoAgentAddress
    },
    dependencies: {
      governanceToken,
      identityRegistry,
      reputationRegistry
    }
  };

  const deploymentPath = join(import.meta.dir, `../apps/council/deployment-${network}.json`);
  writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  success(`Deployment info saved to ${deploymentPath}`);

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║          DEPLOYMENT COMPLETE              ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  console.log('Deployed Contracts:');
  console.log(`  Council:   ${councilAddress}`);
  console.log(`  CEOAgent:  ${ceoAgentAddress}`);
  
  console.log('\nNext steps:');
  console.log('1. Set council agent addresses using council.setCouncilAgent()');
  console.log('2. Configure research operators using council.setResearchOperator()');
  console.log('3. Update apps/council/.env with contract addresses');
  console.log(`\nEnvironment variables for apps/council:
COUNCIL_ADDRESS=${councilAddress}
CEO_AGENT_ADDRESS=${ceoAgentAddress}
`);
}

main().catch((err) => {
  error(err.message);
  process.exit(1);
});
