/**
 * Deploy Moderation System
 * Deploys BanManager, ReputationLabelManager, ReportingSystem
 * Updates Predimarket with authorized creators
 * Configures governance integration
 */

import { ethers } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Import existing contract addresses
import * as deployments from '../contracts/deployments/localnet-latest.json';

const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '';

interface ModerationDeployment {
  network: string;
  chainId: number;
  deployedAt: number;
  deployer: string;
  contracts: {
    BanManager: string;
    ReputationLabelManager: string;
    ReportingSystem: string;
    Predimarket: string; // Updated existing contract
    RegistryGovernance: string; // Existing
    IdentityRegistry: string; // Existing
  };
  config: {
    reportBonds: {
      LOW: string;
      MEDIUM: string;
      HIGH: string;
      CRITICAL: string;
    };
    votingPeriods: {
      LOW: number;
      MEDIUM: number;
      HIGH: number;
      CRITICAL: number;
    };
    stakeRequirements: {
      HACKER: string;
      SCAMMER: string;
      SPAM_BOT: string;
      TRUSTED: string;
    };
  };
}

async function main() {
  console.log('🚀 Deploying Moderation System...\n');

  // Setup provider and signer
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  const network = await provider.getNetwork();

  console.log(`Network: ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`Deployer: ${signer.address}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(signer.address))} ETH\n`);

  // Load existing contract addresses
  const identityRegistry = (deployments as any).IdentityRegistry || process.env.IDENTITY_REGISTRY_ADDRESS;
  const registryGovernance = (deployments as any).RegistryGovernance || process.env.REGISTRY_GOVERNANCE_ADDRESS;
  const predimarket = (deployments as any).Predimarket || process.env.PREDIMARKET_ADDRESS;

  if (!identityRegistry || !registryGovernance || !predimarket) {
    throw new Error('Missing required contract addresses. Deploy core contracts first.');
  }

  console.log('📋 Using existing contracts:');
  console.log(`  IdentityRegistry: ${identityRegistry}`);
  console.log(`  RegistryGovernance: ${registryGovernance}`);
  console.log(`  Predimarket: ${predimarket}\n`);

  // Step 1: Deploy BanManager
  console.log('📝 Deploying BanManager...');
  const BanManagerFactory = await ethers.getContractFactory(
    'BanManager',
    signer
  );
  const banManager = await BanManagerFactory.deploy(
    registryGovernance,
    signer.address
  );
  await banManager.waitForDeployment();
  const banManagerAddress = await banManager.getAddress();
  console.log(`✅ BanManager deployed: ${banManagerAddress}\n`);

  // Step 2: Deploy ReputationLabelManager
  console.log('📝 Deploying ReputationLabelManager...');
  const LabelManagerFactory = await ethers.getContractFactory(
    'ReputationLabelManager',
    signer
  );
  const labelManager = await LabelManagerFactory.deploy(
    banManagerAddress,
    predimarket,
    registryGovernance,
    signer.address
  );
  await labelManager.waitForDeployment();
  const labelManagerAddress = await labelManager.getAddress();
  console.log(`✅ ReputationLabelManager deployed: ${labelManagerAddress}\n`);

  // Step 3: Deploy ReportingSystem
  console.log('📝 Deploying ReportingSystem...');
  const ReportingSystemFactory = await ethers.getContractFactory(
    'ReportingSystem',
    signer
  );
  const reportingSystem = await ReportingSystemFactory.deploy(
    banManagerAddress,
    labelManagerAddress,
    predimarket,
    identityRegistry, // Added: IdentityRegistry for reporter lookup
    registryGovernance,
    signer.address
  );
  await reportingSystem.waitForDeployment();
  const reportingSystemAddress = await reportingSystem.getAddress();
  console.log(`✅ ReportingSystem deployed: ${reportingSystemAddress}\n`);

  // Step 4: Configure Predimarket - Add authorized creators
  console.log('🔧 Configuring Predimarket...');
  const predimarketContract = await ethers.getContractAt('Predimarket', predimarket, signer);

  console.log('  Adding ReportingSystem as authorized creator...');
  const tx1 = await predimarketContract.addAuthorizedCreator(reportingSystemAddress);
  await tx1.wait();
  console.log('  ✅ Added ReportingSystem');

  console.log('  Adding ReputationLabelManager as authorized creator...');
  const tx2 = await predimarketContract.addAuthorizedCreator(labelManagerAddress);
  await tx2.wait();
  console.log('  ✅ Added ReputationLabelManager\n');

  // Step 5: Configure BanManager governance
  console.log('🔧 Configuring BanManager governance...');
  const tx3 = await banManager.setGovernance(registryGovernance);
  await tx3.wait();
  console.log('  ✅ BanManager governance set\n');

  // Step 6: Configure LabelManager governance
  console.log('🔧 Configuring LabelManager governance...');
  const tx4 = await labelManager.setGovernance(registryGovernance);
  await tx4.wait();
  console.log('  ✅ LabelManager governance set\n');

  // Step 7: Configure ReportingSystem governance
  console.log('🔧 Configuring ReportingSystem governance...');
  const tx5 = await reportingSystem.setGovernance(registryGovernance);
  await tx5.wait();
  console.log('  ✅ ReportingSystem governance set\n');

  // Prepare deployment manifest
  const deployment: ModerationDeployment = {
    network: network.name,
    chainId: Number(network.chainId),
    deployedAt: Date.now(),
    deployer: signer.address,
    contracts: {
      BanManager: banManagerAddress,
      ReputationLabelManager: labelManagerAddress,
      ReportingSystem: reportingSystemAddress,
      Predimarket: predimarket,
      RegistryGovernance: registryGovernance,
      IdentityRegistry: identityRegistry,
    },
    config: {
      reportBonds: {
        LOW: '0.001',
        MEDIUM: '0.01',
        HIGH: '0.05',
        CRITICAL: '0.1',
      },
      votingPeriods: {
        LOW: 7 * 24 * 3600, // 7 days
        MEDIUM: 3 * 24 * 3600, // 3 days
        HIGH: 24 * 3600, // 1 day
        CRITICAL: 24 * 3600, // 1 day
      },
      stakeRequirements: {
        HACKER: '0.1',
        SCAMMER: '0.05',
        SPAM_BOT: '0.01',
        TRUSTED: '0.5',
      },
    },
  };

  // Save deployment manifest
  const deploymentsDir = join(process.cwd(), 'contracts', 'deployments');
  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }

  const networkName = network.name === 'unknown' ? 'localnet' : network.name;
  const deploymentFile = join(deploymentsDir, `moderation-${networkName}.json`);

  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));
  console.log(`💾 Deployment manifest saved: ${deploymentFile}\n`);

  // Generate config files for frontends
  console.log('📦 Generating frontend configs...\n');

  // Gateway config
  const gatewayConfig = `// Auto-generated by deploy-moderation-system.ts
