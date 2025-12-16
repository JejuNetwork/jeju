/**
 * init command - Create a new dApp from template
 * 
 * Scaffolds a new decentralized application with:
 * - Full service integration (CQL, IPFS, KMS, Cron)
 * - REST API, A2A, and MCP protocols
 * - x402 payment support
 * - Synpress tests
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, cpSync } from 'fs';
import { join, relative } from 'path';
import chalk from 'chalk';
import { execa } from 'execa';
import { logger } from '../lib/logger';
import { findMonorepoRoot } from '../lib/system';

interface InitConfig {
  name: string;
  displayName: string;
  jnsName: string;
  databaseId: string;
  description: string;
  x402Enabled: boolean;
  oauth3Enabled: boolean;
  oauth3AppId: string;
  outputDir: string;
}

const TEMPLATE_PATH = join(import.meta.dir, '../../../../apps/example-app');

// Vendor manifest subcommand
const vendorSubcommand = new Command('vendor')
  .description('Create vendor app manifest')
  .argument('<app-name>', 'Vendor app name')
  .action(async (appName) => {
    await createVendorManifest(appName);
  });

async function createVendorManifest(appName: string) {
  const rootDir = findMonorepoRoot();
  const scriptPath = join(rootDir, 'scripts/vendor/create-vendor-manifest.ts');
  
  if (!existsSync(scriptPath)) {
    logger.error('Vendor manifest script not found');
    return;
  }

  await execa('bun', ['run', scriptPath, appName], {
    cwd: rootDir,
    stdio: 'inherit',
  });
}

export const initCommand = new Command('init')
  .description('Create a new decentralized app from template')
  .addCommand(vendorSubcommand)
  .argument('[name]', 'App name (e.g., my-app)')
  .option('-d, --dir <directory>', 'Output directory')
  .option('-y, --yes', 'Skip prompts and use defaults')
  .option('--no-x402', 'Disable x402 payment support')
  .addHelpText('after', `
Examples:
  ${chalk.cyan('jeju init my-app')}                Create new dApp named "my-app"
  ${chalk.cyan('jeju init my-app -d ./projects')}  Create in specific directory
  ${chalk.cyan('jeju init -y')}                    Quick create with defaults
  ${chalk.cyan('jeju init --no-x402')}             Create without x402 payments
  ${chalk.cyan('jeju init vendor my-app')}          Create vendor app manifest
`)
  .action(async (nameArg: string | undefined, options: { dir?: string; yes?: boolean; x402?: boolean }) => {
    logger.header('CREATE NEW DAPP');

    // Validate template exists
    if (!existsSync(TEMPLATE_PATH)) {
      logger.error(`Template not found at ${TEMPLATE_PATH}`);
      logger.info('Make sure example-app exists in apps/');
      process.exit(1);
    }

    let config: InitConfig;

    if (options.yes && nameArg) {
      // Quick mode with defaults
      config = {
        name: nameArg,
        displayName: formatDisplayName(nameArg),
        jnsName: `${nameArg}.jeju`,
        databaseId: `${nameArg}-db`,
        description: `A decentralized ${nameArg} application`,
        x402Enabled: options.x402 !== false,
        oauth3Enabled: true,
        oauth3AppId: `${nameArg}.oauth3.jeju`,
        outputDir: options.dir || join(process.cwd(), nameArg),
      };
    } else {
      // Interactive prompts
      const answers = await prompts([
        {
          type: 'text',
          name: 'name',
          message: 'App name (lowercase, hyphens allowed):',
          initial: nameArg || 'my-dapp',
          validate: (value: string) => {
            if (!/^[a-z][a-z0-9-]*$/.test(value)) {
              return 'Name must be lowercase, start with letter, and only contain letters, numbers, and hyphens';
            }
            return true;
          },
        },
        {
          type: 'text',
          name: 'displayName',
          message: 'Display name:',
          initial: (prev: string) => formatDisplayName(prev),
        },
        {
          type: 'text',
          name: 'description',
          message: 'Description:',
          initial: (prev: string, values: { name: string }) => `A decentralized ${values.name} application`,
        },
        {
          type: 'text',
          name: 'jnsName',
          message: 'JNS domain name:',
          initial: (prev: string, values: { name: string }) => `${values.name}.jeju`,
        },
        {
          type: 'text',
          name: 'databaseId',
          message: 'Database ID:',
          initial: (prev: string, values: { name: string }) => `${values.name}-db`,
        },
        {
          type: 'confirm',
          name: 'x402Enabled',
          message: 'Enable x402 payments?',
          initial: true,
        },
        {
          type: 'confirm',
          name: 'oauth3Enabled',
          message: 'Enable OAuth3 authentication?',
          initial: true,
        },
        {
          type: (prev: boolean) => prev ? 'text' : null,
          name: 'oauth3AppId',
          message: 'OAuth3 App ID:',
          initial: (prev: string, values: { name: string }) => `${values.name}.oauth3.jeju`,
        },
        {
          type: 'text',
          name: 'outputDir',
          message: 'Output directory:',
          initial: (prev: string, values: { name: string }) => 
            options.dir || join(process.cwd(), values.name),
        },
      ]);

      if (!answers.name) {
        logger.error('Setup cancelled');
        process.exit(1);
      }

      // Default oauth3AppId if OAuth3 disabled
      if (!answers.oauth3Enabled) {
        answers.oauth3AppId = '';
      }

      config = answers as InitConfig;
    }

    // Check if directory exists
    if (existsSync(config.outputDir)) {
      const files = readdirSync(config.outputDir);
      if (files.length > 0) {
        const { overwrite } = await prompts({
          type: 'confirm',
          name: 'overwrite',
          message: `Directory ${config.outputDir} is not empty. Overwrite?`,
          initial: false,
        });

        if (!overwrite) {
          logger.info('Cancelled');
          process.exit(0);
        }
      }
    }

    logger.step(`Creating ${config.displayName}...`);

    // Create output directory
    mkdirSync(config.outputDir, { recursive: true });

    // Copy template files
    await copyTemplate(TEMPLATE_PATH, config.outputDir, config);

    // Generate customized files
    await generateCustomFiles(config);

    logger.success(`\nCreated ${config.displayName} at ${config.outputDir}`);

    // Print next steps
    console.log(chalk.bold('\nNext steps:\n'));
    console.log(`  ${chalk.cyan('cd')} ${relative(process.cwd(), config.outputDir)}`);
    console.log(`  ${chalk.cyan('bun install')}`);
    console.log(`  ${chalk.cyan('bun run migrate')}  # Set up database`);
    console.log(`  ${chalk.cyan('bun run seed')}     # Seed OAuth3 registry (dev)`);
    console.log(`  ${chalk.cyan('bun run dev')}      # Start development server`);

    console.log(chalk.bold('\nTo deploy:\n'));
    console.log(`  ${chalk.cyan('bun run deploy')}   # Deploy to network`);

    console.log(chalk.bold('\nEndpoints:\n'));
    console.log(`  REST API:   http://localhost:4500/api/v1`);
    console.log(`  A2A:        http://localhost:4500/a2a`);
    console.log(`  MCP:        http://localhost:4500/mcp`);
    console.log(`  x402:       http://localhost:4500/x402`);
    console.log(`  Auth:       http://localhost:4500/auth`);
    console.log(`  Health:     http://localhost:4500/health`);

    console.log(chalk.dim(`\nDocumentation: https://docs.jeju.network/templates\n`));
  });

function formatDisplayName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function copyTemplate(templateDir: string, outputDir: string, config: InitConfig): Promise<void> {
  const skipFiles = ['node_modules', '.git', 'dist', 'bun.lockb', '.turbo'];
  
  function copyRecursive(src: string, dest: string) {
    const stat = statSync(src);
    
    if (stat.isDirectory()) {
      const baseName = src.split('/').pop() || '';
      if (skipFiles.includes(baseName)) return;
      
      mkdirSync(dest, { recursive: true });
      const files = readdirSync(src);
      
      for (const file of files) {
        copyRecursive(join(src, file), join(dest, file));
      }
    } else {
      // Read and transform file content
      let content = readFileSync(src, 'utf-8');
      content = transformContent(content, config);
      writeFileSync(dest, content);
    }
  }

  copyRecursive(templateDir, outputDir);
}

function transformContent(content: string, config: InitConfig): string {
  // Replace template placeholders
  return content
    .replace(/example-app/g, config.name)
    .replace(/Decentralized App Template/g, config.displayName)
    .replace(/template\.jeju/g, config.jnsName)
    .replace(/example-app-db/g, config.databaseId)
    .replace(/@jejunetwork\/example-app/g, `@jejunetwork/${config.name}`)
    .replace(/A production-ready template for building fully decentralized applications/g, config.description);
}

async function generateCustomFiles(config: InitConfig): Promise<void> {
  // Generate customized package.json
  const packageJsonPath = join(config.outputDir, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  
  packageJson.name = `@jejunetwork/${config.name}`;
  packageJson.description = config.description;
  
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));

  // Generate customized manifest
  const manifestPath = join(config.outputDir, 'jeju-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  
  manifest.name = config.name;
  manifest.displayName = config.displayName;
  manifest.description = config.description;
  manifest.jns.name = config.jnsName;
  manifest.jns.description = config.displayName;
  manifest.services.database.databaseId = config.databaseId;
  manifest.agent.jnsName = config.jnsName;
  manifest.agent.x402Support = config.x402Enabled;
  
  // Remove template-specific fields
  delete manifest.template;
  
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Generate .env.example
  const envContent = `# ${config.displayName} Configuration

# Server
PORT=4500
FRONTEND_PORT=4501
APP_NAME="${config.displayName}"

# Network
NETWORK=localnet
L2_RPC_URL=http://localhost:9545

# Services
CQL_BLOCK_PRODUCER_ENDPOINT=http://localhost:4300
CQL_DATABASE_ID=${config.databaseId}
COMPUTE_CACHE_ENDPOINT=http://localhost:4200/cache
KMS_ENDPOINT=http://localhost:4400
STORAGE_API_ENDPOINT=http://localhost:4010
IPFS_GATEWAY=http://localhost:4180
CRON_ENDPOINT=http://localhost:4200/cron
WEBHOOK_BASE=http://localhost:4500
JNS_GATEWAY_URL=http://localhost:4020

# x402 Payments
X402_ENABLED=${config.x402Enabled}
X402_PAYMENT_ADDRESS=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

# OAuth3 Authentication
OAUTH3_ENABLED=${config.oauth3Enabled}
OAUTH3_APP_ID=${config.oauth3AppId || config.name + '.oauth3.jeju'}
OAUTH3_TEE_AGENT_URL=http://localhost:8004
OAUTH3_REDIRECT_URI=http://localhost:4501/auth/callback

# Deployment
DEPLOYER_PRIVATE_KEY=
JNS_NAME=${config.jnsName}
`;

  writeFileSync(join(config.outputDir, '.env.example'), envContent);

  // Generate README
  const readmeContent = `# ${config.displayName}

${config.description}

## Features

- **Fully Decentralized**: CQL database, IPFS storage, KMS encryption
- **AI Integration**: A2A and MCP protocols for agent communication
- **Monetization**: x402 payment protocol for paid APIs
- **OAuth3 Authentication**: TEE-backed decentralized auth with social logins
- **Scheduled Tasks**: On-chain cron triggers
- **Human-readable Names**: JNS integration (${config.jnsName})

## Quick Start

\`\`\`bash
# Install dependencies
bun install

# Set up database
bun run migrate

# Seed OAuth3 registry (development)
bun run seed

# Start development server
bun run dev
\`\`\`

## Endpoints

| Endpoint | URL |
|----------|-----|
| REST API | http://localhost:4500/api/v1 |
| A2A | http://localhost:4500/a2a |
| MCP | http://localhost:4500/mcp |
| x402 | http://localhost:4500/x402 |
| Auth | http://localhost:4500/auth |
| Health | http://localhost:4500/health |

## Authentication

This app supports OAuth3 decentralized authentication:

- **Wallet**: Direct wallet signature (always available)
- **Social**: GitHub, Google, Twitter, Discord, Farcaster (requires TEE agent)

\`\`\`bash
# Check available providers
curl http://localhost:4500/auth/providers

# Get session info
curl -H "x-oauth3-session: <session-id>" http://localhost:4500/auth/session
\`\`\`

## Testing

\`\`\`bash
# Unit tests
bun test

# E2E tests (requires server running)
bun run test:e2e

# Synpress tests (wallet integration)
bun run test:synpress
\`\`\`

## Deployment

\`\`\`bash
# Deploy to localnet
bun run deploy

# Deploy to testnet
NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... bun run deploy

# Deploy to mainnet
NETWORK=mainnet DEPLOYER_PRIVATE_KEY=0x... bun run deploy
\`\`\`

## License

MIT
`;

  writeFileSync(join(config.outputDir, 'README.md'), readmeContent);
}

