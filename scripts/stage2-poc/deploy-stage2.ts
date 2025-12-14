#!/usr/bin/env bun
/**
 * Stage 2 Full Stack Deployment
 * 
 * Deploys and verifies all Stage 2 contracts and services:
 * 1. Mock dependencies (JEJU token, Identity/Reputation registries)
 * 2. Core Stage 2 contracts (SequencerRegistry, GovernanceTimelock, DisputeGameFactory)
 * 3. Prover and adapters
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const ROOT = join(import.meta.dir, '../..');
const CONTRACTS_DIR = join(ROOT, 'packages/contracts');
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments');

interface Stage2Deployment {
  jejuToken: string;
  identityRegistry: string;
  reputationRegistry: string;
  sequencerRegistry: string;
  governanceTimelock: string;
  disputeGameFactory: string;
  prover: string;
  l2OutputOracleAdapter: string;
  optimismPortalAdapter: string;
  deployer: string;
  timestamp: number;
  network: string;
}

async function main() {
  console.log('🚀 Stage 2 Full Stack Deployment');
  console.log('='.repeat(60));
  console.log('');

  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const network = process.env.NETWORK || 'localnet';

  if (!deployerKey) {
    console.error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required');
    process.exit(1);
  }

  console.log(`Network: ${network}`);
  console.log(`RPC: ${rpcUrl}`);
  console.log('');

  // Check L1 connection
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const blockNumber = await provider.getBlockNumber();
  console.log(`✅ L1 connected at block ${blockNumber}`);

  const wallet = new ethers.Wallet(deployerKey, provider);
  const balance = await provider.getBalance(wallet.address);
  console.log(`✅ Deployer: ${wallet.address}`);
  console.log(`   Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error('❌ Deployer has no ETH. Fund the account first.');
    process.exit(1);
  }

  console.log('');

  // Deploy using Forge script
  console.log('📦 Deploying contracts via Forge...');
  console.log('');

  const forgeCmd = `cd ${CONTRACTS_DIR} && DEPLOYER_PRIVATE_KEY=${deployerKey} BASESCAN_API_KEY=dummy ETHERSCAN_API_KEY=dummy forge script script/DeployStage2.s.sol:DeployStage2 --rpc-url ${rpcUrl} --broadcast --legacy 2>&1`;

  try {
    const output = execSync(forgeCmd, { encoding: 'utf-8', maxBuffer: 100 * 1024 * 1024 });
    
    // Parse deployed addresses from output
    const deployment = parseDeploymentOutput(output, wallet.address, network);
    
    if (!deployment.sequencerRegistry) {
      console.error('❌ Failed to parse deployment addresses from output');
      console.log(output);
      process.exit(1);
    }

    // Save deployment
    if (!existsSync(DEPLOYMENTS_DIR)) {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
    }
    const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);
    writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2));

    console.log('');
    console.log('='.repeat(60));
    console.log('✅ Stage 2 Deployment Complete');
    console.log('='.repeat(60));
    console.log('');
    console.log('Contract Addresses:');
    console.log(`  JEJU Token:             ${deployment.jejuToken}`);
    console.log(`  Identity Registry:      ${deployment.identityRegistry}`);
    console.log(`  Reputation Registry:    ${deployment.reputationRegistry}`);
    console.log(`  Sequencer Registry:     ${deployment.sequencerRegistry}`);
    console.log(`  Governance Timelock:    ${deployment.governanceTimelock}`);
    console.log(`  Dispute Game Factory:   ${deployment.disputeGameFactory}`);
    console.log(`  Prover:                 ${deployment.prover}`);
    console.log(`  L2OutputOracleAdapter:  ${deployment.l2OutputOracleAdapter}`);
    console.log(`  OptimismPortalAdapter:  ${deployment.optimismPortalAdapter}`);
    console.log('');
    console.log(`💾 Saved to: ${deploymentFile}`);
    console.log('');

    // Verify deployment
    await verifyDeployment(provider, deployment);

  } catch (error) {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  }
}

function parseDeploymentOutput(output: string, deployer: string, network: string): Stage2Deployment {
  const deployment: Stage2Deployment = {
    jejuToken: '',
    identityRegistry: '',
    reputationRegistry: '',
    sequencerRegistry: '',
    governanceTimelock: '',
    disputeGameFactory: '',
    prover: '',
    l2OutputOracleAdapter: '',
    optimismPortalAdapter: '',
    deployer,
    timestamp: Date.now(),
    network
  };

  // Parse addresses from Forge output
  const patterns: [keyof Stage2Deployment, RegExp][] = [
    ['jejuToken', /MockJEJUToken deployed: (0x[a-fA-F0-9]{40})/],
    ['identityRegistry', /IdentityRegistry deployed: (0x[a-fA-F0-9]{40})/],
    ['reputationRegistry', /ReputationRegistry deployed: (0x[a-fA-F0-9]{40})/],
    ['sequencerRegistry', /SequencerRegistry deployed: (0x[a-fA-F0-9]{40})/],
    ['governanceTimelock', /GovernanceTimelock deployed: (0x[a-fA-F0-9]{40})/],
    ['disputeGameFactory', /DisputeGameFactory deployed: (0x[a-fA-F0-9]{40})/],
    ['prover', /Prover deployed: (0x[a-fA-F0-9]{40})/],
    ['l2OutputOracleAdapter', /L2OutputOracleAdapter deployed: (0x[a-fA-F0-9]{40})/],
    ['optimismPortalAdapter', /OptimismPortalAdapter deployed: (0x[a-fA-F0-9]{40})/],
  ];

  for (const [key, pattern] of patterns) {
    const match = output.match(pattern);
    if (match) {
      (deployment as Record<string, string | number>)[key] = match[1];
    }
  }

  return deployment;
}

async function verifyDeployment(provider: ethers.Provider, deployment: Stage2Deployment): Promise<void> {
  console.log('🔍 Verifying deployment...');
  console.log('');

  // Verify DisputeGameFactory
  const factoryCode = await provider.getCode(deployment.disputeGameFactory);
  if (factoryCode === '0x') {
    console.error('❌ DisputeGameFactory has no code');
    process.exit(1);
  }

  const factory = new ethers.Contract(
    deployment.disputeGameFactory,
    ['function MIN_BOND() view returns (uint256)', 'function proverEnabled(uint8) view returns (bool)'],
    provider
  );

  const minBond = await factory.MIN_BOND();
  const proverEnabled = await factory.proverEnabled(0);
  
  console.log(`✅ DisputeGameFactory verified`);
  console.log(`   MIN_BOND: ${ethers.formatEther(minBond)} ETH`);
  console.log(`   Prover enabled: ${proverEnabled}`);

  // Verify Prover
  const prover = new ethers.Contract(
    deployment.prover,
    ['function proverType() view returns (string)'],
    provider
  );
  const proverType = await prover.proverType();
  console.log(`✅ Prover verified: ${proverType}`);

  // Verify SequencerRegistry
  const registry = new ethers.Contract(
    deployment.sequencerRegistry,
    ['function MIN_STAKE() view returns (uint256)'],
    provider
  );
  const minStake = await registry.MIN_STAKE();
  console.log(`✅ SequencerRegistry verified`);
  console.log(`   MIN_STAKE: ${ethers.formatEther(minStake)} JEJU`);

  // Verify GovernanceTimelock
  const timelock = new ethers.Contract(
    deployment.governanceTimelock,
    ['function timelockDelay() view returns (uint256)'],
    provider
  );
  const delay = await timelock.timelockDelay();
  console.log(`✅ GovernanceTimelock verified`);
  console.log(`   Delay: ${Number(delay) / 86400} days`);

  console.log('');
  console.log('✅ All contracts verified');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
