#!/usr/bin/env bun
/**
 * AWS Infrastructure Deployment Script
 * 
 * Complete infrastructure deployment with proper phases:
 * 1. Phase 1: Core infrastructure (VPC, EKS, RDS, ECR)
 * 2. Phase 2: DNS & Certificate (Route53, ACM)
 * 3. Phase 3: CDN & Services (CloudFront, DNS records)
 * 
 * Usage:
 *   bun run scripts/deploy/aws-infrastructure.ts deploy testnet
 *   bun run scripts/deploy/aws-infrastructure.ts destroy testnet
 *   bun run scripts/deploy/aws-infrastructure.ts status testnet
 */

import { $ } from 'bun';
import { resolve } from 'path';

const NETWORKS = ['testnet', 'mainnet'] as const;
type Network = typeof NETWORKS[number];

const COMMANDS = ['deploy', 'destroy', 'status', 'plan', 'output'] as const;
type Command = typeof COMMANDS[number];

const ROOT = resolve(import.meta.dir, '../..');
const DEPLOYMENT_DIR = resolve(ROOT, 'packages/deployment');
const TF_DIR = resolve(DEPLOYMENT_DIR, 'terraform/environments');

interface Config {
  command: Command;
  network: Network;
  autoApprove: boolean;
  skipPrompts: boolean;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  const command = (args[0] || 'status') as Command;
  const network = (args[1] || 'testnet') as Network;
  
  if (!COMMANDS.includes(command)) {
    console.error(`Invalid command: ${command}`);
    console.error(`Valid commands: ${COMMANDS.join(', ')}`);
    process.exit(1);
  }
  
  if (!NETWORKS.includes(network)) {
    console.error(`Invalid network: ${network}`);
    console.error(`Valid networks: ${NETWORKS.join(', ')}`);
    process.exit(1);
  }
  
  return {
    command,
    network,
    autoApprove: args.includes('--auto-approve') || args.includes('-y'),
    skipPrompts: args.includes('--skip-prompts'),
  };
}

function banner(title: string) {
  console.log('\n' + '═'.repeat(70));
  console.log(`  ${title}`);
  console.log('═'.repeat(70) + '\n');
}

async function runTerraform(tfDir: string, command: string, args: string[] = []): Promise<boolean> {
  const result = await $`cd ${tfDir} && terraform ${command} ${args}`.nothrow();
  return result.exitCode === 0;
}

async function checkTerraformBackend(network: Network): Promise<boolean> {
  const bucketName = `jeju-terraform-state-${network}`;
  const tableName = `jeju-terraform-locks-${network}`;
  
  // Check S3 bucket
  const bucketCheck = await $`aws s3 ls s3://${bucketName}`.quiet().nothrow();
  if (bucketCheck.exitCode !== 0) {
    console.log(`Creating S3 bucket: ${bucketName}`);
    
    const region = process.env.AWS_REGION || 'us-east-1';
    if (region === 'us-east-1') {
      await $`aws s3api create-bucket --bucket ${bucketName} --region ${region}`;
    } else {
      await $`aws s3api create-bucket --bucket ${bucketName} --region ${region} --create-bucket-configuration LocationConstraint=${region}`;
    }
    
    await $`aws s3api put-bucket-versioning --bucket ${bucketName} --versioning-configuration Status=Enabled`;
    await $`aws s3api put-bucket-encryption --bucket ${bucketName} --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'`;
  }
  
  // Check DynamoDB table
  const tableCheck = await $`aws dynamodb describe-table --table-name ${tableName}`.quiet().nothrow();
  if (tableCheck.exitCode !== 0) {
    console.log(`Creating DynamoDB table: ${tableName}`);
    
    await $`aws dynamodb create-table \
      --table-name ${tableName} \
      --attribute-definitions AttributeName=LockID,AttributeType=S \
      --key-schema AttributeName=LockID,KeyType=HASH \
      --billing-mode PAY_PER_REQUEST \
      --region ${process.env.AWS_REGION || 'us-east-1'}`;
      
    // Wait for table to be active
    await $`aws dynamodb wait table-exists --table-name ${tableName}`;
  }
  
  return true;
}

