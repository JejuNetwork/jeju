#!/usr/bin/env bun
/**
 * Setup Cloud Ban Approvers
 * 
 * Configures multi-sig approvers for ban proposals.
 * Run after deploying CloudReputationProvider.
 */

import { ethers } from 'ethers';
import { Logger } from './shared/logger';

const logger = new Logger('setup-approvers');

async function main() {
  logger.info('🔐 Setting up cloud ban approvers...\n');
  
  // Load config
  const cloudRepAddress = process.env.CLOUD_REPUTATION_PROVIDER;
  const rpcUrl = process.env.RPC_URL || 'http://localhost:8545';
  const privateKey = process.env.PRIVATE_KEY || 
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
  
  if (!cloudRepAddress) {
    throw new Error('CLOUD_REPUTATION_PROVIDER not set in .env');
  }
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  
  logger.info(`Deployer: ${await signer.getAddress()}`);
  logger.info(`Cloud Reputation Provider: ${cloudRepAddress}\n`);
  
  const contract = new ethers.Contract(
    cloudRepAddress,
    [
      'function addBanApprover(address approver) external',
      'function getBanApprovers() external view returns (address[])',
      'function banApprovalThreshold() external view returns (uint256)'
    ],
    signer
  );
  
  // Default approvers (Anvil accounts)
  const defaultApprovers = [
    '0x70997970C51812dc3A010C7d01b50e0d17dc79C8', // Account #1
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC', // Account #2
    '0x90F79bf6EB2c4f870365E785982E1f101E93b906'  // Account #3
  ];
  
  // Add approvers
  for (const approver of defaultApprovers) {
    logger.info(`Adding approver: ${approver}`);
    
    const tx = await contract.addBanApprover(approver);
    await tx.wait();
    
    logger.success(`✓ Added: ${approver}`);
  }
  
  // Verify
  logger.info('\n📊 Verifying configuration...');
  const approvers = await contract.getBanApprovers();
  const threshold = await contract.banApprovalThreshold();
  
  logger.info(`Total approvers: ${approvers.length}`);
  logger.info(`Approval threshold: ${threshold}`);
  
  approvers.forEach((approver: string, i: number) => {
    logger.info(`  ${i + 1}. ${approver}`);
  });
  
  logger.success('\n✓ Cloud ban approvers configured successfully');
  logger.info(`\nBan proposals will require ${threshold}/${approvers.length} approvals to execute`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    logger.error('Setup failed:', error);
    process.exit(1);
  });


