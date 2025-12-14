/**
 * jeju init - Initialize a new Jeju project
 */

import { Command } from 'commander';
import prompts from 'prompts';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execa } from 'execa';
import { logger } from '../lib/logger';

type ProjectType = 'agent' | 'dapp' | 'service';

interface ProjectOptions {
  name: string;
  type: ProjectType;
  description: string;
  withExamples: boolean;
  initGit: boolean;
}

export const initCommand = new Command('init')
  .description('Initialize a new Jeju project')
  .argument('[name]', 'Project name')
  .option('-t, --type <type>', 'Project type: agent, dapp, service')
  .option('-y, --yes', 'Use defaults without prompting')
  .action(async (name, options) => {
    logger.header('CREATE JEJU PROJECT');

    let projectOptions: ProjectOptions;

    if (options.yes && name) {
      projectOptions = {
        name,
        type: options.type || 'agent',
        description: `A Jeju ${options.type || 'agent'} project`,
        withExamples: true,
        initGit: true,
      };
    } else {
      projectOptions = await promptForOptions(name, options);
    }

    const projectDir = join(process.cwd(), projectOptions.name);

    // Check if directory exists
    if (existsSync(projectDir)) {
      logger.error(`Directory already exists: ${projectDir}`);
      process.exit(1);
    }

    logger.step(`Creating ${projectOptions.name}...`);

    // Create project directory
    mkdirSync(projectDir, { recursive: true });

    // Generate project files
    await generateProject(projectDir, projectOptions);

    // Initialize git
    if (projectOptions.initGit) {
      logger.step('Initializing git...');
      await execa('git', ['init'], { cwd: projectDir });
      logger.success('Git initialized');
    }

    // Install dependencies
    logger.step('Installing dependencies...');
    try {
      await execa('bun', ['install'], { cwd: projectDir, stdio: 'pipe' });
      logger.success('Dependencies installed');
    } catch {
      logger.warn('Failed to install dependencies. Run `bun install` manually.');
    }

    // Print success message
    logger.newline();
    logger.header('PROJECT CREATED');
    
    logger.success(`Created ${projectOptions.name}`);
    logger.newline();
    
    logger.subheader('Next Steps');
    logger.list([
      `cd ${projectOptions.name}`,
      'jeju dev           - Start development',
      'jeju test          - Run tests',
      'jeju keys generate - Generate deployment keys',
    ]);

    logger.newline();
    logger.subheader('Project Structure');
    logger.list([
      'src/              - Source code',
      'tests/            - Test files',
      'jeju-manifest.json - App configuration',
      '.env.example      - Environment template',
    ]);
  });

async function promptForOptions(name: string | undefined, cliOptions: { type?: string }): Promise<ProjectOptions> {
  const responses = await prompts([
    {
      type: name ? null : 'text',
      name: 'name',
      message: 'Project name:',
      initial: 'my-jeju-app',
      validate: (value: string) => /^[a-z0-9-]+$/.test(value) || 'Use lowercase letters, numbers, and hyphens',
    },
    {
      type: cliOptions.type ? null : 'select',
      name: 'type',
      message: 'Project type:',
      choices: [
        { title: 'Agent (MCP + A2A)', value: 'agent', description: 'AI agent with MCP and A2A protocols' },
        { title: 'dApp (Frontend + Contracts)', value: 'dapp', description: 'Full-stack decentralized application' },
        { title: 'Service (Backend only)', value: 'service', description: 'Backend service or API' },
      ],
      initial: 0,
    },
    {
      type: 'text',
      name: 'description',
      message: 'Description:',
      initial: 'A Jeju network project',
    },
    {
      type: 'confirm',
      name: 'withExamples',
      message: 'Include examples?',
      initial: true,
    },
    {
      type: 'confirm',
      name: 'initGit',
      message: 'Initialize git?',
      initial: true,
    },
  ]);

  return {
    name: name || responses.name,
    type: cliOptions.type || responses.type,
    description: responses.description,
    withExamples: responses.withExamples,
    initGit: responses.initGit,
  };
}

