#!/usr/bin/env bun
/**
 * Comprehensive Testnet Readiness Check
 * 
 * Validates all components needed for testnet deployment:
 * - AWS Infrastructure
 * - Kubernetes Cluster  
 * - Operator Keys
 * - Deploy Configuration
 * - Contract Deployments
 * - Service Status
 * 
 * Usage:
 *   bun run scripts/check-testnet-readiness.ts
 */

import { $ } from 'bun';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

const ROOT = process.cwd();
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');
const CONFIG_DIR = join(ROOT, 'packages/contracts/deploy-config');
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments/testnet');
const CHAIN_CONFIG = join(ROOT, 'packages/config/chain/testnet.json');

interface CheckResult {
  category: string;
  item: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
}

const results: CheckResult[] = [];

function addResult(category: string, item: string, status: CheckResult['status'], message: string) {
  results.push({ category, item, status, message });
}

async function checkAWSInfra() {
  const category = 'AWS Infrastructure';
  
  // Check AWS CLI configured
  const awsCheck = await $`aws sts get-caller-identity`.quiet().nothrow();
  if (awsCheck.exitCode !== 0) {
    addResult(category, 'AWS CLI', 'fail', 'Not configured or no credentials');
    return;
  }
  
  const identity = JSON.parse(awsCheck.stdout.toString());
  addResult(category, 'AWS CLI', 'pass', `Account: ${identity.Account}`);
  
  // Check EKS cluster
  const eksCheck = await $`aws eks describe-cluster --name jeju-testnet --region us-east-1`.quiet().nothrow();
  if (eksCheck.exitCode === 0) {
    const cluster = JSON.parse(eksCheck.stdout.toString());
    addResult(category, 'EKS Cluster', 'pass', `Status: ${cluster.cluster.status}`);
  } else {
    addResult(category, 'EKS Cluster', 'fail', 'Cluster not found');
  }
  
  // Check RDS
  const rdsCheck = await $`aws rds describe-db-instances --db-instance-identifier jeju-testnet-postgres --region us-east-1`.quiet().nothrow();
  if (rdsCheck.exitCode === 0) {
    const db = JSON.parse(rdsCheck.stdout.toString());
    const status = db.DBInstances[0]?.DBInstanceStatus || 'unknown';
    addResult(category, 'RDS Database', status === 'available' ? 'pass' : 'warn', `Status: ${status}`);
  } else {
    addResult(category, 'RDS Database', 'fail', 'Database not found');
  }
  
  // Check ECR repositories
  const ecrCheck = await $`aws ecr describe-repositories --repository-names jeju/gateway --region us-east-1`.quiet().nothrow();
  if (ecrCheck.exitCode === 0) {
    addResult(category, 'ECR Repositories', 'pass', 'Repositories exist');
  } else {
    addResult(category, 'ECR Repositories', 'fail', 'Repositories not found');
  }
  
  // Check Route53
  const r53Check = await $`aws route53 list-hosted-zones-by-name --dns-name jeju.network`.quiet().nothrow();
  if (r53Check.exitCode === 0) {
    const zones = JSON.parse(r53Check.stdout.toString());
    if (zones.HostedZones.length > 0) {
      addResult(category, 'Route53 Zone', 'pass', `Zone ID: ${zones.HostedZones[0].Id}`);
    } else {
      addResult(category, 'Route53 Zone', 'fail', 'Zone not found');
    }
  }
  
  // Check ACM certificate
  const acmCheck = await $`aws acm list-certificates --region us-east-1`.quiet().nothrow();
  if (acmCheck.exitCode === 0) {
    const certs = JSON.parse(acmCheck.stdout.toString());
    const jejuCert = certs.CertificateSummaryList.find((c: {DomainName: string}) => c.DomainName === 'jeju.network');
    if (jejuCert) {
      addResult(category, 'ACM Certificate', jejuCert.Status === 'ISSUED' ? 'pass' : 'warn', `Status: ${jejuCert.Status}`);
    } else {
      addResult(category, 'ACM Certificate', 'fail', 'Certificate not found');
    }
  }
}

