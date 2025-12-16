/**
 * Infrastructure deployment commands
 */

import { Command } from 'commander';
import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

const infraCommand = new Command('infra')
  .description('Infrastructure deployment and management')
  .alias('infrastructure');

infraCommand
  .command('validate')
  .description('Validate all deployment configurations (Terraform, Helm, Kurtosis)')
  .action(async () => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/validate.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Validation script not found');
      return;
    }
    
    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      stdio: 'inherit',
    });
  });

infraCommand
  .command('terraform')
  .description('Terraform operations for infrastructure')
  .argument('[command]', 'Command: init | plan | apply | destroy | output', 'plan')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'testnet')
  .action(async (command: string = 'plan', options: { network: string }) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/terraform.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Terraform script not found');
      return;
    }
    
    await execa('bun', ['run', scriptPath, command], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    });
  });

infraCommand
  .command('helmfile')
  .description('Helmfile operations for Kubernetes deployments')
  .argument('[command]', 'Command: diff | sync | apply | destroy | status | list', 'diff')
  .option('--network <network>', 'Network: localnet | testnet | mainnet', 'testnet')
  .action(async (command: string = 'diff', options: { network: string }) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/helmfile.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Helmfile script not found');
      return;
    }
    
    await execa('bun', ['run', scriptPath, command], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    });
  });

infraCommand
  .command('deploy-full')
  .description('Full deployment pipeline (validate, terraform, images, kubernetes, verify)')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .option('--skip-validate', 'Skip validation step')
  .option('--skip-terraform', 'Skip Terraform step')
  .option('--skip-images', 'Skip Docker image builds')
  .option('--skip-kubernetes', 'Skip Kubernetes deployment')
  .option('--skip-verify', 'Skip verification step')
  .option('--build-cql', 'Build CovenantSQL image')
  .action(async (options: {
    network: string;
    skipValidate?: boolean;
    skipTerraform?: boolean;
    skipImages?: boolean;
    skipKubernetes?: boolean;
    skipVerify?: boolean;
    buildCql?: boolean;
  }) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/deploy-full.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('Deploy full script not found');
      return;
    }
    
    const env: Record<string, string> = {
      ...process.env,
      NETWORK: options.network,
    };
    
    if (options.skipValidate) env.SKIP_VALIDATE = 'true';
    if (options.skipTerraform) env.SKIP_TERRAFORM = 'true';
    if (options.skipImages) env.SKIP_IMAGES = 'true';
    if (options.skipKubernetes) env.SKIP_KUBERNETES = 'true';
    if (options.skipVerify) env.SKIP_VERIFY = 'true';
    if (options.buildCql) env.BUILD_CQL_IMAGE = 'true';
    
    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      env,
      stdio: 'inherit',
    });
  });

infraCommand
  .command('genesis')
  .description('Generate L2 genesis files using op-node')
  .option('--network <network>', 'Network: testnet | mainnet', 'testnet')
  .action(async (options: { network: string }) => {
    const rootDir = findMonorepoRoot();
    const scriptPath = join(rootDir, 'packages/deployment/scripts/l2-genesis.ts');
    
    if (!existsSync(scriptPath)) {
      logger.error('L2 genesis script not found');
      return;
    }
    
    await execa('bun', ['run', scriptPath], {
      cwd: rootDir,
      env: { ...process.env, NETWORK: options.network },
      stdio: 'inherit',
    });
  });

export { infraCommand };

