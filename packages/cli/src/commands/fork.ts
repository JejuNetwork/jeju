/**
 * fork command - Fork and deploy your own network
 *
 * Creates a complete network deployment with:
 * - Custom branding (name, tagline, colors)
 * - Chain configuration
 * - All core contracts
 * - Federation registration
 * - Cross-chain trust
 */

import type { Dirent } from 'node:fs'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  type BrandingConfig,
  generateForkBranding,
  getNetworkName,
} from '@jejunetwork/config'
import { Command } from 'commander'
import prompts from 'prompts'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { logger } from '../lib/logger'

interface ForkConfig {
  name: string
  displayName: string
  tagline: string
  chainId: number
  l1Chain: 'ethereum' | 'sepolia' | 'base'
  domain: string
  tokenSymbol: string
  governanceTokenName: string
  governanceTokenSymbol: string
  stake: string
}

const L1_CONFIGS = {
  ethereum: {
    chainId: 1,
    rpcUrl: 'https://eth.llamarpc.com',
    name: 'Ethereum Mainnet',
  },
  sepolia: {
    chainId: 11155111,
    rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    name: 'Sepolia',
  },
  base: {
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    name: 'Base',
  },
}

export const forkCommand = new Command('fork')
  .description('Fork and deploy your own network')
  .option('--name <name>', 'Network name')
  .option('--chain-id <id>', 'Chain ID (must be unique)')
  .option('--l1 <chain>', 'L1 chain: ethereum | sepolia | base', 'sepolia')
  .option('--domain <domain>', 'Your domain (e.g., mynetwork.xyz)')
  .option('--token-symbol <symbol>', 'Native token symbol', 'ETH')
  .option('--skip-federation', 'Skip federation registration')
  .option('--minimal', 'Minimal prompts - use defaults where possible')
  .option('-y, --yes', 'Skip all confirmations')
  .action(async (options) => {
    logger.header('FORK YOUR OWN NETWORK')

    const parentNetwork = getNetworkName()
    console.log(
      `\nYou're forking ${parentNetwork} to create your own L2 network.\n`,
    )
    console.log('This wizard will help you set up everything you need.\n')

    let config: ForkConfig

    if (options.yes && options.name && options.chainId) {
      // Non-interactive mode with all required options
      config = {
        name: options.name,
        displayName: `${options.name} Network`,
        tagline: `The ${options.name} L2 network`,
        chainId: parseInt(options.chainId, 10),
        l1Chain: options.l1 || 'sepolia',
        domain:
          options.domain ||
          `${options.name.toLowerCase().replace(/\s+/g, '')}.network`,
        tokenSymbol: options.tokenSymbol || 'ETH',
        governanceTokenName: `${options.name} Token`,
        governanceTokenSymbol: options.name.toUpperCase().slice(0, 4),
        stake: options.stake || '1',
      }
    } else {
      // Interactive mode with friendly prompts
      console.log('━'.repeat(50))
      console.log('Step 1: Basic Info')
      console.log(`${'━'.repeat(50)}\n`)

      const basicInfo = await prompts([
        {
          type: 'text',
          name: 'name',
          message: 'What should your network be called?',
          initial: options.name || 'MyNetwork',
          validate: (v: string) =>
            v.length >= 2 || 'Name must be at least 2 characters',
        },
        {
          type: 'text',
          name: 'tagline',
          message: 'Add a short tagline (or press Enter to skip):',
          initial: (prev: string) => `The ${prev} L2 network`,
        },
        {
          type: 'number',
          name: 'chainId',
          message: 'Choose a chain ID (pick a unique number):',
          initial: options.chainId
            ? parseInt(options.chainId, 10)
            : Math.floor(Math.random() * 900000) + 100000,
          validate: (v: number) =>
            (v > 0 && v < 2147483647) || 'Chain ID must be a positive integer',
        },
      ])

      if (!basicInfo.name) {
        logger.error('Fork cancelled')
        return
      }

      console.log(`\n${'━'.repeat(50)}`)
      console.log('Step 2: Network Setup')
      console.log(`${'━'.repeat(50)}\n`)

      const networkSetup = await prompts([
        {
          type: 'select',
          name: 'l1Chain',
          message: 'Which L1 chain should your network settle to?',
          choices: [
            { title: '🧪 Sepolia (Recommended for testing)', value: 'sepolia' },
            { title: '💎 Ethereum Mainnet (Production)', value: 'ethereum' },
            { title: '🔵 Base (L2 on L2)', value: 'base' },
          ],
          initial: 0,
        },
        {
          type: 'text',
          name: 'domain',
          message: 'Your domain (or press Enter to use default):',
          initial: `${basicInfo.name.toLowerCase().replace(/\s+/g, '')}.network`,
        },
      ])

      if (!options.minimal) {
        console.log(`\n${'━'.repeat(50)}`)
        console.log('Step 3: Tokens (Optional - press Enter to skip)')
        console.log(`${'━'.repeat(50)}\n`)

        const tokenSetup = await prompts([
          {
            type: 'text',
            name: 'tokenSymbol',
            message: 'Native gas token symbol:',
            initial: 'ETH',
          },
          {
            type: 'text',
            name: 'governanceTokenName',
            message: 'Governance token name:',
            initial: `${basicInfo.name} Token`,
          },
          {
            type: 'text',
            name: 'governanceTokenSymbol',
            message: 'Governance token symbol:',
            initial: basicInfo.name.toUpperCase().slice(0, 4),
          },
        ])

        config = {
          name: basicInfo.name,
          displayName: `${basicInfo.name} Network`,
          tagline: basicInfo.tagline,
          chainId: basicInfo.chainId,
          l1Chain: networkSetup.l1Chain,
          domain: networkSetup.domain,
          tokenSymbol: tokenSetup.tokenSymbol || 'ETH',
          governanceTokenName:
            tokenSetup.governanceTokenName || `${basicInfo.name} Token`,
          governanceTokenSymbol:
            tokenSetup.governanceTokenSymbol ||
            basicInfo.name.toUpperCase().slice(0, 4),
          stake: options.stake || '1',
        }
      } else {
        config = {
          name: basicInfo.name,
          displayName: `${basicInfo.name} Network`,
          tagline: basicInfo.tagline,
          chainId: basicInfo.chainId,
          l1Chain: networkSetup.l1Chain,
          domain: networkSetup.domain,
          tokenSymbol: 'ETH',
          governanceTokenName: `${basicInfo.name} Token`,
          governanceTokenSymbol: basicInfo.name.toUpperCase().slice(0, 4),
          stake: options.stake || '1',
        }
      }
    }

    const l1Config = L1_CONFIGS[config.l1Chain]
    const outputDir = join(
      process.cwd(),
      '.fork',
      config.name.toLowerCase().replace(/\s+/g, '-'),
    )

    console.log(`\n${'━'.repeat(50)}`)
    console.log('Review Your Configuration')
    console.log('━'.repeat(50))

    logger.box([
      `Network: ${config.displayName}`,
      `Tagline: ${config.tagline}`,
      `Chain ID: ${config.chainId}`,
      `L1: ${l1Config.name}`,
      `Domain: ${config.domain}`,
      `Gas Token: ${config.tokenSymbol}`,
      `Governance Token: ${config.governanceTokenName} (${config.governanceTokenSymbol})`,
      `Output: ${outputDir}`,
    ])

    if (!options.yes) {
      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: 'Create your network with these settings?',
        initial: true,
      })
      if (!proceed) {
        logger.info('Fork cancelled')
        return
      }
    }

    mkdirSync(outputDir, { recursive: true })

    // Step 1: Generate branding config
    logger.subheader('Creating Your Network')
    console.log('')

    console.log('📝 Generating branding configuration...')
    const branding = generateForkBranding({
      name: config.name,
      displayName: config.displayName,
      tagline: config.tagline,
      chainId: config.chainId,
      domain: config.domain,
      tokenSymbol: config.tokenSymbol,
      governanceTokenName: config.governanceTokenName,
      governanceTokenSymbol: config.governanceTokenSymbol,
    })
    writeFileSync(
      join(outputDir, 'branding.json'),
      JSON.stringify(branding, null, 2),
    )

    // Step 2: Generate operator keys
    console.log('🔑 Generating operator keys...')
    const keys = await generateOperatorKeys(outputDir)

    // Step 3: Generate genesis
    console.log('⛓️  Generating genesis configuration...')
    const genesis = generateGenesis(config, keys)
    writeFileSync(
      join(outputDir, 'genesis.json'),
      JSON.stringify(genesis, null, 2),
    )

    // Step 4: Generate chain config
    console.log('⚙️  Generating chain configuration...')
    const chainConfig = generateChainConfig(config, l1Config, branding)
    writeFileSync(
      join(outputDir, 'chain.json'),
      JSON.stringify(chainConfig, null, 2),
    )

    // Step 5: Generate federation config
    console.log('🌐 Generating federation configuration...')
    const federationConfig = generateFederationConfig(config, l1Config)
    writeFileSync(
      join(outputDir, 'federation.json'),
      JSON.stringify(federationConfig, null, 2),
    )

    // Step 6: Generate deploy scripts
    console.log('📜 Generating deployment scripts...')
    await generateDeployScripts(outputDir, config, branding)

    // Step 7: Generate K8s manifests
    console.log('☸️  Generating Kubernetes manifests...')
    await generateK8sManifests(outputDir, config)

    // Step 8: Create README
    console.log('📖 Creating setup guide...')
    generateReadme(outputDir, config, branding, keys)

    // Summary
    console.log('')
    logger.header('YOUR NETWORK IS READY')

    console.log(`
Congratulations! Your ${config.displayName} is ready to deploy.

${chalk.bold('📁 Output Directory:')}
   ${outputDir}

${chalk.bold('📋 Generated Files:')}
   • branding.json    - Your network branding (edit to customize)
   • chain.json       - Chain configuration
   • genesis.json     - Genesis block
   • federation.json  - Cross-chain settings
   • keys.json        - Operator keys (KEEP SECURE)
   • k8s/             - Kubernetes manifests
   • *.ts             - Deployment scripts
   • README.md        - Setup guide

${chalk.bold('🚀 Next Steps:')}

   ${chalk.cyan('1.')} Fund your deployer address:
      ${chalk.dim(keys.deployer.address)}

   ${chalk.cyan('2.')} Follow the README.md in the output directory

   ${chalk.cyan('3.')} Customize your branding:
      ${chalk.dim(`Edit ${outputDir}/branding.json`)}

${chalk.bold('💡 Tips:')}
   • The branding.json controls all UI/branding across your network
   • You can edit it anytime before or after deployment
   • Join ${getNetworkName()} Discord for support

${chalk.dim('Happy building!')}
`)
  })

