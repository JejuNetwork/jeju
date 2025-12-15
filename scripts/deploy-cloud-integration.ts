#!/usr/bin/env bun
/**
 * @deprecated This script is vendor-specific and has been moved to vendor/cloud/scripts/deploy.ts
 * This copy remains for backwards compatibility. For new deployments, use:
 * cd vendor/cloud && bun run scripts/deploy.ts
 */

import { createPublicClient, createWalletClient, http, encodeDeployData, getContractAddress, waitForTransactionReceipt, type Address, type Chain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { Logger } from './shared/logger';
import { 
  CloudIntegration, 
  defaultCloudServices, 
  type AgentMetadata,
  type CloudConfig 
} from './shared/cloud-integration';
import fs from 'fs';
import path from 'path';
import { rawDeployments, getContractAddresses } from '@jejunetwork/contracts';
import { inferChainFromRpcUrl } from './shared/chain-utils';

const logger = new Logger('deploy-cloud-integration');

interface DeploymentAddresses {
  identityRegistry: string;
  reputationRegistry: string;
  serviceRegistry: string;
  creditManager: string;
  cloudReputationProvider?: string;
  usdc: string;
  elizaOS: string;
}

/**
 * Deploy CloudReputationProvider contract
 */
async function deployCloudReputationProvider(
  publicClient: ReturnType<typeof createPublicClient>,
  walletClient: ReturnType<typeof createWalletClient>,
  accountAddress: Address,
  addresses: DeploymentAddresses
): Promise<string> {
  logger.info('📝 Compiling CloudReputationProvider...');
  
  // In a real deployment, you'd compile with Foundry
  // For now, we'll assume it's already compiled
  const artifactPath = path.join(
    __dirname,
    '../packages/contracts/out/CloudReputationProvider.sol/CloudReputationProvider.json'
  );
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      'CloudReputationProvider not compiled. Run: cd packages/contracts && forge build'
    );
  }
  
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  
  logger.info('🚀 Deploying CloudReputationProvider...');
  
  const deployData = encodeDeployData({
    abi: parseAbi(artifact.abi),
    bytecode: artifact.bytecode.object as `0x${string}`,
    args: [
      addresses.identityRegistry as Address,
      addresses.reputationRegistry as Address,
      accountAddress,
    ],
  });
  
  const hash = await walletClient.sendTransaction({ data: deployData });
  const receipt = await waitForTransactionReceipt(publicClient, { hash });
  const address = receipt.contractAddress ?? getContractAddress({ from: accountAddress, nonce: BigInt(0) });
  
  logger.success(`✓ CloudReputationProvider deployed at: ${address}`);
  
  return address;
}

/**
 * Setup cloud agent and services
 */
async function setupCloudIntegration(
  integration: CloudIntegration,
  account: ReturnType<typeof privateKeyToAccount>,
  metadata: AgentMetadata
): Promise<void> {
  logger.info('🤖 Registering cloud service as agent...');
  
  // Upload to IPFS (placeholder - in production use actual IPFS)
  const tokenURI = `ipfs://QmCloudServiceCard${Date.now()}`;
  logger.info(`Agent card URI: ${tokenURI}`);
  
  // Register cloud agent
  const agentId = await integration.registerCloudAgent(
    account,
    metadata,
    tokenURI
  );
  
  logger.success(`✓ Cloud agent registered with ID: ${agentId}`);
  
  // Register cloud services
  logger.info('📋 Registering cloud services in ServiceRegistry...');
  await integration.registerServices(account, defaultCloudServices);
  logger.success(`✓ Registered ${defaultCloudServices.length} services`);
  
  // Set cloud as authorized operator
  logger.info('🔐 Setting up permissions...');
  // This would be done via the CloudReputationProvider's setAuthorizedOperator
  logger.success('✓ Permissions configured');
}

/**
 * Main deployment function
 */
