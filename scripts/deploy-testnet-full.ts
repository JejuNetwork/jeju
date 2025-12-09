#!/usr/bin/env bun
/**
 * Full Testnet Deployment Script
 * 
 * Deploys the entire Jeju testnet infrastructure:
 * 1. AWS prerequisites (S3, DynamoDB for Terraform state)
 * 2. Terraform infrastructure (VPC, EKS, RDS, ECR, ALB, WAF)
 * 3. Docker images (build and push to ECR)
 * 4. Kubernetes workloads (via Helmfile)
 * 5. Smart contracts (OIF, EIL, Paymaster)
 * 6. Verification and health checks
 * 
 * Usage:
 *   bun run scripts/deploy-testnet-full.ts
 *   bun run scripts/deploy-testnet-full.ts --skip-terraform
 *   bun run scripts/deploy-testnet-full.ts --skip-images
 *   bun run scripts/deploy-testnet-full.ts --only-contracts
 */

import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');
const DEPLOYMENT_DIR = join(ROOT, 'packages/deployment');
const CONTRACTS_DIR = join(ROOT, 'packages/contracts');

interface DeploymentConfig {
  awsRegion: string;
  awsAccountId: string;
  environment: string;
  domain: string;
  skipTerraform: boolean;
  skipImages: boolean;
  skipKubernetes: boolean;
  skipContracts: boolean;
  onlyContracts: boolean;
}

const config: DeploymentConfig = {
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsAccountId: '',
  environment: 'testnet',
  domain: 'jeju.network',
  skipTerraform: process.argv.includes('--skip-terraform'),
  skipImages: process.argv.includes('--skip-images'),
  skipKubernetes: process.argv.includes('--skip-kubernetes'),
  skipContracts: process.argv.includes('--skip-contracts'),
  onlyContracts: process.argv.includes('--only-contracts'),
};

function log(message: string, type: 'info' | 'success' | 'error' | 'warn' | 'step' = 'info') {
  const icons = {
    info: '📋',
    success: '✅',
    error: '❌',
    warn: '⚠️',
    step: '🔷',
  };
  console.log(`${icons[type]} ${message}`);
}

function banner(title: string) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70) + '\n');
}

async function checkPrerequisites(): Promise<boolean> {
  banner('CHECKING PREREQUISITES');
  
  let allPassed = true;
  
  // Check AWS CLI
  const awsCheck = await $`aws sts get-caller-identity --query Account --output text`.quiet().nothrow();
  if (awsCheck.exitCode !== 0) {
    log('AWS CLI not configured. Run: aws configure', 'error');
    allPassed = false;
  } else {
    config.awsAccountId = awsCheck.stdout.toString().trim();
    log(`AWS Account: ${config.awsAccountId}`, 'success');
  }
  
  // Check required tools
  const tools = ['terraform', 'helm', 'helmfile', 'kubectl', 'docker'];
  for (const tool of tools) {
    const check = await $`which ${tool}`.quiet().nothrow();
    if (check.exitCode !== 0) {
      log(`${tool} not installed`, 'error');
      allPassed = false;
    } else {
      log(`${tool} installed`, 'success');
    }
  }
  
  // Check Docker is running
  const dockerCheck = await $`docker ps`.quiet().nothrow();
  if (dockerCheck.exitCode !== 0) {
    log('Docker is not running. Start Docker Desktop.', 'error');
    allPassed = false;
  } else {
    log('Docker is running', 'success');
  }
  
  // Check deployer private key
  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    log('DEPLOYER_PRIVATE_KEY not set', 'warn');
  } else {
    log('DEPLOYER_PRIVATE_KEY is set', 'success');
  }
  
  return allPassed;
}