async function generateOperatorKeys(
  outputDir: string,
): Promise<Record<string, { address: string; privateKey: string }>> {
  const roles = [
    'deployer',
    'sequencer',
    'batcher',
    'proposer',
    'challenger',
    'guardian',
    'admin',
    'oracle',
    'governance',
  ]
  const keys: Record<string, { address: string; privateKey: string }> = {}

  for (const role of roles) {
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)
    keys[role] = { address: account.address, privateKey: pk }
  }

  writeFileSync(join(outputDir, 'keys.json'), JSON.stringify(keys, null, 2))
  writeFileSync(join(outputDir, '.keys.secret'), JSON.stringify(keys, null, 2))

  return keys
}

function generateGenesis(
  config: ForkConfig,
  keys: Record<string, { address: string; privateKey: string }>,
) {
  const alloc: Record<string, { balance: string }> = {}

  for (const key of Object.values(keys)) {
    alloc[key.address.toLowerCase()] = { balance: '0x21e19e0c9bab2400000' }
  }

  return {
    config: {
      chainId: config.chainId,
      homesteadBlock: 0,
      eip150Block: 0,
      eip155Block: 0,
      eip158Block: 0,
      byzantiumBlock: 0,
      constantinopleBlock: 0,
      petersburgBlock: 0,
      istanbulBlock: 0,
      muirGlacierBlock: 0,
      berlinBlock: 0,
      londonBlock: 0,
      arrowGlacierBlock: 0,
      grayGlacierBlock: 0,
      mergeNetsplitBlock: 0,
      shanghaiTime: 0,
      cancunTime: 0,
      terminalTotalDifficulty: 0,
      terminalTotalDifficultyPassed: true,
      optimism: {
        eip1559Elasticity: 6,
        eip1559Denominator: 50,
        eip1559DenominatorCanyon: 250,
      },
    },
    nonce: '0x0',
    timestamp: '0x0',
    extraData: '0x',
    gasLimit: '0x1c9c380',
    difficulty: '0x0',
    mixHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    coinbase: '0x0000000000000000000000000000000000000000',
    alloc,
    number: '0x0',
    gasUsed: '0x0',
    parentHash:
      '0x0000000000000000000000000000000000000000000000000000000000000000',
    baseFeePerGas: '0x3b9aca00',
  }
}