async function generateProject(projectDir: string, options: ProjectOptions): Promise<void> {
  const { name, type, description } = options;

  // package.json
  const packageJson = {
    name,
    version: '0.1.0',
    description,
    type: 'module',
    main: type === 'service' ? './src/index.ts' : undefined,
    scripts: {
      dev: type === 'dapp' ? 'vite' : 'bun run src/index.ts',
      build: type === 'dapp' ? 'vite build' : 'bun build src/index.ts --outdir dist',
      test: 'bun test',
      start: type === 'dapp' ? 'vite preview' : 'bun run dist/index.js',
      typecheck: 'tsc --noEmit',
    },
    dependencies: {
      '@jejunetwork/config': 'latest',
      '@jejunetwork/contracts': 'latest',
      '@jejunetwork/types': 'latest',
      'viem': '^2.7.15',
      'zod': '^3.22.4',
    },
    devDependencies: {
      '@types/bun': 'latest',
      'typescript': '^5.3.3',
      ...(type === 'dapp' ? { 'vite': '^5.0.0' } : {}),
    },
  };

  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // jeju-manifest.json
  const manifest = {
    $schema: 'https://raw.githubusercontent.com/elizaos/jeju/main/packages/config/jeju-manifest.schema.json',
    name,
    displayName: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    version: '0.1.0',
    type: 'vendor',
    description,
    commands: {
      dev: packageJson.scripts.dev,
      build: packageJson.scripts.build,
      test: packageJson.scripts.test,
      start: packageJson.scripts.start,
    },
    ports: {
      main: 3000,
      ...(type === 'agent' ? { a2a: 3001, mcp: 3002 } : {}),
    },
    dependencies: ['config', 'contracts'],
    enabled: true,
    autoStart: true,
    tags: [type],
    ...(type === 'agent' ? {
      agent: {
        enabled: true,
        a2aEndpoint: '/a2a',
        mcpEndpoint: '/mcp',
        tags: ['custom'],
        trustModels: ['open'],
      },
    } : {}),
  };

  writeFileSync(
    join(projectDir, 'jeju-manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  // tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022'],
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      outDir: './dist',
      rootDir: './src',
      declaration: true,
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  };

  writeFileSync(
    join(projectDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2)
  );

  // Create src directory
  mkdirSync(join(projectDir, 'src'), { recursive: true });
  mkdirSync(join(projectDir, 'tests'), { recursive: true });

  // Generate type-specific files
  switch (type) {
    case 'agent':
      await generateAgentFiles(projectDir, options);
      break;
    case 'dapp':
      await generateDappFiles(projectDir, options);
      break;
    case 'service':
      await generateServiceFiles(projectDir, options);
      break;
  }

  // .env.example
  const envExample = `# ${name} Environment Variables
# Copy to .env and fill in your values

# Network (localnet | testnet | mainnet)
JEJU_NETWORK=localnet

# Private key for transactions (optional for localnet)
# PRIVATE_KEY=

# RPC URL override (optional)
# JEJU_RPC_URL=http://127.0.0.1:9545
`;

  writeFileSync(join(projectDir, '.env.example'), envExample);

  // .gitignore
  const gitignore = `node_modules/
dist/
.env
*.log
.DS_Store
`;

  writeFileSync(join(projectDir, '.gitignore'), gitignore);

  // README.md
  const readme = `# ${name}

${description}

## Getting Started

\`\`\`bash
# Install dependencies
bun install

# Start development
jeju dev

# Run tests
jeju test
\`\`\`

## Commands

- \`jeju dev\` - Start local development environment
- \`jeju test\` - Run test suite
- \`jeju deploy --network=testnet\` - Deploy to testnet

## Configuration

See \`jeju-manifest.json\` for app configuration.
See \`.env.example\` for environment variables.
`;

  writeFileSync(join(projectDir, 'README.md'), readme);
}

async function generateAgentFiles(projectDir: string, options: ProjectOptions): Promise<void> {
  // src/index.ts
  const indexTs = `/**
 * ${options.name} - Jeju Agent
 */

import { getConfig, getContract } from '@jejunetwork/config';

const config = getConfig();

console.log(\`Starting ${options.name} on \${config.network}\`);
console.log(\`RPC: \${config.services.rpc.l2}\`);

// Your agent code here

// Example: A2A handler
export async function handleA2ARequest(request: unknown) {
  return { status: 'ok', message: 'Hello from ${options.name}' };
}

// Example: MCP handler
export async function handleMCPRequest(request: unknown) {
  return { tools: [] };
}
`;

  writeFileSync(join(projectDir, 'src/index.ts'), indexTs);

  // tests/basic.test.ts
  const testTs = `import { describe, test, expect } from 'bun:test';
import { handleA2ARequest, handleMCPRequest } from '../src/index';

describe('${options.name}', () => {
  test('A2A handler responds', async () => {
    const response = await handleA2ARequest({});
    expect(response.status).toBe('ok');
  });

  test('MCP handler returns tools', async () => {
    const response = await handleMCPRequest({});
    expect(response.tools).toBeDefined();
  });
});
`;

  writeFileSync(join(projectDir, 'tests/basic.test.ts'), testTs);
}

async function generateDappFiles(projectDir: string, options: ProjectOptions): Promise<void> {
  // src/index.ts
  const indexTs = `/**
 * ${options.name} - Jeju dApp
 */

import { createPublicClient, http } from 'viem';
import { getConfig } from '@jejunetwork/config';

const config = getConfig();

const client = createPublicClient({
  transport: http(config.services.rpc.l2),
});

async function main() {
  const chainId = await client.getChainId();
  console.log(\`Connected to chain \${chainId}\`);
}

main();
`;

  writeFileSync(join(projectDir, 'src/index.ts'), indexTs);

  // tests/basic.test.ts
  const testTs = `import { describe, test, expect } from 'bun:test';

describe('${options.name}', () => {
  test('can load config', async () => {
    const { getConfig } = await import('@jejunetwork/config');
    const config = getConfig();
    expect(config.network).toBeDefined();
  });
});
`;

  writeFileSync(join(projectDir, 'tests/basic.test.ts'), testTs);
}

async function generateServiceFiles(projectDir: string, options: ProjectOptions): Promise<void> {
  // src/index.ts
  const indexTs = `/**
 * ${options.name} - Jeju Service
 */

import { getConfig } from '@jejunetwork/config';

const config = getConfig();

console.log(\`Starting ${options.name}\`);
console.log(\`Network: \${config.network}\`);
console.log(\`RPC: \${config.services.rpc.l2}\`);

// Your service code here
`;

  writeFileSync(join(projectDir, 'src/index.ts'), indexTs);

  // tests/basic.test.ts
  const testTs = `import { describe, test, expect } from 'bun:test';

describe('${options.name}', () => {
  test('can load config', async () => {
    const { getConfig } = await import('@jejunetwork/config');
    const config = getConfig();
    expect(config.network).toBeDefined();
  });
});
`;

  writeFileSync(join(projectDir, 'tests/basic.test.ts'), testTs);
}