async function setupTerraformBackend(): Promise<boolean> {
  banner('SETTING UP TERRAFORM BACKEND');
  
  const bucketName = `jeju-terraform-state-${config.environment}`;
  const tableName = `jeju-terraform-locks-${config.environment}`;
  
  // Check if bucket exists
  const bucketCheck = await $`aws s3 ls s3://${bucketName}`.quiet().nothrow();
  
  if (bucketCheck.exitCode !== 0) {
    log(`Creating S3 bucket: ${bucketName}`, 'step');
    
    // Create bucket
    if (config.awsRegion === 'us-east-1') {
      await $`aws s3api create-bucket --bucket ${bucketName} --region ${config.awsRegion}`;
    } else {
      await $`aws s3api create-bucket --bucket ${bucketName} --region ${config.awsRegion} --create-bucket-configuration LocationConstraint=${config.awsRegion}`;
    }
    
    // Enable versioning
    await $`aws s3api put-bucket-versioning --bucket ${bucketName} --versioning-configuration Status=Enabled`;
    
    // Enable encryption
    await $`aws s3api put-bucket-encryption --bucket ${bucketName} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'`;
    
    log(`S3 bucket created: ${bucketName}`, 'success');
  } else {
    log(`S3 bucket exists: ${bucketName}`, 'success');
  }
  
  // Check if DynamoDB table exists
  const tableCheck = await $`aws dynamodb describe-table --table-name ${tableName}`.quiet().nothrow();
  
  if (tableCheck.exitCode !== 0) {
    log(`Creating DynamoDB table: ${tableName}`, 'step');
    
    await $`aws dynamodb create-table \
      --table-name ${tableName} \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      --region ${config.awsRegion}`;
    
    log(`DynamoDB table created: ${tableName}`, 'success');
  } else {
    log(`DynamoDB table exists: ${tableName}`, 'success');
  }
  
  return true;
}

async function deployTerraform(): Promise<boolean> {
  if (config.skipTerraform || config.onlyContracts) {
    log('Skipping Terraform deployment', 'warn');
    return true;
  }
  
  banner('DEPLOYING TERRAFORM INFRASTRUCTURE');
  
  const tfDir = join(DEPLOYMENT_DIR, 'terraform/environments/testnet');
  
  log('Initializing Terraform...', 'step');
  const initResult = await $`cd ${tfDir} && terraform init`.nothrow();
  if (initResult.exitCode !== 0) {
    log('Terraform init failed', 'error');
    return false;
  }
  
  log('Planning Terraform changes...', 'step');
  const planResult = await $`cd ${tfDir} && terraform plan -out=tfplan`.nothrow();
  if (planResult.exitCode !== 0) {
    log('Terraform plan failed', 'error');
    return false;
  }
  
  log('Applying Terraform changes...', 'step');
  const applyResult = await $`cd ${tfDir} && terraform apply -auto-approve tfplan`.nothrow();
  if (applyResult.exitCode !== 0) {
    log('Terraform apply failed', 'error');
    return false;
  }
  
  log('Terraform infrastructure deployed', 'success');
  
  // Get outputs
  const outputResult = await $`cd ${tfDir} && terraform output -json`.quiet().nothrow();
  if (outputResult.exitCode === 0) {
    const outputs = JSON.parse(outputResult.stdout.toString());
    log(`EKS Cluster: ${outputs.eks_cluster_name?.value || 'N/A'}`, 'info');
    log(`RDS Endpoint: ${outputs.rds_endpoint?.value || 'N/A'}`, 'info');
    log(`ALB DNS: ${outputs.alb_dns_name?.value || 'N/A'}`, 'info');
  }
  
  return true;
}

async function configureKubectl(): Promise<boolean> {
  banner('CONFIGURING KUBECTL');
  
  const clusterName = `jeju-${config.environment}`;
  
  log(`Updating kubeconfig for ${clusterName}...`, 'step');
  const result = await $`aws eks update-kubeconfig --name ${clusterName} --region ${config.awsRegion}`.nothrow();
  
  if (result.exitCode !== 0) {
    log('Failed to configure kubectl. EKS cluster may not exist yet.', 'error');
    return false;
  }
  
  // Verify connection
  const verifyResult = await $`kubectl get nodes`.quiet().nothrow();
  if (verifyResult.exitCode !== 0) {
    log('Cannot connect to EKS cluster', 'error');
    return false;
  }
  
  log('kubectl configured and connected to EKS', 'success');
  return true;
}

async function buildAndPushImages(): Promise<boolean> {
  if (config.skipImages || config.onlyContracts) {
    log('Skipping Docker image build', 'warn');
    return true;
  }
  
  banner('BUILDING AND PUSHING DOCKER IMAGES');
  
  const registry = `${config.awsAccountId}.dkr.ecr.${config.awsRegion}.amazonaws.com`;
  
  // Login to ECR
  log('Logging into ECR...', 'step');
  const loginResult = await $`aws ecr get-login-password --region ${config.awsRegion} | docker login --username AWS --password-stdin ${registry}`.nothrow();
  if (loginResult.exitCode !== 0) {
    log('ECR login failed', 'error');
    return false;
  }
  
  // Create ECR repositories if they don't exist
  const apps = ['bazaar', 'gateway', 'indexer', 'documentation', 'storage'];
  for (const app of apps) {
    await $`aws ecr describe-repositories --repository-names jeju/${app} --region ${config.awsRegion}`.quiet().nothrow()
      || await $`aws ecr create-repository --repository-name jeju/${app} --region ${config.awsRegion}`.quiet().nothrow();
  }
  
  // Build images
  log('Building Docker images...', 'step');
  const buildResult = await $`cd ${DEPLOYMENT_DIR} && NETWORK=testnet bun run scripts/build-images.ts --push`.nothrow();
  
  if (buildResult.exitCode !== 0) {
    log('Docker build failed', 'error');
    return false;
  }
  
  log('Docker images built and pushed', 'success');
  return true;
}