// DO NOT EDIT MANUALLY

export const MODERATION_CONTRACTS = {
  BanManager: '${banManagerAddress}',
  ReputationLabelManager: '${labelManagerAddress}',
  ReportingSystem: '${reportingSystemAddress}',
  Predimarket: '${predimarket}',
  RegistryGovernance: '${registryGovernance}',
  IdentityRegistry: '${identityRegistry}',
} as const;

export const MODERATION_CONFIG = {
  reportBonds: {
    LOW: '0.001',
    MEDIUM: '0.01',
    HIGH: '0.05',
    CRITICAL: '0.1',
  },
  votingPeriods: {
    LOW: 7 * 24 * 3600,
    MEDIUM: 3 * 24 * 3600,
    HIGH: 24 * 3600,
    CRITICAL: 24 * 3600,
  },
} as const;
`;

  const gatewayConfigPath = join(process.cwd(), 'apps', 'gateway', 'src', 'config', 'moderation.ts');
  writeFileSync(gatewayConfigPath, gatewayConfig);
  console.log(`✅ Gateway config: ${gatewayConfigPath}`);

  // Bazaar config
  const bazaarConfigPath = join(process.cwd(), 'apps', 'bazaar', 'lib', 'moderation-contracts.ts');
  writeFileSync(bazaarConfigPath, gatewayConfig);
  console.log(`✅ Bazaar config: ${bazaarConfigPath}`);

  // Hyperscape config
  const hyperscapeConfig = `// Auto-generated by deploy-moderation-system.ts
export const MODERATION_CONTRACTS = {
  BanManager: '${banManagerAddress}',
  ReputationLabelManager: '${labelManagerAddress}',
  IdentityRegistry: '${identityRegistry}',
};
`;
  const hyperscapeConfigPath = join(
    process.cwd(),
    'vendor',
    'hyperscape',
    'packages',
    'server',
    'src',
    'blockchain',
    'moderation-config.ts'
  );
  writeFileSync(hyperscapeConfigPath, hyperscapeConfig);
  console.log(`✅ Hyperscape config: ${hyperscapeConfigPath}\n`);

  // Summary
  console.log('🎉 Moderation System Deployment Complete!\n');
  console.log('📋 Summary:');
  console.log(`  BanManager: ${banManagerAddress}`);
  console.log(`  ReputationLabelManager: ${labelManagerAddress}`);
  console.log(`  ReportingSystem: ${reportingSystemAddress}`);
  console.log(`  Predimarket (updated): ${predimarket}`);
  console.log(`\n🔗 Integration Status:`);
  console.log(`  ✅ Predimarket authorized creators configured`);
  console.log(`  ✅ Governance contracts linked`);
  console.log(`  ✅ Frontend configs generated`);
  console.log(`\n📝 Next Steps:`);
  console.log(`  1. Initialize NetworkBanCache with BanManager events`);
  console.log(`  2. Build Gateway moderation UI`);
  console.log(`  3. Integrate ban checks in all apps`);
  console.log(`  4. Write comprehensive tests`);
  console.log(`\n  Run: bun run test:contracts:moderation`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });

