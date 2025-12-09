#!/usr/bin/env bun
/**
 * Full Testnet Deployment Script
 * 
 * Orchestrates the complete deployment of Jeju Network testnet:
 * 1. Generate operator keys
 * 2. Update deploy config
 * 3. Deploy L1 contracts on Sepolia
 * 4. Generate L2 genesis
 * 5. Deploy OP Stack services to Kubernetes
 * 6. Deploy application contracts
 * 7. Verify deployment
 * 
 * Usage:
 *   bun run scripts/deploy/testnet-full.ts
 *   bun run scripts/deploy/testnet-full.ts --skip-keys    # Skip key generation
 *   bun run scripts/deploy/testnet-full.ts --skip-l1      # Skip L1 deployment
 *   bun run scripts/deploy/testnet-full.ts --contracts-only # Only deploy contracts
 */

import { $ } from 'bun';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const ROOT = join(import.meta.dir, '../..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments/testnet');
const TERRAFORM_DIR = join(ROOT, 'packages/deployment/terraform/environments/testnet');

interface DeploymentStatus {
  step: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped';
  message?: string;
}

const steps: DeploymentStatus[] = [
  { step: 'Check Prerequisites', status: 'pending' },
  { step: 'Generate Operator Keys', status: 'pending' },
  { step: 'Update Deploy Config', status: 'pending' },
  { step: 'Check Wallet Funding', status: 'pending' },
  { step: 'Deploy L1 Contracts', status: 'pending' },
  { step: 'Generate L2 Genesis', status: 'pending' },
  { step: 'Deploy OP Stack to K8s', status: 'pending' },
  { step: 'Wait for Chain Sync', status: 'pending' },
  { step: 'Deploy EIL Contracts', status: 'pending' },
  { step: 'Deploy OIF Contracts', status: 'pending' },
  { step: 'Deploy Bundler', status: 'pending' },
  { step: 'Verify Deployment', status: 'pending' },
];

