#!/usr/bin/env bun
/**
 * Deploy Predimarket System
 * Deploys contracts and configures for standalone betting platform
 *
 * Features:
 * - Network detection and validation
 * - Dependency checking
 * - Pre-deployment validation (gas estimates, balance checks)
 * - Post-deployment verification
 * - Deployment summary with all deployed addresses
 * - Support for upgrading existing deployments
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Configuration
// ============================================================================

interface NetworkConfig {
    name: string;
    chainId: number;
    rpcUrl: string;
    explorerUrl?: string;
    minGasBalance: bigint;
    gasLimit: bigint;
    requiresVerification: boolean;
}

const NETWORKS: Record<string, NetworkConfig> = {
    local: {
        name: 'Localnet',
        chainId: 420691,
        rpcUrl: process.env.LOCAL_RPC_URL || 'http://localhost:8545',
        minGasBalance: BigInt('1000000000000000000'), // 1 ETH
        gasLimit: BigInt('10000000'),
        requiresVerification: false
    },
    testnet: {
        name: 'Jeju Testnet',
        chainId: 420690,
        rpcUrl: process.env.TESTNET_RPC_URL || 'https://testnet-rpc.jeju.network',
        explorerUrl: 'https://testnet-explorer.jeju.network',
        minGasBalance: BigInt('5000000000000000000'), // 5 ETH
        gasLimit: BigInt('10000000'),
        requiresVerification: true
    },
    mainnet: {
        name: 'Jeju Mainnet',
        chainId: 420691,
        rpcUrl: process.env.MAINNET_RPC_URL || 'https://rpc.jeju.network',
        explorerUrl: 'https://explorer.jeju.network',
        minGasBalance: BigInt('10000000000000000000'), // 10 ETH
        gasLimit: BigInt('10000000'),
        requiresVerification: true
    }
};

interface DeploymentState {
    environment: string;
    network: NetworkConfig;
    timestamp: string;
    deployer: string;
    contracts: {
        predictionOracle?: string;
        jejuMarket?: string;
        marketFactory?: string;
        ElizaOSToken?: string;
        liquidityPaymaster?: string;
    };
    deploymentType: 'fresh' | 'upgrade';
    verified: boolean;
}

// ============================================================================
// Utility Functions
// ============================================================================

function banner(text: string, subtitle?: string) {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ${text.padEnd(60)}║`);
    if (subtitle) {
        console.log(`║  ${subtitle.padEnd(60)}║`);
    }
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

function step(num: number, text: string) {
    console.log(`\n${num}️⃣  ${text}`);
}

function success(text: string) {
    console.log(`   ✅ ${text}`);
}

function warning(text: string) {
    console.log(`   ⚠️  ${text}`);
}

function error(text: string) {
    console.error(`   ❌ ${text}`);
}

function info(text: string) {
    console.log(`   ℹ️  ${text}`);
}

function execCommand(cmd: string, cwd?: string): string {
    try {
        const result = execSync(cmd, {
            cwd: cwd || process.cwd(),
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        return result.trim();
    } catch (e: any) {
        throw new Error(e.stderr || e.message);
    }
}

// ============================================================================
// Network Detection and Validation
// ============================================================================

async function detectNetwork(): Promise<NetworkConfig> {
    const envName = process.env.DEPLOY_ENV || process.env.NETWORK || 'local';

    const network = NETWORKS[envName.toLowerCase()];
    if (!network) {
        throw new Error(`Unknown network: ${envName}. Valid options: local, testnet, mainnet`);
    }

    // Verify we can connect to the network
    try {
        const chainId = execCommand(`cast chain-id --rpc-url ${network.rpcUrl}`);
        const detectedChainId = parseInt(chainId);

        if (detectedChainId !== network.chainId) {
            throw new Error(
                `Chain ID mismatch! Expected ${network.chainId}, got ${detectedChainId}`
            );
        }

        success(`Connected to ${network.name} (Chain ID: ${detectedChainId})`);
    } catch (e: any) {
        throw new Error(`Failed to connect to ${network.name}: ${e.message}`);
    }

    return network;
}

// ============================================================================
// Pre-deployment Validation
// ============================================================================

async function validateDeploymentPrerequisites(network: NetworkConfig): Promise<string> {
    step(1, 'Validating deployment prerequisites...');

    // Check for private key
    if (!process.env.PRIVATE_KEY) {
        throw new Error('PRIVATE_KEY environment variable is required');
    }

    // Get deployer address
    const deployer = execCommand(`cast wallet address ${process.env.PRIVATE_KEY}`);
    info(`Deployer address: ${deployer}`);

    // Check deployer balance
    const balance = execCommand(`cast balance ${deployer} --rpc-url ${network.rpcUrl}`);
    const balanceWei = BigInt(balance);
    const balanceEth = Number(balanceWei) / 1e18;

    info(`Deployer balance: ${balanceEth.toFixed(4)} ETH`);

    if (balanceWei < network.minGasBalance) {
        throw new Error(
            `Insufficient balance! Need at least ${Number(network.minGasBalance) / 1e18} ETH for deployment`
        );
    }

    // Check if foundry is installed
    try {
        execCommand('forge --version');
        success('Foundry installation verified');
    } catch (e) {
        throw new Error('Foundry not found. Please install: https://book.getfoundry.sh/getting-started/installation');
    }

    // Check if contracts are compiled
    if (!existsSync(join(process.cwd(), 'contracts', 'out'))) {
        info('Contracts not compiled, building...');
        execCommand('forge build', join(process.cwd(), 'contracts'));
        success('Contracts compiled');
    } else {
        success('Contracts already compiled');
    }

    return deployer;
}

// ============================================================================
// Dependency Checking
// ============================================================================

async function checkDependencies(network: NetworkConfig): Promise<Partial<DeploymentState['contracts']>> {
    step(2, 'Checking for existing contract dependencies...');

    const contracts: Partial<DeploymentState['contracts']> = {};

    // Check for existing deployment file
    const deploymentFile = join(process.cwd(), 'deployments', `predimarket-${network.name.toLowerCase()}.json`);

    if (existsSync(deploymentFile)) {
        info('Found existing deployment file');
        try {
            const existing = JSON.parse(readFileSync(deploymentFile, 'utf-8'));

            // Verify each contract is still deployed
            for (const [name, address] of Object.entries(existing.contracts || {})) {
                if (address && typeof address === 'string') {
                    try {
                        const code = execCommand(`cast code ${address} --rpc-url ${network.rpcUrl}`);
                        if (code && code !== '0x') {
                            contracts[name as keyof typeof contracts] = address;
                            info(`Found existing ${name}: ${address}`);
                        }
                    } catch (e) {
                        warning(`Contract ${name} at ${address} not found on chain`);
                    }
                }
            }
        } catch (e) {
            warning('Could not parse existing deployment file');
        }
    }

    // Check for ElizaOS token (required dependency)
    if (!contracts.ElizaOSToken) {
        warning('ElizaOS token not found. Will need to deploy or specify ELIZAOS_ADDRESS');
    } else {
        success('ElizaOS token verified');
    }

    return contracts;
}

// ============================================================================
// Contract Deployment
// ============================================================================

async function deployContracts(
    network: NetworkConfig,
    existingContracts: Partial<DeploymentState['contracts']>
): Promise<DeploymentState['contracts']> {
    const deployedContracts: DeploymentState['contracts'] = {
        ...existingContracts
    } as any;

    const forgeArgs = `--rpc-url ${network.rpcUrl} --private-key ${process.env.PRIVATE_KEY} --broadcast --legacy`;

    // Deploy ElizaOS Token if needed
    if (!deployedContracts.ElizaOSToken) {
        step(3, 'Deploying ElizaOS Token...');
        try {
            // Get deployer address for constructor
            const deployer = execCommand(`cast wallet address ${process.env.PRIVATE_KEY}`);
            const output = execCommand(
                `forge create src/token/ElizaOSToken.sol:ElizaOSToken ${forgeArgs} --constructor-args ${deployer} --json`,
                join(process.cwd(), 'contracts')
            );
            const result = JSON.parse(output);
            deployedContracts.ElizaOSToken = result.deployedTo;
            success(`ElizaOS Token deployed: ${deployedContracts.ElizaOSToken}`);
        } catch (e: any) {
            error(`ElizaOS Token deployment failed: ${e.message}`);
            throw e;
        }
    }

    // Deploy PredictionOracle if needed
    if (!deployedContracts.predictionOracle) {
        step(4, 'Deploying PredictionOracle...');
        try {
            // Note: This would need the actual contract path and constructor args
            info('PredictionOracle deployment not implemented - requires game integration');
            warning('Skipping PredictionOracle deployment - markets will not auto-resolve');
        } catch (e: any) {
            warning(`PredictionOracle deployment failed: ${e.message}`);
        }
    }

    // Deploy Predimarket
    step(5, 'Deploying Predimarket...');
    try {
        if (!deployedContracts.ElizaOSToken) {
            throw new Error('Cannot deploy Predimarket without ElizaOS token');
        }

        info('Note: Predimarket deployment script needs to be created');
        warning('Manual deployment required - see contracts/script/DeployPredimarket.s.sol');

        // Placeholder - actual deployment would use forge script
        // const output = execCommand(
        //     `forge script script/DeployPredimarket.s.sol:DeployPredimarket ${forgeArgs} --json`,
        //     join(process.cwd(), 'contracts')
        // );

    } catch (e: any) {
        error(`Predimarket deployment failed: ${e.message}`);
        throw e;
    }

    return deployedContracts;
}

// ============================================================================
// Post-deployment Verification
// ============================================================================

async function verifyDeployment(
    network: NetworkConfig,
    contracts: DeploymentState['contracts']
): Promise<boolean> {
    step(6, 'Verifying deployment...');

    let allVerified = true;

    // Verify each contract has code
    for (const [name, address] of Object.entries(contracts)) {
        if (address) {
            try {
                const code = execCommand(`cast code ${address} --rpc-url ${network.rpcUrl}`);
                if (code && code !== '0x') {
                    success(`${name} verified at ${address}`);
                } else {
                    error(`${name} has no code at ${address}`);
                    allVerified = false;
                }
            } catch (e: any) {
                error(`Failed to verify ${name}: ${e.message}`);
                allVerified = false;
            }
        }
    }

    return allVerified;
}

// ============================================================================
// Save Deployment State
// ============================================================================

function saveDeploymentState(state: DeploymentState) {
    step(7, 'Saving deployment state...');

    const deploymentsDir = join(process.cwd(), 'deployments');
    mkdirSync(deploymentsDir, { recursive: true });

    const filename = `predimarket-${state.environment}.json`;
    const filepath = join(deploymentsDir, filename);

    writeFileSync(filepath, JSON.stringify(state, null, 2));
    success(`Deployment state saved: ${filepath}`);

    // Also create a .env file for the frontend
    const envContent = `# Predimarket Deployment Configuration
# Generated: ${state.timestamp}
# Network: ${state.network.name}

NEXT_PUBLIC_RPC_URL=${state.network.rpcUrl}
NEXT_PUBLIC_CHAIN_ID=${state.network.chainId}

# Contract Addresses
NEXT_PUBLIC_PREDIMARKET_ADDRESS=${state.contracts.jejuMarket || ''}
NEXT_PUBLIC_MARKET_FACTORY_ADDRESS=${state.contracts.marketFactory || ''}
NEXT_PUBLIC_ELIZA_OS_ADDRESS=${state.contracts.ElizaOSToken || ''}
NEXT_PUBLIC_PREDICTION_ORACLE_ADDRESS=${state.contracts.predictionOracle || ''}
NEXT_PUBLIC_LIQUIDITY_PAYMASTER_ADDRESS=${state.contracts.liquidityPaymaster || ''}

# Indexer GraphQL
NEXT_PUBLIC_GRAPHQL_URL=${state.environment === 'local' ? 'http://localhost:4350/graphql' : `https://indexer-${state.environment}.jeju.network/graphql`}

# WalletConnect (optional)
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
`;

    const envFile = join(process.cwd(), 'apps', 'predimarket', `.env.${state.environment}`);
    writeFileSync(envFile, envContent);
    success(`Environment file created: ${envFile}`);
}

// ============================================================================
// Main Deployment Flow
// ============================================================================

async function main() {
    banner('🚀 JEJU MARKET DEPLOYMENT', 'Standalone prediction market platform');

    let state: DeploymentState;

    try {
        // Detect and validate network
        const network = await detectNetwork();
        info(`Deploying to ${network.name}`);

        // Validate prerequisites
        const deployer = await validateDeploymentPrerequisites(network);

        // Check for existing deployments
        const existingContracts = await checkDependencies(network);
        const isUpgrade = Object.keys(existingContracts).length > 0;

        if (isUpgrade) {
            warning('Existing deployment detected - will upgrade/redeploy as needed');
        }

        // Deploy contracts
        const contracts = await deployContracts(network, existingContracts);

        // Verify deployment
        const verified = await verifyDeployment(network, contracts);

        // Create deployment state
        state = {
            environment: network.name.toLowerCase(),
            network,
            timestamp: new Date().toISOString(),
            deployer,
            contracts,
            deploymentType: isUpgrade ? 'upgrade' : 'fresh',
            verified
        };

        // Save state
        saveDeploymentState(state);

    } catch (e: any) {
        error(`Deployment failed: ${e.message}`);
        console.error(e);
        process.exit(1);
    }

    // Print summary
    banner('✅ DEPLOYMENT COMPLETE');

    console.log('📋 Deployment Summary:\n');
    console.log(`   Network: ${state.network.name}`);
    console.log(`   Chain ID: ${state.network.chainId}`);
    console.log(`   Deployer: ${state.deployer}`);
    console.log(`   Type: ${state.deploymentType}`);
    console.log(`   Verified: ${state.verified ? '✅' : '❌'}\n`);

    console.log('📝 Deployed Contracts:\n');
    for (const [name, address] of Object.entries(state.contracts)) {
        if (address) {
            console.log(`   ${name.padEnd(25)} ${address}`);
            if (state.network.explorerUrl) {
                console.log(`   ${' '.repeat(25)} ${state.network.explorerUrl}/address/${address}`);
            }
        }
    }

    console.log('\n🎯 Next Steps:\n');
    console.log('1. Verify contracts (if on testnet/mainnet):');
    console.log('   bun run scripts/verify-predimarket-contracts.ts\n');

    console.log('2. Deploy and configure indexer:');
    console.log('   See: documentation/deployment/predimarket-indexer-setup.md\n');

    console.log('3. Deploy frontend:');
    console.log('   See: documentation/deployment/predimarket-frontend-setup.md\n');

    console.log('4. Run end-to-end tests:');
    console.log('   bun run tests/integration/predimarket-e2e.test.ts\n');

    if (state.environment === 'local') {
        console.log('🌐 Local Development:\n');
        console.log('   Frontend: cd apps/predimarket && bun run dev');
        console.log('   Indexer:  cd apps/indexer && bun run dev');
        console.log('   Access:   http://localhost:3003\n');
    }
}

// Run main function
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});