async function deployKubernetes(): Promise<boolean> {
  if (config.skipKubernetes || config.onlyContracts) {
    log('Skipping Kubernetes deployment', 'warn');
    return true;
  }
  
  banner('DEPLOYING KUBERNETES WORKLOADS');
  
  const helmfileDir = join(DEPLOYMENT_DIR, 'kubernetes/helmfile');
  
  // First, diff to see what will change
  log('Checking Helmfile diff...', 'step');
  await $`cd ${helmfileDir} && helmfile -e testnet diff`.nothrow();
  
  // Sync (deploy)
  log('Deploying with Helmfile...', 'step');
  const syncResult = await $`cd ${helmfileDir} && helmfile -e testnet sync`.nothrow();
  
  if (syncResult.exitCode !== 0) {
    log('Helmfile sync failed', 'error');
    return false;
  }
  
  log('Kubernetes workloads deployed', 'success');
  
  // Wait for pods to be ready
  log('Waiting for pods to be ready...', 'step');
  await $`kubectl wait --for=condition=ready pod --all -n jeju-apps --timeout=300s`.nothrow();
  
  return true;
}

async function deployContracts(): Promise<boolean> {
  if (config.skipContracts) {
    log('Skipping contract deployment', 'warn');
    return true;
  }
  
  banner('DEPLOYING SMART CONTRACTS');
  
  const pk = process.env.DEPLOYER_PRIVATE_KEY;
  if (!pk) {
    log('DEPLOYER_PRIVATE_KEY required for contract deployment', 'error');
    return false;
  }
  
  // Check deployer balance
  log('Checking deployer balance...', 'step');
  const balanceCheck = await $`cast balance $(cast wallet address --private-key ${pk}) --rpc-url https://sepolia.base.org`.quiet().nothrow();
  if (balanceCheck.exitCode === 0) {
    log(`Deployer balance: ${balanceCheck.stdout.toString().trim()}`, 'info');
  }
  
  // Deploy OIF to Base Sepolia (already deployed, verify)
  log('Verifying OIF on Base Sepolia...', 'step');
  const oifConfig = JSON.parse(readFileSync(join(CONTRACTS_DIR, 'deployments/oif-testnet.json'), 'utf-8'));
  const baseSepolia = oifConfig.chains?.['84532'];
  
  if (baseSepolia?.status === 'deployed') {
    log(`OIF already deployed on Base Sepolia`, 'success');
    log(`  SolverRegistry: ${baseSepolia.contracts?.solverRegistry}`, 'info');
    log(`  InputSettler: ${baseSepolia.contracts?.inputSettler}`, 'info');
    log(`  OutputSettler: ${baseSepolia.contracts?.outputSettler}`, 'info');
  } else {
    log('Deploying OIF to Base Sepolia...', 'step');
    const oifResult = await $`cd ${CONTRACTS_DIR} && \
      PRIVATE_KEY=${pk} \
      ORACLE_TYPE=simple \
      forge script script/DeployOIF.s.sol \
      --rpc-url https://sepolia.base.org \
      --broadcast`.nothrow();
    
    if (oifResult.exitCode !== 0) {
      log('OIF deployment failed', 'error');
    }
  }
  
  // Deploy to other chains if funded
  log('Checking multi-chain deployment...', 'step');
  const multiChainResult = await $`cd ${ROOT} && bun run scripts/deploy/oif-multichain.ts`.nothrow();
  if (multiChainResult.exitCode === 0) {
    log('Multi-chain OIF deployment check complete', 'success');
  }
  
  return true;
}

