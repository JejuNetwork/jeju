#!/usr/bin/env bun
/**
 * Cloud Integration Deployment Script
 * 
 * Deploys all smart contracts needed for the web2/web3 hybrid cloud integration:
 * - ServiceRegistry
 * - ServicePaymaster (enhanced paymaster)
 * - CreditPurchaseContract
 * 
 * Also sets up proper permissions and initial configuration.
 */

import { ethers } from 'ethers';
import { privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, createWalletClient, http } from 'viem';
import { logger } from '../scripts/shared/logger';

// Environment validation
const required = [
  'DEPLOYER_PRIVATE_KEY',
  'JEJU_RPC_URL',
  'ELIZAOS_TOKEN_ADDRESS',
  'APP_REVENUE_WALLET'
];

const missing = required.filter(key => !process.env[key]);
if (missing.length > 0) {
  console.error('❌ Missing required environment variables:');
  missing.forEach(key => console.log(`   ${key}`));
  process.exit(1);
}

// Chain configuration
const jejuChain = {
  id: 420691,
  name: 'Jeju',
  network: 'jeju',  
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.JEJU_RPC_URL!] },
    public: { http: [process.env.JEJU_RPC_URL!] }
  }
} as const;

// Clients
const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`);
const publicClient = createPublicClient({
  chain: jejuChain,
  transport: http()
});
const walletClient = createWalletClient({
  account,
  chain: jejuChain,
  transport: http()
});

interface DeploymentResult {
  address: string;
  txHash: string;
  gasUsed: string;
}

interface DeploymentSummary {
  cloudServiceRegistry: DeploymentResult;
  cloudPaymaster: DeploymentResult;
  creditPurchaseContract: DeploymentResult;
  totalGasUsed: string;
  totalDeploymentCost: string;
  blockNumber: number;
}

const banner = `
╔════════════════════════════════════════════╗
║       Cloud Integration Deployment        ║
║         Web2/Web3 Hybrid System           ║
╚════════════════════════════════════════════╝
`;

async function main() {
  console.log(banner);
  
  logger.info('Starting cloud integration deployment', {
    deployer: account.address,
    chain: jejuChain.name,
    chainId: jejuChain.id
  });

  try {
    // Check balances
    const balance = await publicClient.getBalance({ address: account.address });
    const balanceEth = ethers.formatEther(balance);
    
    if (Number(balanceEth) < 0.1) {
      throw new Error(`Insufficient ETH balance: ${balanceEth}. Need at least 0.1 ETH for deployment.`);
    }
    
    console.log(`💰 Deployer balance: ${balanceEth} ETH`);
    console.log(`🔑 Deploying from: ${account.address}\n`);

    const summary: Partial<DeploymentSummary> = {};
    let totalGasUsed = 0n;

    // 1. Deploy ServiceRegistry
    console.log('📋 Deploying ServiceRegistry...');
    summary.cloudServiceRegistry = await deployServiceRegistry();
    totalGasUsed += BigInt(summary.cloudServiceRegistry.gasUsed);
    console.log(`✅ ServiceRegistry: ${summary.cloudServiceRegistry.address}\n`);

    // 2. Deploy ServicePaymaster
    console.log('💳 Deploying ServicePaymaster...');
    summary.cloudPaymaster = await deployServicePaymaster(summary.cloudServiceRegistry.address);
    totalGasUsed += BigInt(summary.cloudPaymaster.gasUsed);
    console.log(`✅ ServicePaymaster: ${summary.cloudPaymaster.address}\n`);

    // 3. Deploy CreditPurchaseContract  
    console.log('🛒 Deploying CreditPurchaseContract...');
    summary.creditPurchaseContract = await deployCreditPurchaseContract();
    totalGasUsed += BigInt(summary.creditPurchaseContract.gasUsed);
    console.log(`✅ CreditPurchaseContract: ${summary.creditPurchaseContract.address}\n`);

    // Setup permissions and configuration
    console.log('⚙️  Setting up permissions and configuration...');
    await setupConfiguration(summary as DeploymentSummary);

    // Get final block number
    const currentBlock = await publicClient.getBlockNumber();
    
    // Calculate total cost
    const gasPrice = await publicClient.getGasPrice();
    const totalCost = totalGasUsed * gasPrice;
    
    const completeSummary: DeploymentSummary = {
      ...summary as DeploymentSummary,
      totalGasUsed: totalGasUsed.toString(),
      totalDeploymentCost: ethers.formatEther(totalCost),
      blockNumber: Number(currentBlock)
    };

    // Print deployment summary
    printDeploymentSummary(completeSummary);
    
    // Save deployment info
    await saveDeploymentInfo(completeSummary);

    console.log('\n🎉 Cloud integration deployment completed successfully!');
    console.log('💡 Next steps:');
    console.log('   1. Update your .env file with the new contract addresses');
    console.log('   2. Run the test suite with: bun scripts/test-cloud-integration.ts');
    console.log('   3. Set up monitoring and analytics');

  } catch (error) {
    logger.error('Deployment failed:', error);
    console.error('💥 Deployment failed:', error.message);
    process.exit(1);
  }
}

async function deployServiceRegistry(): Promise<DeploymentResult> {
  // Use Foundry to deploy ServiceRegistry
  const { execSync } = await import('child_process');

  try {
    const deployCmd = `forge create src/services/ServiceRegistry.sol:ServiceRegistry \
      --rpc-url ${process.env.JEJU_RPC_URL} \
      --private-key ${process.env.DEPLOYER_PRIVATE_KEY} \
      --constructor-args "${process.env.ELIZAOS_TOKEN_ADDRESS}" \
      --json`;

    const output = execSync(deployCmd, { encoding: 'utf-8' });
    const result = JSON.parse(output);

    // Get transaction receipt for gas used
    const receipt = await publicClient.getTransactionReceipt({ hash: result.transactionHash });

    return {
      address: result.deployedTo,
      txHash: result.transactionHash,
      gasUsed: receipt.gasUsed.toString()
    };
  } catch (error) {
    logger.error('Failed to deploy ServiceRegistry', error);
    throw new Error(`ServiceRegistry deployment failed: ${error.message}`);
  }
}

async function deployServicePaymaster(serviceRegistryAddress: string): Promise<DeploymentResult> {
  // Deploy ServicePaymaster with dependency on ServiceRegistry
  const { execSync } = await import('child_process');

  try {
    // ServicePaymaster needs: serviceRegistry, entryPoint, ElizaOSToken, depositPercentage, treasury
    const entryPoint = process.env.ENTRYPOINT_ADDRESS || '0x0000000071727De22E5E9d8BAf0edAc6f37da032'; // Standard ERC-4337 EntryPoint
    const depositPercentage = '10'; // 10% goes to deposit pool
    const treasury = process.env.APP_REVENUE_WALLET;

    const deployCmd = `forge create src/paymaster/ServicePaymaster.sol:ServicePaymaster \
      --rpc-url ${process.env.JEJU_RPC_URL} \
      --private-key ${process.env.DEPLOYER_PRIVATE_KEY} \
      --constructor-args "${serviceRegistryAddress}" "${entryPoint}" "${process.env.ELIZAOS_TOKEN_ADDRESS}" "${depositPercentage}" "${treasury}" \
      --json`;

    const output = execSync(deployCmd, { encoding: 'utf-8' });
    const result = JSON.parse(output);

    const receipt = await publicClient.getTransactionReceipt({ hash: result.transactionHash });

    return {
      address: result.deployedTo,
      txHash: result.transactionHash,
      gasUsed: receipt.gasUsed.toString()
    };
  } catch (error) {
    logger.error('Failed to deploy ServicePaymaster', error);
    throw new Error(`ServicePaymaster deployment failed: ${error.message}`);
  }
}

async function deployCreditPurchaseContract(): Promise<DeploymentResult> {
  // Deploy CreditPurchaseContract
  const { execSync } = await import('child_process');

  try {
    // CreditPurchaseContract needs: ElizaOSToken, priceOracle, revenueWallet
    const priceOracle = process.env.PRICE_ORACLE_ADDRESS || process.env.CROSS_CHAIN_ORACLE_ADDRESS;
    if (!priceOracle) {
      throw new Error('Price oracle address not configured (PRICE_ORACLE_ADDRESS or CROSS_CHAIN_ORACLE_ADDRESS)');
    }

    const deployCmd = `forge create src/services/CreditPurchaseContract.sol:CreditPurchaseContract \
      --rpc-url ${process.env.JEJU_RPC_URL} \
      --private-key ${process.env.DEPLOYER_PRIVATE_KEY} \
      --constructor-args "${process.env.ELIZAOS_TOKEN_ADDRESS}" "${priceOracle}" "${process.env.APP_REVENUE_WALLET}" \
      --json`;

    const output = execSync(deployCmd, { encoding: 'utf-8' });
    const result = JSON.parse(output);

    const receipt = await publicClient.getTransactionReceipt({ hash: result.transactionHash });

    return {
      address: result.deployedTo,
      txHash: result.transactionHash,
      gasUsed: receipt.gasUsed.toString()
    };
  } catch (error) {
    logger.error('Failed to deploy CreditPurchaseContract', error);
    throw new Error(`CreditPurchaseContract deployment failed: ${error.message}`);
  }
}

async function setupConfiguration(summary: DeploymentSummary) {
  const { parseAbi } = await import('viem');

  console.log('  📝 Service registry: Initial services pre-configured in constructor');
  // ServiceRegistry already initializes: chat-completion, image-generation, video-generation, container

  console.log('  🔗 Authorizing ServicePaymaster as caller in service registry...');
  try {
    const serviceRegistryAbi = parseAbi([
      'function setAuthorizedCaller(address caller, bool authorized) external'
    ]);

    const hash = await walletClient.writeContract({
      address: summary.cloudServiceRegistry.address as `0x${string}`,
      abi: serviceRegistryAbi,
      functionName: 'setAuthorizedCaller',
      args: [summary.cloudPaymaster.address as `0x${string}`, true]
    });

    await publicClient.waitForTransactionReceipt({ hash });
    console.log('    ✅ ServicePaymaster authorized');
  } catch (error) {
    logger.error('Failed to authorize paymaster', error);
    throw error;
  }

  console.log('  💰 Setting up payment tokens for CreditPurchaseContract...');
  try {
    // Add supported payment tokens (USDC, USDT, ETH, DAI on Base)
    const creditPurchaseAbi = parseAbi([
      'function addSupportedToken(address token) external'
    ]);

    const tokens = [
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC on Base
      '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2', // USDT on Base
      '0x0000000000000000000000000000000000000000', // Native ETH
      '0x50c5725949a6f0c72e6c4a641f24049a917db0cb'  // DAI on Base
    ];

    for (const token of tokens) {
      const hash = await walletClient.writeContract({
        address: summary.creditPurchaseContract.address as `0x${string}`,
        abi: creditPurchaseAbi,
        functionName: 'addSupportedToken',
        args: [token as `0x${string}`]
      });
      await publicClient.waitForTransactionReceipt({ hash });
    }
    console.log('    ✅ Payment tokens configured');
  } catch (error) {
    logger.warn('Some payment tokens may already be configured', error);
  }

  console.log('  🎯 Revenue destinations configured via constructor args');
  console.log('  🔐 Admin permissions: Deployer is owner of all contracts');

  console.log('✅ Configuration complete!');
}

function printDeploymentSummary(summary: DeploymentSummary) {
  console.log('\n' + '='.repeat(60));
  console.log('📊 DEPLOYMENT SUMMARY');
  console.log('='.repeat(60));
  console.log(`ServiceRegistry:     ${summary.cloudServiceRegistry.address}`);
  console.log(`ServicePaymaster:          ${summary.cloudPaymaster.address}`);
  console.log(`CreditPurchaseContract:  ${summary.creditPurchaseContract.address}`);
  console.log('─'.repeat(60));
  console.log(`Total Gas Used:          ${Number(summary.totalGasUsed).toLocaleString()}`);
  console.log(`Total Cost:              ${summary.totalDeploymentCost} ETH`);
  console.log(`Deployed at Block:       ${summary.blockNumber.toLocaleString()}`);
  console.log(`Chain:                   ${jejuChain.name} (ID: ${jejuChain.id})`);
  console.log('='.repeat(60));
}

async function saveDeploymentInfo(summary: DeploymentSummary) {
  const deploymentInfo = {
    timestamp: new Date().toISOString(),
    deployer: account.address,
    chain: {
      name: jejuChain.name,
      id: jejuChain.id,
      rpc: process.env.JEJU_RPC_URL
    },
    contracts: {
      ServiceRegistry: {
        address: summary.cloudServiceRegistry.address,
        txHash: summary.cloudServiceRegistry.txHash
      },
      ServicePaymaster: {
        address: summary.cloudPaymaster.address,
        txHash: summary.cloudPaymaster.txHash
      },
      CreditPurchaseContract: {
        address: summary.creditPurchaseContract.address,
        txHash: summary.creditPurchaseContract.txHash
      }
    },
    gasUsed: summary.totalGasUsed,
    cost: summary.totalDeploymentCost,
    blockNumber: summary.blockNumber
  };

  // Save to deployments folder
  const fs = await import('fs');
  const path = await import('path');
  
  const deploymentsDir = path.join(process.cwd(), 'deployments');
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  const filename = `cloud-integration-${jejuChain.name.toLowerCase()}-${Date.now()}.json`;
  const filepath = path.join(deploymentsDir, filename);
  
  fs.writeFileSync(filepath, JSON.stringify(deploymentInfo, null, 2));
  
  console.log(`💾 Deployment info saved to: ${filepath}`);

  // Also create/update latest deployment file
  const latestPath = path.join(deploymentsDir, `cloud-integration-${jejuChain.name.toLowerCase()}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(deploymentInfo, null, 2));
  
  console.log(`📌 Latest deployment info: ${latestPath}`);
}

// Run deployment
if (import.meta.main) {
  main().catch(console.error);
}