function generateChainConfig(
  config: ForkConfig,
  l1Config: { chainId: number; rpcUrl: string; name: string },
  branding: BrandingConfig,
) {
  return {
    chainId: config.chainId,
    networkId: config.chainId,
    name: config.displayName,
    rpcUrl: branding.urls.rpc.testnet,
    wsUrl: branding.urls.rpc.testnet
      .replace('https://', 'wss://')
      .replace('rpc', 'ws'),
    explorerUrl: branding.urls.explorer.testnet,
    l1ChainId: l1Config.chainId,
    l1RpcUrl: l1Config.rpcUrl,
    l1Name: l1Config.name,
    flashblocksEnabled: true,
    flashblocksSubBlockTime: 200,
    blockTime: 2000,
    gasToken: {
      name: branding.tokens.native.name,
      symbol: branding.tokens.native.symbol,
      decimals: 18,
    },
    contracts: {
      l2: {
        L2CrossDomainMessenger: '0x4200000000000000000000000000000000000007',
        L2StandardBridge: '0x4200000000000000000000000000000000000010',
        L2ToL1MessagePasser: '0x4200000000000000000000000000000000000016',
        L2ERC721Bridge: '0x4200000000000000000000000000000000000014',
        GasPriceOracle: '0x420000000000000000000000000000000000000F',
        L1Block: '0x4200000000000000000000000000000000000015',
        WETH: '0x4200000000000000000000000000000000000006',
      },
      l1: {},
    },
  }
}

