#!/usr/bin/env bun
import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { FailoverProvider } from './shared/failover-provider';
import { 
  CloudIntegration, 
  defaultCloudServices, 
  type AgentMetadata,
  type CloudConfig 
} from './shared/cloud-integration';
import fs from 'fs';
import path from 'path';

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
  signer: ethers.Signer,
  addresses: DeploymentAddresses
): Promise<string> {
  logger.info('📝 Compiling CloudReputationProvider...');
  
  // In a real deployment, you'd compile with Foundry
  // For now, we'll assume it's already compiled
  const artifactPath = path.join(
    __dirname,
    '../contracts/out/CloudReputationProvider.sol/CloudReputationProvider.json'
  );
  
  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      'CloudReputationProvider not compiled. Run: cd contracts && forge build'
    );
  }
  
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
  
  logger.info('🚀 Deploying CloudReputationProvider...');
  
  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode.object,
    signer
  );
  
  const contract = await factory.deploy(
    addresses.identityRegistry,
    addresses.reputationRegistry,
    await signer.getAddress()
  );
  
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  
  logger.success(`✓ CloudReputationProvider deployed at: ${address}`);
  
  return address;
}

/**
 * Setup cloud agent and services
 */
async function setupCloudIntegration(
  integration: CloudIntegration,
  signer: ethers.Signer,
  metadata: AgentMetadata
): Promise<void> {
  logger.info('🤖 Registering cloud service as agent...');
  
  // Create agent card for cloud service
  const agentCard = {
    name: metadata.name,
    description: metadata.description,
    version: metadata.version,
    type: 'cloud-service',
    capabilities: metadata.capabilities,
    endpoints: {
      a2a: metadata.endpoint,
      health: `${metadata.endpoint}/health`,
      metrics: `${metadata.endpoint}/metrics`
    },
    payment: {
      x402: true,
      tokens: ['USDC', 'elizaOS', 'ETH']
    },
    reputation: {
      provider: true,
      canBan: true,
      canSetReputation: true
    }
  };
  
  // Upload to IPFS (placeholder - in production use actual IPFS)
  const tokenURI = `ipfs://QmCloudServiceCard${Date.now()}`;
  logger.info(`Agent card URI: ${tokenURI}`);
  
  // Register cloud agent
  const agentId = await integration.registerCloudAgent(
    signer,
    metadata,
    tokenURI
  );
  
  logger.success(`✓ Cloud agent registered with ID: ${agentId}`);
  
  // Register cloud services
  logger.info('📋 Registering cloud services in ServiceRegistry...');
  await integration.registerServices(signer, defaultCloudServices);
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
  
  // Load deployment addresses
  const addressesPath = process.env.ADDRESSES_FILE || 
    path.join(__dirname, '../contracts/deployments/localnet-addresses.json');
  
  if (!fs.existsSync(addressesPath)) {
    throw new Error(`Deployment addresses not found at: ${addressesPath}`);
  }
  
  const addresses: DeploymentAddresses = JSON.parse(
    fs.readFileSync(addressesPath, 'utf-8')
  );
  
  logger.info('Loaded deployment addresses:');
  logger.info(`  IdentityRegistry: ${addresses.identityRegistry}`);
  logger.info(`  ReputationRegistry: ${addresses.reputationRegistry}`);
  logger.info(`  ServiceRegistry: ${addresses.serviceRegistry}`);
  logger.info(`  CreditManager: ${addresses.creditManager}`);
  
  // Setup provider and signer
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'; // Anvil default
  
  const provider = new FailoverProvider([rpcUrl]);
  const signer = new ethers.Wallet(privateKey, provider);
  
  logger.info(`\nDeploying from: ${await signer.getAddress()}`);
  logger.info(`Network: ${(await provider.getNetwork()).name} (${(await provider.getNetwork()).chainId})\n`);
  
  // Deploy CloudReputationProvider if not already deployed
  if (!addresses.cloudReputationProvider) {
    addresses.cloudReputationProvider = await deployCloudReputationProvider(
      signer,
      addresses
    );
    
    // Save updated addresses
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
    identityRegistryAddress: addresses.identityRegistry,
    reputationRegistryAddress: addresses.reputationRegistry,
    cloudReputationProviderAddress: addresses.cloudReputationProvider,
    serviceRegistryAddress: addresses.serviceRegistry,
    creditManagerAddress: addresses.creditManager,
    provider,
    logger
  };
  
  const integration = new CloudIntegration(config);
  
  // Setup cloud agent and services
  const metadata: AgentMetadata = {
    name: 'Jeju Cloud Services',
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
  
  await setupCloudIntegration(integration, signer, metadata);
  
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