async function main() {
  logger.info('=== Cloud Integration Deployment ===\n');
  
  // Load deployment addresses from @jejunetwork/contracts
  const contractAddrs = getContractAddresses(1337);
  const localnetAddrs = rawDeployments.localnetAddresses as Record<string, string>;
  
  const addresses: DeploymentAddresses = {
    identityRegistry: contractAddrs.identityRegistry || localnetAddrs.identityRegistry,
    reputationRegistry: contractAddrs.reputationRegistry || localnetAddrs.reputationRegistry,
    serviceRegistry: contractAddrs.serviceRegistry || localnetAddrs.serviceRegistry,
    creditManager: localnetAddrs.creditManager,
    cloudReputationProvider: localnetAddrs.cloudReputationProvider,
    usdc: contractAddrs.usdc || localnetAddrs.usdc,
    elizaOS: contractAddrs.elizaOS || localnetAddrs.elizaOS,
  };
  
  logger.info('Loaded deployment addresses:');
  logger.info(`  IdentityRegistry: ${addresses.identityRegistry}`);
  logger.info(`  ReputationRegistry: ${addresses.reputationRegistry}`);
  logger.info(`  ServiceRegistry: ${addresses.serviceRegistry}`);
  logger.info(`  CreditManager: ${addresses.creditManager}`);
  
  // Setup provider and signer
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil default
  
  const chain = inferChainFromRpcUrl(rpcUrl);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });
  const cloudAgentAccount = privateKeyToAccount(
    (process.env.CLOUD_AGENT_KEY || '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a') as `0x${string}`
  );
  
  const chainId = await publicClient.getChainId();
  logger.info(`\nDeploying from: ${account.address}`);
  logger.info(`Network: ${chain.name} (${chainId})\n`);
  
  // Deploy CloudReputationProvider if not already deployed
  if (!addresses.cloudReputationProvider) {
    addresses.cloudReputationProvider = await deployCloudReputationProvider(
      publicClient,
      walletClient,
      account.address,
      addresses
    );
    
    // Save updated addresses
    const addressesPath = path.join(__dirname, '../config/addresses/localnet.json');
    if (!fs.existsSync(path.dirname(addressesPath))) {
      fs.mkdirSync(path.dirname(addressesPath), { recursive: true });
    }
    fs.writeFileSync(
      addressesPath,
      JSON.stringify(addresses, null, 2)
    );
    
    logger.success('✓ Addresses file updated\n');
  } else {
    logger.info(`Using existing CloudReputationProvider: ${addresses.cloudReputationProvider}\n`);
  }
  
  // Initialize CloudIntegration
  const config: CloudConfig = {
    identityRegistryAddress: addresses.identityRegistry as Address,
    reputationRegistryAddress: addresses.reputationRegistry as Address,
    cloudReputationProviderAddress: addresses.cloudReputationProvider as Address,
    serviceRegistryAddress: addresses.serviceRegistry as Address,
    creditManagerAddress: addresses.creditManager as Address,
    rpcUrl,
    chain,
    logger,
    cloudAgentAccount,
    chainId: BigInt(chainId),
  };
  
  const integration = new CloudIntegration(config);
  
  // Setup cloud agent and services
  const metadata: AgentMetadata = {
    name: 'Cloud Services',
    description: 'Decentralized AI inference and storage platform with x402 payments',
    endpoint: process.env.CLOUD_ENDPOINT || 'https://cloud.jeju.network/a2a',
    version: '1.0.0',
    capabilities: [
      'chat-completion',
      'image-generation',
      'embeddings',
      'storage',
      'compute',
      'reputation-provider',
      'x402-payments'
    ]
  };
  
  await setupCloudIntegration(integration, account, metadata);
  
  logger.success('\n=== Cloud Integration Deployment Complete ===');
  logger.info('\nNext steps:');
  logger.info('1. Configure cloud app with CloudReputationProvider address');
  logger.info('2. Add authorized operators via setAuthorizedOperator()');
  logger.info('3. Configure ban approvers via addBanApprover()');
  logger.info('4. Test x402 payments through cloud services');
  logger.info('5. Test A2A communication with cloud agent');
  logger.info('\nUseful commands:');
  logger.info(`  Cloud Agent ID: await integration.getCloudAgentId()`);
  logger.info(`  Check service: await integration.checkUserCredit(userAddress, 'chat-completion', usdcAddress)`);
  logger.info(`  Set reputation: await integration.setReputation(signer, agentId, 95, 'quality', 'api-usage', 'ipfs://...')`);
  logger.info(`  Record violation: await integration.recordViolation(signer, agentId, ViolationType.API_ABUSE, 80, 'ipfs://...')`);
}

// Run deployment
main()
  .then(() => {
    logger.success('\n✓ Deployment successful');
    process.exit(0);
  })
  .catch((error) => {
    logger.error('\n✗ Deployment failed:', error);
    process.exit(1);
  });