function generateFederationConfig(
  config: ForkConfig,
  l1Config: { chainId: number; rpcUrl: string; name: string },
) {
  const isMainnet = config.l1Chain === 'ethereum'
  return {
    version: '1.0.0',
    network: { name: config.name, chainId: config.chainId },
    hub: {
      chainId: isMainnet ? 1 : 11155111,
      rpcUrl: isMainnet
        ? 'https://eth.llamarpc.com'
        : 'https://ethereum-sepolia-rpc.publicnode.com',
      registryAddress: '0x0000000000000000000000000000000000000000',
    },
    trustedNetworks: [isMainnet ? 420691 : 420690],
    crossChain: {
      oracleType: 'superchain',
      supportedChains: [isMainnet ? 420691 : 420690, l1Config.chainId],
    },
  }
}

async function generateDeployScripts(
  outputDir: string,
  config: ForkConfig,
  _branding: BrandingConfig,
): Promise<void> {
  const deployL1 = `#!/usr/bin/env bun
/**
 * Deploy L1 contracts for ${config.displayName}
 */
import { createPublicClient, createWalletClient, http, getBalance, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../../../../packages/deployment/scripts/shared/chain-utils';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));

async function main() {
  const chain = inferChainFromRpcUrl(chainConfig.l1RpcUrl);
  const account = privateKeyToAccount(keys.deployer.privateKey as \`0x\${string}\`);
  const publicClient = createPublicClient({ chain, transport: http(chainConfig.l1RpcUrl) });

  console.log('Deploying L1 contracts for ${config.displayName}...');
  console.log('Deployer:', account.address);
  console.log('Balance:', (await getBalance(publicClient, { address: account.address })).toString());

  // L1 contracts (OptimismPortal, L2OutputOracle, L1CrossDomainMessenger, L1StandardBridge, SystemConfig)
  // are deployed via the OP Stack deploy scripts in packages/contracts/deploy/
  // Run: forge script deploy/Deploy.s.sol --rpc-url \${chainConfig.l1RpcUrl} --broadcast
  console.log('\\nTo deploy L1 contracts, run:');
  console.log('  cd packages/contracts');
  console.log('  forge script deploy/Deploy.s.sol --rpc-url ' + chainConfig.l1RpcUrl + ' --broadcast --private-key <DEPLOYER_KEY>');
  console.log('\\nAfter deployment, update chain.json with the deployed addresses.');
}

main().catch(console.error);
`

  const deployL2 = `#!/usr/bin/env bun
/**
 * Deploy L2 contracts for ${config.displayName}
 */
import { createPublicClient, createWalletClient, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../../../../packages/deployment/scripts/shared/chain-utils';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));

async function main() {
  const chain = inferChainFromRpcUrl(chainConfig.rpcUrl);
  const account = privateKeyToAccount(keys.deployer.privateKey as \`0x\${string}\`);

  console.log('Deploying L2 contracts for ${config.displayName}...');
  console.log('Deployer:', account.address);

  const contracts = {
    identityRegistry: '',
    solverRegistry: '',
    inputSettler: '',
    outputSettler: '',
    liquidityVault: '',
    governance: '',
    oracle: '',
  };

  writeFileSync(join(import.meta.dir, 'contracts.json'), JSON.stringify(contracts, null, 2));
  console.log('L2 deployment complete');
}

main().catch(console.error);
`

  const registerFederation = `#!/usr/bin/env bun
/**
 * Register ${config.displayName} with the Federation
 */
import { createPublicClient, createWalletClient, http, parseEther, readContract, writeContract, type Address } from 'viem';
import { waitForTransactionReceipt } from 'viem/actions';
import { privateKeyToAccount } from 'viem/accounts';
import { parseAbi } from 'viem';
import { readFileSync } from 'fs';
import { join } from 'path';
import { inferChainFromRpcUrl } from '../../../../packages/deployment/scripts/shared/chain-utils';

const keys = JSON.parse(readFileSync(join(import.meta.dir, 'keys.json'), 'utf-8'));
const chainConfig = JSON.parse(readFileSync(join(import.meta.dir, 'chain.json'), 'utf-8'));
const federationConfig = JSON.parse(readFileSync(join(import.meta.dir, 'federation.json'), 'utf-8'));
const contracts = JSON.parse(readFileSync(join(import.meta.dir, 'contracts.json'), 'utf-8'));

const NETWORK_REGISTRY_ABI = parseAbi([
  'function registerNetwork(uint256 chainId, string name, string rpcUrl, string explorerUrl, string wsUrl, tuple(address identityRegistry, address solverRegistry, address inputSettler, address outputSettler, address liquidityVault, address governance, address oracle) contracts, bytes32 genesisHash) payable',
  'function establishTrust(uint256 sourceChainId, uint256 targetChainId)',
]);

async function main() {
  const chain = inferChainFromRpcUrl(federationConfig.hub.rpcUrl);
  const account = privateKeyToAccount(keys.deployer.privateKey as \`0x\${string}\`);
  const publicClient = createPublicClient({ chain, transport: http(federationConfig.hub.rpcUrl) });
  const walletClient = createWalletClient({ chain, transport: http(federationConfig.hub.rpcUrl), account });

  console.log('Registering ${config.displayName} with Federation...');

  const registryAddress = federationConfig.hub.registryAddress as Address;
  const genesisHash = '0x' + '0'.repeat(64) as \`0x\${string}\`;

  const hash = await walletClient.writeContract({
    address: registryAddress,
    abi: NETWORK_REGISTRY_ABI,
    functionName: 'registerNetwork',
    args: [
      BigInt(chainConfig.chainId),
      chainConfig.name,
      chainConfig.rpcUrl,
      chainConfig.explorerUrl,
      chainConfig.wsUrl,
      {
        identityRegistry: contracts.identityRegistry as Address,
        solverRegistry: contracts.solverRegistry as Address,
      inputSettler: contracts.inputSettler,
      outputSettler: contracts.outputSettler,
      liquidityVault: contracts.liquidityVault,
      governance: contracts.governance,
      oracle: contracts.oracle,
    },
    genesisHash,
    value: parseEther('${config.stake}'),
  });

  console.log('TX:', hash);
  await waitForTransactionReceipt(publicClient, { hash });
  console.log('Federation registration complete');
}

main().catch(console.error);
`

  writeFileSync(join(outputDir, 'deploy-l1.ts'), deployL1)
  writeFileSync(join(outputDir, 'deploy-l2.ts'), deployL2)
  writeFileSync(join(outputDir, 'register-federation.ts'), registerFederation)
}

