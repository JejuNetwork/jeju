#!/usr/bin/env bun
/**
 * Deploy Stage 2 L1 Contracts
 * 
 * Deploys all Stage 2 contracts to L1:
 * - SequencerRegistry
 * - GovernanceTimelock
 * - DisputeGameFactory
 * 
 * Prerequisites:
 * - L1 RPC running (geth-l1 on port 8545)
 * - Deployer wallet funded
 * - JEJU token deployed
 * - IdentityRegistry and ReputationRegistry deployed
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments');
const CONTRACTS_DIR = join(ROOT, 'packages/contracts');

interface DeploymentResult {
  sequencerRegistry: string;
  governanceTimelock: string;
  disputeGameFactory: string;
  deployedAt: string;
  network: string;
}

async function main() {
  console.log('🚀 Deploying Stage 2 L1 Contracts');
  console.log('='.repeat(70));
  console.log('');

  const rpcUrl = process.env.L1_RPC_URL || 'http://127.0.0.1:8545';
  const deployerKey = process.env.PRIVATE_KEY;
  if (!deployerKey) {
    console.error('❌ PRIVATE_KEY environment variable required');
    process.exit(1);
  }
  const network = process.env.NETWORK || 'localnet';
  const treasury = process.env.TREASURY_ADDRESS || process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  const config = {
    jejuToken: process.env.JEJU_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000',
    identityRegistry: process.env.IDENTITY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
    reputationRegistry: process.env.REPUTATION_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000',
    treasury,
    governance: process.env.GOVERNANCE_ADDRESS || treasury,
    securityCouncil: process.env.SECURITY_COUNCIL_ADDRESS || treasury,
    timelockDelay: network === 'localnet' ? 60 : 30 * 24 * 60 * 60
  };

  console.log(`Network: ${network} | RPC: ${rpcUrl} | Delay: ${config.timelockDelay}s\n`);

  try {
    const blockNumber = execSync(`cast block-number --rpc-url ${rpcUrl}`, { encoding: 'utf-8' }).trim();
    console.log(`✅ L1 connected (block ${blockNumber})\n`);
  } catch {
    console.error('❌ Cannot connect to L1 RPC');
    process.exit(1);
  }

  const result: DeploymentResult = {
    sequencerRegistry: '',
    governanceTimelock: '',
    disputeGameFactory: '',
    deployedAt: new Date().toISOString(),
    network
  };

  const contracts = [
    {
      name: 'SequencerRegistry',
      path: 'src/stage2/SequencerRegistry.sol:SequencerRegistry',
      args: [config.jejuToken, config.identityRegistry, config.reputationRegistry, config.treasury, config.governance],
      key: 'sequencerRegistry' as const
    },
    {
      name: 'GovernanceTimelock',
      path: 'src/stage2/GovernanceTimelock.sol:GovernanceTimelock',
      args: [config.governance, config.securityCouncil, config.governance, config.timelockDelay.toString()],
      key: 'governanceTimelock' as const
    },
    {
      name: 'DisputeGameFactory',
      path: 'src/stage2/DisputeGameFactory.sol:DisputeGameFactory',
      args: [config.treasury, config.governance],
      key: 'disputeGameFactory' as const
    }
  ];

  for (const contract of contracts) {
    console.log(`📝 Deploying ${contract.name}...`);
    result[contract.key] = deployContract(contract.path, contract.args, rpcUrl, deployerKey);
    console.log(`  ✅ ${contract.name}: ${result[contract.key]}\n`);
  }

  // Save deployment
  const deploymentFile = join(DEPLOYMENTS_DIR, `stage2-${network}.json`);
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  }
  writeFileSync(deploymentFile, JSON.stringify(result, null, 2));

  console.log('='.repeat(70));
  console.log('✅ Stage 2 L1 Contracts Deployed!');
  console.log('='.repeat(70));
  console.log('');
  console.log('Contract Addresses:');
  console.log(`  SequencerRegistry:  ${result.sequencerRegistry}`);
  console.log(`  GovernanceTimelock: ${result.governanceTimelock}`);
  console.log(`  DisputeGameFactory: ${result.disputeGameFactory}`);
  console.log('');
  console.log(`💾 Saved to: ${deploymentFile}`);
  console.log('');
  console.log('Next Steps:');
  console.log('  1. Register sequencers: cast send <SequencerRegistry> "register(uint256,uint256)" <agentId> <stake>');
  console.log('  2. Create upgrade proposal: cast send <GovernanceTimelock> "proposeUpgrade(...)"');
  console.log('  3. Challenge state root: cast send <DisputeGameFactory> "createGame(...)"');
  console.log('');
}

function deployContract(contractPath: string, constructorArgs: string[], rpcUrl: string, privateKey: string): string {
  const argsStr = constructorArgs.length > 0 ? `--constructor-args ${constructorArgs.join(' ')}` : '';
  const cmd = `cd ${CONTRACTS_DIR} && forge create ${contractPath} --rpc-url ${rpcUrl} --private-key ${privateKey} ${argsStr} --json`;
  
  try {
    const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(output).deployedTo;
  } catch (error) {
    console.error(`Failed to deploy ${contractPath}:`, error);
    throw error;
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error('❌ Deployment failed:', error);
    process.exit(1);
  });
}

export { main as deployStage2L1 };