async function deploy(config: Config) {
  const tfDir = resolve(TF_DIR, config.network);
  
  banner(`DEPLOYING ${config.network.toUpperCase()} INFRASTRUCTURE`);
  
  // Ensure backend exists
  console.log('Checking Terraform backend...');
  await checkTerraformBackend(config.network);
  
  // Initialize Terraform
  console.log('\nInitializing Terraform...');
  if (!await runTerraform(tfDir, 'init')) {
    console.error('Terraform init failed');
    process.exit(1);
  }
  
  // Plan
  console.log('\nPlanning changes...');
  if (!await runTerraform(tfDir, 'plan', ['-out=tfplan'])) {
    console.error('Terraform plan failed');
    process.exit(1);
  }
  
  // Apply
  if (config.autoApprove) {
    console.log('\nApplying changes...');
    if (!await runTerraform(tfDir, 'apply', ['tfplan'])) {
      console.error('Terraform apply failed');
      process.exit(1);
    }
  } else {
    console.log('\nTo apply changes, run:');
    console.log(`  cd ${tfDir} && terraform apply tfplan`);
    console.log('\nOr run with --auto-approve to apply automatically.');
    return;
  }
  
  // Show outputs
  console.log('\nDeployment outputs:');
  await runTerraform(tfDir, 'output');
  
  banner('DEPLOYMENT COMPLETE');
}

async function destroy(config: Config) {
  const tfDir = resolve(TF_DIR, config.network);
  
  banner(`DESTROYING ${config.network.toUpperCase()} INFRASTRUCTURE`);
  
  if (config.network === 'mainnet' && !config.autoApprove) {
    console.error('MAINNET destruction requires explicit --auto-approve flag');
    process.exit(1);
  }
  
  // Initialize Terraform
  console.log('Initializing Terraform...');
  await runTerraform(tfDir, 'init');
  
  // Plan destruction
  console.log('\nPlanning destruction...');
  await runTerraform(tfDir, 'plan', ['-destroy', '-out=destroy.tfplan']);
  
  if (config.autoApprove) {
    console.log('\nDestroying infrastructure...');
    
    // First, disable CDN and DNS records to avoid dependency issues
    console.log('Disabling CDN and DNS records first...');
    await $`cd ${tfDir} && terraform apply -var="enable_cdn=false" -var="enable_dns_records=false" -auto-approve`.nothrow();
    
    // Now destroy everything
    console.log('\nDestroying all resources...');
    if (!await runTerraform(tfDir, 'destroy', ['-auto-approve'])) {
      console.error('Terraform destroy failed');
      
      // Try force destroy
      console.log('\nAttempting forced cleanup...');
      await $`cd ${tfDir} && terraform destroy -auto-approve -refresh=false`.nothrow();
    }
    
    banner('DESTRUCTION COMPLETE');
  } else {
    console.log('\nTo destroy infrastructure, run:');
    console.log(`  cd ${tfDir} && terraform destroy`);
    console.log('\nOr run with --auto-approve to destroy automatically.');
  }
}

async function status(config: Config) {
  const tfDir = resolve(TF_DIR, config.network);
  
  banner(`${config.network.toUpperCase()} INFRASTRUCTURE STATUS`);
  
  // Check AWS credentials
  const awsCheck = await $`aws sts get-caller-identity --query Account --output text`.quiet().nothrow();
  if (awsCheck.exitCode !== 0) {
    console.log('❌ AWS credentials not configured');
    return;
  }
  console.log(`✅ AWS Account: ${awsCheck.stdout.toString().trim()}`);
  
  // Check Terraform state
  const initResult = await $`cd ${tfDir} && terraform init -backend=true`.quiet().nothrow();
  if (initResult.exitCode !== 0) {
    console.log('❌ Terraform not initialized');
    return;
  }
  
  // Show state
  console.log('\nTerraform state:');
  await $`cd ${tfDir} && terraform show -no-color`.nothrow();
  
  // Show outputs
  console.log('\nOutputs:');
  await $`cd ${tfDir} && terraform output -no-color`.nothrow();
}

async function plan(config: Config) {
  const tfDir = resolve(TF_DIR, config.network);
  
  banner(`PLANNING ${config.network.toUpperCase()} CHANGES`);
  
  await $`cd ${tfDir} && terraform init`;
  await $`cd ${tfDir} && terraform plan`;
}

async function output(config: Config) {
  const tfDir = resolve(TF_DIR, config.network);
  await $`cd ${tfDir} && terraform output`;
}

async function main() {
  const config = parseArgs();
  
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  AWS Infrastructure Manager                                          ║
║  Command: ${config.command.padEnd(57)}║
║  Network: ${config.network.padEnd(57)}║
╚══════════════════════════════════════════════════════════════════════╝
`);

  switch (config.command) {
    case 'deploy':
      await deploy(config);
      break;
    case 'destroy':
      await destroy(config);
      break;
    case 'status':
      await status(config);
      break;
    case 'plan':
      await plan(config);
      break;
    case 'output':
      await output(config);
      break;
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});