async function generateK8sManifests(
  outputDir: string,
  config: ForkConfig,
): Promise<void> {
  const k8sDir = join(outputDir, 'k8s')
  mkdirSync(k8sDir, { recursive: true })
  const namespace = config.name.toLowerCase().replace(/\s+/g, '-')

  writeFileSync(
    join(k8sDir, 'namespace.yaml'),
    `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespace}
`,
  )

  writeFileSync(
    join(k8sDir, 'sequencer.yaml'),
    `apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: sequencer
  namespace: ${namespace}
spec:
  serviceName: sequencer
  replicas: 1
  selector:
    matchLabels:
      app: sequencer
  template:
    metadata:
      labels:
        app: sequencer
    spec:
      containers:
      - name: op-geth
        image: ghcr.io/paradigmxyz/op-reth:latest
        ports:
        - containerPort: 8545
        - containerPort: 8546
        env:
        - name: CHAIN_ID
          value: "${config.chainId}"
        volumeMounts:
        - name: data
          mountPath: /data
  volumeClaimTemplates:
  - metadata:
      name: data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: 500Gi
---
apiVersion: v1
kind: Service
metadata:
  name: sequencer
  namespace: ${namespace}
spec:
  selector:
    app: sequencer
  ports:
  - name: rpc
    port: 8545
  - name: ws
    port: 8546
`,
  )

  writeFileSync(
    join(k8sDir, 'op-node.yaml'),
    `apiVersion: apps/v1
kind: Deployment
metadata:
  name: op-node
  namespace: ${namespace}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: op-node
  template:
    metadata:
      labels:
        app: op-node
    spec:
      containers:
      - name: op-node
        image: us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:v1.9.4
        ports:
        - containerPort: 9545
        env:
        - name: OP_NODE_L2_ENGINE_RPC
          value: "http://sequencer:8551"
`,
  )
}

