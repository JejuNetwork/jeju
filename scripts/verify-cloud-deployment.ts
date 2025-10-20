#!/usr/bin/env bun
/**
 * Verify Cloud Integration Deployment
 * 
 * Checks that all contracts are deployed correctly and configured properly.
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';
import { CloudIntegration, type CloudConfig } from './shared/cloud-integration';

const logger = new Logger('verify-deployment');

async function main() {
  logger.info('🔍 Verifying cloud integration deployment...\n');
  
  // Load config
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || 'http://localhost:8545'
  );
  
  const addresses = {
    identityRegistryAddress: process.env.IDENTITY_REGISTRY!,
    reputationRegistryAddress: process.env.REPUTATION_REGISTRY!,
    cloudReputationProviderAddress: process.env.CLOUD_REPUTATION_PROVIDER!,
    serviceRegistryAddress: process.env.SERVICE_REGISTRY!,
    creditManagerAddress: process.env.CREDIT_MANAGER!
  };
  
  logger.info('Checking addresses:');
  Object.entries(addresses).forEach(([name, addr]) => {
    logger.info(`  ${name}: ${addr}`);
  });
  
  // Check contracts have code
  logger.info('\n📝 Verifying contracts are deployed...');
  
  for (const [name, address] of Object.entries(addresses)) {
    const code = await provider.getCode(address);
    
    if (code === '0x') {
      logger.error(`✗ ${name} has no code at ${address}`);
      throw new Error(`Contract not deployed: ${name}`);
    }
    
    logger.success(`✓ ${name}`);
  }
  
  // Initialize integration
  logger.info('\n🔗 Initializing CloudIntegration...');
  
  const config: CloudConfig = {
    ...addresses,
    provider,
    logger,
    chainId: BigInt((await provider.getNetwork()).chainId)
  };
  
  const integration = new CloudIntegration(config);
  logger.success('✓ CloudIntegration initialized');
  
  // Check cloud agent registration
  logger.info('\n🤖 Checking cloud agent...');
  
  const cloudAgentId = await integration.getCloudAgentId();
  
  if (cloudAgentId === 0n) {
    logger.warn('✗ Cloud agent not registered yet');
    logger.info('  Run: bun run deploy:cloud');
  } else {
    logger.success(`✓ Cloud agent ID: ${cloudAgentId}`);
    
    // Get agent metadata
    const identityRegistry = new ethers.Contract(
      addresses.identityRegistryAddress,
      [
        'function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory)',
        'function getAgent(uint256 agentId) external view returns (tuple(uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))'
      ],
      provider
    );
    
    const agent = await identityRegistry.getAgent(cloudAgentId);
    logger.info(`  Owner: ${agent.owner}`);
    logger.info(`  Registered: ${new Date(Number(agent.registeredAt) * 1000).toISOString()}`);
    logger.info(`  Banned: ${agent.isBanned ? 'Yes' : 'No'}`);
    
    try {
      const nameBytes = await identityRegistry.getMetadata(cloudAgentId, 'name');
      const name = ethers.toUtf8String(nameBytes);
      logger.info(`  Name: ${name}`);
    } catch (e) {
      logger.warn('  Name: Not set');
    }
  }
  
  // Check services
  logger.info('\n📋 Checking registered services...');
  
  const serviceRegistry = new ethers.Contract(
    addresses.serviceRegistryAddress,
    [
      'function isServiceAvailable(string calldata serviceName) external view returns (bool)',
      'function getServiceCount() external view returns (uint256)'
    ],
    provider
  );
  
  const serviceCount = await serviceRegistry.getServiceCount();
  logger.info(`Total services: ${serviceCount}`);
  
  const testServices = ['chat-completion', 'image-generation', 'embeddings'];
  
  for (const service of testServices) {
    const isAvailable = await serviceRegistry.isServiceAvailable(service);
    
    if (isAvailable) {
      logger.success(`  ✓ ${service}`);
    } else {
      logger.warn(`  ✗ ${service} not registered`);
    }
  }
  
  // Check approvers
  logger.info('\n🔐 Checking ban approvers...');
  
  const cloudRepProvider = new ethers.Contract(
    addresses.cloudReputationProviderAddress,
    [
      'function getBanApprovers() external view returns (address[])',
      'function banApprovalThreshold() external view returns (uint256)'
    ],
    provider
  );
  
  const approvers = await cloudRepProvider.getBanApprovers();
  const threshold = await cloudRepProvider.banApprovalThreshold();
  
  logger.info(`Threshold: ${threshold}/${approvers.length}`);
  
  approvers.forEach((approver: string, i: number) => {
    logger.info(`  ${i + 1}. ${approver}`);
  });
  
  if (approvers.length < Number(threshold)) {
    logger.error(`✗ Not enough approvers: need ${threshold}, have ${approvers.length}`);
  } else {
    logger.success(`✓ Multi-sig configured correctly`);
  }
  
  // Summary
  logger.info('\n═══════════════════════════════════════════════════');
  logger.info('📊 Verification Summary');
  logger.info('═══════════════════════════════════════════════════');
  
  const checks = [
    { name: 'Contracts deployed', pass: true },
    { name: 'Cloud agent registered', pass: cloudAgentId > 0n },
    { name: 'Services registered', pass: serviceCount > 0n },
    { name: 'Multi-sig configured', pass: approvers.length >= Number(threshold) }
  ];
  
  checks.forEach(check => {
    const icon = check.pass ? '✓' : '✗';
    const color = check.pass ? '\x1b[32m' : '\x1b[31m';
    logger.info(`${color}${icon}\x1b[0m ${check.name}`);
  });
  
  const allPass = checks.every(c => c.pass);
  
  if (allPass) {
    logger.success('\n🎉 All checks passed! Cloud integration ready for testing.');
  } else {
    logger.warn('\n⚠️  Some checks failed. Review configuration.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Verification failed:', error);
    process.exit(1);
  });