async function checkKubernetes() {
  const category = 'Kubernetes';
  
  const kubectlCheck = await $`kubectl cluster-info`.quiet().nothrow();
  if (kubectlCheck.exitCode !== 0) {
    addResult(category, 'kubectl', 'fail', 'Not configured or cluster not accessible');
    return;
  }
  addResult(category, 'kubectl', 'pass', 'Connected to cluster');
  
  // Check nodes
  const nodesCheck = await $`kubectl get nodes -o json`.quiet().nothrow();
  if (nodesCheck.exitCode === 0) {
    const nodes = JSON.parse(nodesCheck.stdout.toString());
    const readyNodes = nodes.items.filter((n: {status: {conditions: Array<{type: string, status: string}>}}) => 
      n.status.conditions.some((c: {type: string, status: string}) => c.type === 'Ready' && c.status === 'True')
    ).length;
    addResult(category, 'Nodes', readyNodes > 0 ? 'pass' : 'fail', `${readyNodes}/${nodes.items.length} ready`);
  }
  
  // Check namespaces
  const nsCheck = await $`kubectl get namespaces -o json`.quiet().nothrow();
  if (nsCheck.exitCode === 0) {
    const ns = JSON.parse(nsCheck.stdout.toString());
    const opStack = ns.items.some((n: {metadata: {name: string}}) => n.metadata.name === 'op-stack');
    addResult(category, 'op-stack namespace', opStack ? 'pass' : 'warn', opStack ? 'Exists' : 'Not created yet');
  }
  
  // Check for running pods in op-stack
  const podsCheck = await $`kubectl get pods -n op-stack -o json`.quiet().nothrow();
  if (podsCheck.exitCode === 0) {
    const pods = JSON.parse(podsCheck.stdout.toString());
    if (pods.items.length > 0) {
      const running = pods.items.filter((p: {status: {phase: string}}) => p.status.phase === 'Running').length;
      addResult(category, 'OP Stack Pods', running === pods.items.length ? 'pass' : 'warn', `${running}/${pods.items.length} running`);
    } else {
      addResult(category, 'OP Stack Pods', 'warn', 'No pods deployed yet');
    }
  }
}

async function checkOperatorKeys() {
  const category = 'Operator Keys';
  
  const keysFile = join(KEYS_DIR, 'testnet-operators.json');
  if (!existsSync(keysFile)) {
    addResult(category, 'Keys File', 'fail', 'Not generated');
    addResult(category, 'Fix', 'skip', 'Run: bun run scripts/deploy/generate-operator-keys.ts');
    return;
  }
  
  const keys = JSON.parse(readFileSync(keysFile, 'utf-8'));
  addResult(category, 'Keys File', 'pass', `${keys.length} keys generated`);
  
  // Check funding on Sepolia
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  
  for (const key of keys) {
    if (['admin', 'batcher', 'proposer'].includes(key.name)) {
      try {
        const balance = await provider.getBalance(key.address);
        const ethBalance = parseFloat(ethers.formatEther(balance));
        const minBalance = key.name === 'admin' ? 0.3 : 0.05;
        
        if (ethBalance >= minBalance) {
          addResult(category, `${key.name} funded`, 'pass', `${ethBalance.toFixed(4)} ETH`);
        } else {
          addResult(category, `${key.name} funded`, 'fail', `${ethBalance.toFixed(4)} ETH (need ${minBalance})`);
        }
      } catch {
        addResult(category, `${key.name} funded`, 'warn', 'Could not check balance');
      }
    }
  }
}