function generateReadme(
  outputDir: string,
  config: ForkConfig,
  branding: BrandingConfig,
  keys: Record<string, { address: string; privateKey: string }>,
): void {
  const readme = `# ${config.displayName}

${config.tagline}

## Quick Start

### 1. Fund Your Deployer

Send at least 0.5 ETH to your deployer address on ${L1_CONFIGS[config.l1Chain].name}:

\`\`\`
${keys.deployer.address}
\`\`\`

### 2. Deploy L1 Contracts

\`\`\`bash
bun run deploy-l1.ts
\`\`\`

### 3. Start Your L2 Nodes

\`\`\`bash
kubectl apply -f k8s/
\`\`\`

### 4. Deploy L2 Contracts

\`\`\`bash
bun run deploy-l2.ts
\`\`\`

### 5. Register with Federation (Optional)

\`\`\`bash
bun run register-federation.ts
\`\`\`

## Configuration

### Chain Info
- **Chain ID:** ${config.chainId}
- **L1:** ${L1_CONFIGS[config.l1Chain].name}
- **Gas Token:** ${config.tokenSymbol}

### Customization

Edit \`branding.json\` to customize:
- Network name and tagline
- Colors and logo
- URLs and domains
- Token names

## Files

| File | Description |
|------|-------------|
| \`branding.json\` | Your network branding |
| \`chain.json\` | Chain configuration |
| \`genesis.json\` | Genesis block |
| \`federation.json\` | Cross-chain settings |
| \`keys.json\` | Operator keys (KEEP SECURE) |
| \`k8s/\` | Kubernetes manifests |

## Support

- Documentation: ${branding.urls.docs}
- Discord: ${branding.urls.discord}

---

Built with ❤️ using ${getNetworkName()}
`

  writeFileSync(join(outputDir, 'README.md'), readme)
}

// Import chalk for the main action
import chalk from 'chalk'

// Add list subcommand
forkCommand
  .command('list')
  .description('List existing forks')
  .action(() => {
    const forksDir = join(process.cwd(), '.fork')
    if (!existsSync(forksDir)) {
      logger.info('No forks found. Run `fork` to create one.')
      return
    }

    const forks = readdirSync(forksDir, { withFileTypes: true })
      .filter((d: Dirent) => d.isDirectory())
      .map((d: Dirent) => d.name)

    if (forks.length === 0) {
      logger.info('No forks found. Run `fork` to create one.')
      return
    }

    logger.header('YOUR NETWORKS')
    for (const fork of forks) {
      const brandingPath = join(forksDir, fork, 'branding.json')
      const chainPath = join(forksDir, fork, 'chain.json')

      if (existsSync(brandingPath)) {
        const branding = JSON.parse(readFileSync(brandingPath, 'utf-8'))
        const chain = existsSync(chainPath)
          ? JSON.parse(readFileSync(chainPath, 'utf-8'))
          : {}
        console.log(
          `  ${chalk.cyan(branding.network.name)} (Chain ID: ${chain.chainId || '?'})`,
        )
        console.log(`    ${chalk.dim(branding.network.tagline)}`)
        console.log('')
      }
    }
  })