function printStatus() {
  console.clear();
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Full Testnet Deployment                              ║
╚══════════════════════════════════════════════════════════════════════╝
`);
  
  for (const step of steps) {
    let icon = '⏳';
    if (step.status === 'running') icon = '🔄';
    if (step.status === 'success') icon = '✅';
    if (step.status === 'failed') icon = '❌';
    if (step.status === 'skipped') icon = '⏭️';
    
    console.log(`${icon} ${step.step}${step.message ? ` - ${step.message}` : ''}`);
  }
  console.log('');
}

function updateStep(index: number, status: DeploymentStatus['status'], message?: string) {
  steps[index].status = status;
  if (message) steps[index].message = message;
  printStatus();
}

async function runStep(index: number, fn: () => Promise<void>) {
  updateStep(index, 'running');
  try {
    await fn();
    updateStep(index, 'success');
  } catch (err) {
    updateStep(index, 'failed', (err as Error).message);
    throw err;
  }
}

async function checkPrerequisites() {
  // Check AWS credentials
  const awsCheck = await $`aws sts get-caller-identity`.quiet().nothrow();
  if (awsCheck.exitCode !== 0) {
    throw new Error('AWS credentials not configured');
  }

  // Check kubectl
  const kubectlCheck = await $`kubectl cluster-info`.quiet().nothrow();
  if (kubectlCheck.exitCode !== 0) {
    throw new Error('kubectl not configured or cluster not accessible');
  }

  // Check terraform state
  if (!existsSync(TERRAFORM_DIR)) {
    throw new Error('Terraform directory not found');
  }
}

async function generateOperatorKeys() {
  const keysFile = join(KEYS_DIR, 'testnet-operators.json');
  if (existsSync(keysFile)) {
    steps[1].message = 'Keys already exist';
    return;
  }

  await $`bun run ${join(ROOT, 'scripts/deploy/generate-operator-keys.ts')}`;
}

async function updateDeployConfig() {
  await $`bun run ${join(ROOT, 'scripts/deploy/update-deploy-config.ts')} testnet`;
}

async function checkWalletFunding() {
  const keysFile = join(KEYS_DIR, 'testnet-operators.json');
  if (!existsSync(keysFile)) {
    throw new Error('Operator keys not found');
  }

  const keys = JSON.parse(readFileSync(keysFile, 'utf-8'));
  const adminKey = keys.find((k: {name: string}) => k.name === 'admin');
  const batcherKey = keys.find((k: {name: string}) => k.name === 'batcher');
  const proposerKey = keys.find((k: {name: string}) => k.name === 'proposer');

  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');

  const adminBalance = await provider.getBalance(adminKey.address);
  const batcherBalance = await provider.getBalance(batcherKey.address);
  const proposerBalance = await provider.getBalance(proposerKey.address);

  const minAdminBalance = ethers.parseEther('0.3');
  const minOperatorBalance = ethers.parseEther('0.05');

  const issues: string[] = [];

  if (adminBalance < minAdminBalance) {
    issues.push(`Admin needs ${ethers.formatEther(minAdminBalance - adminBalance)} more ETH`);
  }
  if (batcherBalance < minOperatorBalance) {
    issues.push(`Batcher needs ${ethers.formatEther(minOperatorBalance - batcherBalance)} more ETH`);
  }
  if (proposerBalance < minOperatorBalance) {
    issues.push(`Proposer needs ${ethers.formatEther(minOperatorBalance - proposerBalance)} more ETH`);
  }

  if (issues.length > 0) {
    throw new Error(`Insufficient funds:\n${issues.join('\n')}\n\nFund these addresses on Sepolia and retry.`);
  }

  steps[3].message = `Admin: ${ethers.formatEther(adminBalance)} ETH`;
}

async function deployL1Contracts() {
  const l1DeploymentFile = join(DEPLOYMENTS_DIR, 'l1-deployment.json');
  if (existsSync(l1DeploymentFile)) {
    steps[4].message = 'Already deployed';
    return;
  }

  await $`bun run ${join(ROOT, 'scripts/deploy/deploy-l1-contracts.ts')}`;
}

async function generateL2Genesis() {
  const genesisFile = join(DEPLOYMENTS_DIR, 'genesis.json');
  if (existsSync(genesisFile)) {
    steps[5].message = 'Genesis exists';
    return;
  }

  await $`NETWORK=testnet bun run ${join(ROOT, 'packages/deployment/scripts/l2-genesis.ts')}`;
}

async function deployOpStack() {
  // Deploy core OP Stack services via Helmfile
  await $`NETWORK=testnet bun run ${join(ROOT, 'packages/deployment/scripts/helmfile.ts')} sync reth op-node op-batcher op-proposer`;
}

async function waitForChainSync() {
  const maxAttempts = 60;
  const delayMs = 10000;

  for (let i = 0; i < maxAttempts; i++) {
    steps[7].message = `Attempt ${i + 1}/${maxAttempts}`;
    printStatus();

    try {
      const response = await fetch('https://testnet-rpc.jeju.network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      });

      const data = await response.json() as { result?: string };
      if (data.result) {
        const blockNumber = parseInt(data.result, 16);
        if (blockNumber > 0) {
          steps[7].message = `Block ${blockNumber}`;
          return;
        }
      }
    } catch {
      // Chain not ready yet
    }

    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  throw new Error('Chain did not sync within timeout');
}

async function deployEILContracts() {
  await $`bun run ${join(ROOT, 'scripts/deploy/eil.ts')} testnet`;
}

async function deployOIFContracts() {
  await $`bun run ${join(ROOT, 'scripts/deploy/oif-multichain.ts')} --all`;
}

async function deployBundler() {
  await $`NETWORK=testnet bun run ${join(ROOT, 'packages/deployment/scripts/helmfile.ts')} sync bundler`;
}

async function verifyDeployment() {
  // Verify RPC
  const rpcResponse = await fetch('https://testnet-rpc.jeju.network', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    }),
  });

  const rpcData = await rpcResponse.json() as { result?: string };
  if (!rpcData.result || parseInt(rpcData.result, 16) !== 420690) {
    throw new Error('RPC not returning correct chain ID');
  }

  steps[11].message = 'All checks passed';
}

async function main() {
  const args = process.argv.slice(2);
  const skipKeys = args.includes('--skip-keys');
  const skipL1 = args.includes('--skip-l1');
  const contractsOnly = args.includes('--contracts-only');

  printStatus();

  try {
    // Step 0: Check Prerequisites
    await runStep(0, checkPrerequisites);

    if (!contractsOnly) {
      // Step 1: Generate Operator Keys
      if (skipKeys) {
        updateStep(1, 'skipped', 'Skipped by flag');
      } else {
        await runStep(1, generateOperatorKeys);
      }

      // Step 2: Update Deploy Config
      await runStep(2, updateDeployConfig);

      // Step 3: Check Wallet Funding
      await runStep(3, checkWalletFunding);

      // Step 4: Deploy L1 Contracts
      if (skipL1) {
        updateStep(4, 'skipped', 'Skipped by flag');
      } else {
        await runStep(4, deployL1Contracts);
      }

      // Step 5: Generate L2 Genesis
      await runStep(5, generateL2Genesis);

      // Step 6: Deploy OP Stack to K8s
      await runStep(6, deployOpStack);

      // Step 7: Wait for Chain Sync
      await runStep(7, waitForChainSync);
    } else {
      // Skip infrastructure steps
      for (let i = 1; i <= 7; i++) {
        updateStep(i, 'skipped', 'Contracts only mode');
      }
    }

    // Step 8: Deploy EIL Contracts
    await runStep(8, deployEILContracts);

    // Step 9: Deploy OIF Contracts
    await runStep(9, deployOIFContracts);

    // Step 10: Deploy Bundler
    if (!contractsOnly) {
      await runStep(10, deployBundler);
    } else {
      updateStep(10, 'skipped', 'Contracts only mode');
    }

    // Step 11: Verify Deployment
    await runStep(11, verifyDeployment);

    console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  ✅ TESTNET DEPLOYMENT COMPLETE                                       ║
╚══════════════════════════════════════════════════════════════════════╝

Testnet URLs:
  RPC: https://testnet-rpc.jeju.network
  WS:  wss://testnet-ws.jeju.network
  Explorer: https://testnet-explorer.jeju.network

Chain ID: 420690

Next Steps:
  1. Update nameservers for jeju.network to AWS Route53
  2. Enable HTTPS: terraform apply -var="enable_https=true" -var="enable_cdn=true"
  3. Test cross-chain transfers
`);
  } catch (err) {
    console.error(`\n❌ Deployment failed at step: ${steps.find(s => s.status === 'failed')?.step}`);
    console.error(`   Error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();