async function checkDeployConfig() {
  const category = 'Deploy Config';
  
  const configFile = join(CONFIG_DIR, 'testnet.json');
  if (!existsSync(configFile)) {
    addResult(category, 'Config File', 'fail', 'Not found');
    return;
  }
  
  const config = JSON.parse(readFileSync(configFile, 'utf-8'));
  addResult(category, 'Config File', 'pass', 'Exists');
  
  // Check for zero addresses
  const zeroAddr = '0x0000000000000000000000000000000000000000';
  const criticalFields = [
    'p2pSequencerAddress',
    'batchSenderAddress',
    'l2OutputOracleProposer',
    'proxyAdminOwner',
  ];
  
  const hasZeros = criticalFields.some(f => config[f] === zeroAddr);
  if (hasZeros) {
    addResult(category, 'Operator Addresses', 'fail', 'Contains zero addresses');
    addResult(category, 'Fix', 'skip', 'Run: bun run scripts/deploy/update-deploy-config.ts');
  } else {
    addResult(category, 'Operator Addresses', 'pass', 'All addresses set');
  }
}

async function checkL1Contracts() {
  const category = 'L1 Contracts';
  
  // First check if L1 deployment file exists
  const l1DeployFile = join(DEPLOYMENTS_DIR, 'l1-deployment.json');
  if (!existsSync(l1DeployFile)) {
    // Fall back to checking chain config
    if (existsSync(CHAIN_CONFIG)) {
      const chainConfig = JSON.parse(readFileSync(CHAIN_CONFIG, 'utf-8'));
      const l1Contracts = chainConfig.contracts?.l1 || {};
      
      const requiredContracts = ['OptimismPortal', 'L2OutputOracle', 'L1CrossDomainMessenger', 'L1StandardBridge', 'SystemConfig'];
      const missingOrEmpty = requiredContracts.filter(c => !l1Contracts[c] || l1Contracts[c] === '');
      
      if (missingOrEmpty.length > 0) {
        addResult(category, 'L1 Contracts', 'fail', `Missing: ${missingOrEmpty.join(', ')}`);
        addResult(category, 'Fix', 'skip', 'Deploy L1 contracts first');
        return;
      }
    } else {
      addResult(category, 'L1 Deployment', 'fail', 'Not deployed');
      addResult(category, 'Fix', 'skip', 'Run: bun run scripts/deploy/deploy-l1-contracts.ts');
      return;
    }
  }
  
  // If deployment file exists, verify contracts on chain
  const l1Deployment = JSON.parse(readFileSync(l1DeployFile, 'utf-8'));
  const contracts = l1Deployment.contracts || l1Deployment;
  
  const provider = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
  
  let total = 0;
  
  for (const [name, address] of Object.entries(contracts)) {
    if (typeof address === 'string' && address.startsWith('0x') && address.length === 42) {
      total++;
      try {
        const code = await provider.getCode(address);
        if (code !== '0x') {
          addResult(category, name, 'pass', `${(address as string).slice(0, 10)}...`);
        } else {
          addResult(category, name, 'fail', 'No code at address');
        }
      } catch {
        addResult(category, name, 'warn', 'Could not verify');
      }
    }
  }
  
  if (total === 0) {
    addResult(category, 'L1 Contracts', 'fail', 'No contract addresses in deployment file');
  }
}

async function checkL2Genesis() {
  const category = 'L2 Genesis';
  
  const genesisFile = join(DEPLOYMENTS_DIR, 'genesis.json');
  const rollupFile = join(DEPLOYMENTS_DIR, 'rollup.json');
  
  if (!existsSync(genesisFile)) {
    addResult(category, 'genesis.json', 'fail', 'Not generated');
    addResult(category, 'Fix', 'skip', 'Run: NETWORK=testnet bun run packages/deployment/scripts/l2-genesis.ts');
  } else {
    addResult(category, 'genesis.json', 'pass', 'Exists');
  }
  
  if (!existsSync(rollupFile)) {
    addResult(category, 'rollup.json', 'fail', 'Not generated');
  } else {
    addResult(category, 'rollup.json', 'pass', 'Exists');
  }
}