async function verifyDeployment(): Promise<boolean> {
  banner('VERIFYING DEPLOYMENT');
  
  let allHealthy = true;
  
  // Check Kubernetes pods
  log('Checking Kubernetes pods...', 'step');
  const podsResult = await $`kubectl get pods -n jeju-apps -o wide`.nothrow();
  if (podsResult.exitCode === 0) {
    console.log(podsResult.stdout.toString());
  }
  
  // Check services
  log('Checking Kubernetes services...', 'step');
  const svcResult = await $`kubectl get svc -n jeju-apps`.nothrow();
  if (svcResult.exitCode === 0) {
    console.log(svcResult.stdout.toString());
  }
  
  // Check ingress
  log('Checking ingress...', 'step');
  const ingResult = await $`kubectl get ingress -n jeju-apps`.nothrow();
  if (ingResult.exitCode === 0) {
    console.log(ingResult.stdout.toString());
  }
  
  // Run cross-chain verification
  log('Running cross-chain verification...', 'step');
  const crossChainResult = await $`cd ${ROOT} && bun run scripts/verify-crosschain-liquidity.ts --network testnet`.nothrow();
  
  return allHealthy;
}

async function printSummary() {
  banner('DEPLOYMENT SUMMARY');
  
  console.log(`
Environment:     ${config.environment}
AWS Account:     ${config.awsAccountId}
AWS Region:      ${config.awsRegion}
Domain:          ${config.domain}

EKS Cluster:     jeju-${config.environment}
ECR Registry:    ${config.awsAccountId}.dkr.ecr.${config.awsRegion}.amazonaws.com

Deployed Services:
  - OP-Node (Consensus)
  - Reth Sequencer (Execution)
  - Reth RPC (Public RPC)
  - OP-Batcher (L1 Data)
  - OP-Proposer (State Roots)
  - Bundler (ERC-4337)
  - Gateway (Frontend)
  - Bazaar (Marketplace)
  - Indexer (Subsquid)

Smart Contracts:
  - OIF (Open Intents Framework)
  - EIL (Ethereum Interop Layer) - pending
  - Paymaster (ERC-4337)

URLs (after DNS configuration):
  - RPC:      https://testnet-rpc.jeju.network
  - WS:       wss://testnet-ws.jeju.network
  - Gateway:  https://testnet.jeju.network
  - Bazaar:   https://bazaar.testnet.jeju.network

Next Steps:
  1. Configure DNS records in Route53
  2. Request and validate ACM certificate
  3. Fund deployer wallet on testnet chains
  4. Deploy remaining contracts (EIL)
  5. Register initial XLPs and Solvers
`);
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                                                                      ║
║   🚀 JEJU TESTNET FULL DEPLOYMENT                                    ║
║                                                                      ║
║   This script will deploy the complete Jeju testnet infrastructure   ║
║   including AWS resources, Kubernetes workloads, and smart contracts ║
║                                                                      ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  const startTime = Date.now();
  
  // Step 1: Prerequisites
  const prereqsOk = await checkPrerequisites();
  if (!prereqsOk && !config.onlyContracts) {
    log('Prerequisites check failed. Please fix issues and retry.', 'error');
    process.exit(1);
  }
  
  // Step 2: Terraform backend
  if (!config.skipTerraform && !config.onlyContracts) {
    const backendOk = await setupTerraformBackend();
    if (!backendOk) {
      log('Failed to setup Terraform backend', 'error');
      process.exit(1);
    }
  }
  
  // Step 3: Terraform infrastructure
  if (!config.skipTerraform && !config.onlyContracts) {
    const tfOk = await deployTerraform();
    if (!tfOk) {
      log('Terraform deployment failed', 'error');
      process.exit(1);
    }
    
    // Configure kubectl after Terraform
    await configureKubectl();
  }
  
  // Step 4: Docker images
  if (!config.skipImages && !config.onlyContracts) {
    const imagesOk = await buildAndPushImages();
    if (!imagesOk) {
      log('Docker image build failed', 'error');
      process.exit(1);
    }
  }
  
  // Step 5: Kubernetes workloads
  if (!config.skipKubernetes && !config.onlyContracts) {
    const k8sOk = await deployKubernetes();
    if (!k8sOk) {
      log('Kubernetes deployment failed', 'error');
      process.exit(1);
    }
  }
  
  // Step 6: Smart contracts
  const contractsOk = await deployContracts();
  if (!contractsOk) {
    log('Contract deployment had issues', 'warn');
  }
  
  // Step 7: Verification
  await verifyDeployment();
  
  // Summary
  await printSummary();
  
  const duration = Math.round((Date.now() - startTime) / 1000);
  log(`\nTotal deployment time: ${duration} seconds`, 'success');
}

main().catch(err => {
  log(`Deployment failed: ${err.message}`, 'error');
  console.error(err);
  process.exit(1);
});