async function checkChainStatus() {
  const category = 'Chain Status';
  
  const config = existsSync(CHAIN_CONFIG) ? JSON.parse(readFileSync(CHAIN_CONFIG, 'utf-8')) : null;
  if (!config) {
    addResult(category, 'Chain Config', 'fail', 'Config not found');
    return;
  }
  
  // Try to connect to testnet RPC
  try {
    const response = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    
    const data = await response.json() as { result?: string; error?: { message: string } };
    if (data.result) {
      const blockNumber = parseInt(data.result, 16);
      addResult(category, 'L2 RPC', 'pass', `Block: ${blockNumber}`);
    } else {
      addResult(category, 'L2 RPC', 'fail', data.error?.message || 'No response');
    }
  } catch {
    addResult(category, 'L2 RPC', 'warn', 'Chain not running yet');
  }
}

async function checkApplicationContracts() {
  const category = 'Application Contracts';
  
  const oifFile = join(ROOT, 'packages/contracts/deployments/oif-testnet.json');
  const eilFile = join(ROOT, 'packages/contracts/deployments/eil-testnet.json');
  
  if (existsSync(oifFile)) {
    const oif = JSON.parse(readFileSync(oifFile, 'utf-8'));
    const deployedChains = Object.values(oif.chains || {}).filter((c: unknown) => (c as {status: string}).status === 'deployed').length;
    addResult(category, 'OIF Contracts', deployedChains > 0 ? 'pass' : 'warn', `${deployedChains} chains deployed`);
  } else {
    addResult(category, 'OIF Contracts', 'warn', 'Not deployed yet');
  }
  
  if (existsSync(eilFile)) {
    const eil = JSON.parse(readFileSync(eilFile, 'utf-8'));
    const hasL1 = eil.l1StakeManager && eil.l1StakeManager !== '';
    addResult(category, 'EIL L1StakeManager', hasL1 ? 'pass' : 'warn', hasL1 ? 'Deployed' : 'Not deployed');
  } else {
    addResult(category, 'EIL Contracts', 'warn', 'Not deployed yet');
  }
}

function printResults() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Testnet Readiness Report                             ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const categories = [...new Set(results.map(r => r.category))];
  
  for (const cat of categories) {
    console.log(`\n═══ ${cat} ═══`);
    const catResults = results.filter(r => r.category === cat);
    
    for (const r of catResults) {
      let icon = '⏳';
      let color = '\x1b[0m';
      
      switch (r.status) {
        case 'pass': icon = '✅'; color = '\x1b[32m'; break;
        case 'fail': icon = '❌'; color = '\x1b[31m'; break;
        case 'warn': icon = '⚠️ '; color = '\x1b[33m'; break;
        case 'skip': icon = '➡️ '; color = '\x1b[90m'; break;
      }
      
      console.log(`${icon} ${r.item.padEnd(25)} ${color}${r.message}\x1b[0m`);
    }
  }
  
  // Summary
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const warned = results.filter(r => r.status === 'warn').length;
  
  console.log(`
═══════════════════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════════════════

  ✅ Passed: ${passed}
  ❌ Failed: ${failed}
  ⚠️  Warnings: ${warned}

`);
  
  if (failed === 0) {
    console.log('🎉 All critical checks passed. Ready for testnet deployment.\n');
  } else {
    console.log('⚠️  Fix the failed items above before deploying to testnet.\n');
    process.exit(1);
  }
}

async function main() {
  console.log('Running testnet readiness checks...\n');
  
  await checkAWSInfra();
  await checkKubernetes();
  await checkOperatorKeys();
  await checkDeployConfig();
  await checkL1Contracts();
  await checkL2Genesis();
  await checkChainStatus();
  await checkApplicationContracts();
  
  printResults();
}

main().catch(err => {
  console.error('Error running checks:', err.message);
  process.exit(1);
});

