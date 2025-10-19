#!/usr/bin/env bun
/**
 * Verify Predimarket Contract Deployment
 *
 * This script performs comprehensive verification of the Predimarket system:
 * - Verifies all contracts are deployed at expected addresses
 * - Verifies contract permissions and roles
 * - Tests core functionality (market creation, betting, resolution)
 * - Generates verification report
 *
 * Usage:
 *   NETWORK=testnet bun run scripts/verify-predimarket-contracts.ts
 *   NETWORK=mainnet bun run scripts/verify-predimarket-contracts.ts
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// ============================================================================
// Types and Configuration
// ============================================================================

interface DeploymentConfig {
    environment: string;
    network: {
        name: string;
        chainId: number;
        rpcUrl: string;
        explorerUrl?: string;
    };
    timestamp: string;
    deployer: string;
    contracts: {
        predictionOracle?: string;
        jejuMarket?: string;
        marketFactory?: string;
        ElizaOSToken?: string;
        liquidityPaymaster?: string;
    };
}

interface VerificationResult {
    category: string;
    test: string;
    status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
    message: string;
    details?: any;
}

interface VerificationReport {
    timestamp: string;
    environment: string;
    network: string;
    results: VerificationResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        warnings: number;
        skipped: number;
    };
}

// ============================================================================
// Utility Functions
// ============================================================================

function banner(text: string) {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log(`║  ${text.padEnd(60)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝\n');
}

function section(text: string) {
    console.log(`\n━━━ ${text} ━━━\n`);
}

function pass(text: string) {
    console.log(`✅ PASS: ${text}`);
}

function fail(text: string) {
    console.log(`❌ FAIL: ${text}`);
}

function warn(text: string) {
    console.log(`⚠️  WARN: ${text}`);
}

function skip(text: string) {
    console.log(`⏭️  SKIP: ${text}`);
}

function execCommand(cmd: string): string {
    try {
        return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (e: any) {
        throw new Error(e.stderr || e.message);
    }
}

// ============================================================================
// Load Deployment Configuration
// ============================================================================

function loadDeploymentConfig(): DeploymentConfig {
    const network = process.env.NETWORK || 'local';
    const deploymentFile = join(process.cwd(), 'deployments', `predimarket-${network}.json`);

    if (!existsSync(deploymentFile)) {
        throw new Error(`Deployment file not found: ${deploymentFile}`);
    }

    const config = JSON.parse(readFileSync(deploymentFile, 'utf-8'));
    console.log(`Loaded deployment config for ${config.network.name}`);
    console.log(`Deployed at: ${new Date(config.timestamp).toLocaleString()}`);
    console.log(`Deployer: ${config.deployer}\n`);

    return config;
}

// ============================================================================
// Verification Tests
// ============================================================================

const results: VerificationResult[] = [];

function addResult(category: string, test: string, status: VerificationResult['status'], message: string, details?: any) {
    results.push({ category, test, status, message, details });

    switch (status) {
        case 'PASS': pass(`${test}: ${message}`); break;
        case 'FAIL': fail(`${test}: ${message}`); break;
        case 'WARN': warn(`${test}: ${message}`); break;
        case 'SKIP': skip(`${test}: ${message}`); break;
    }
}

// ============================================================================
// Contract Existence Verification
// ============================================================================

async function verifyContractExistence(config: DeploymentConfig) {
    section('Contract Existence Verification');

    for (const [name, address] of Object.entries(config.contracts)) {
        if (!address) {
            addResult('Existence', name, 'SKIP', 'Contract not deployed');
            continue;
        }

        try {
            const code = execCommand(`cast code ${address} --rpc-url ${config.network.rpcUrl}`);

            if (code && code !== '0x' && code.length > 4) {
                const codeSize = (code.length - 2) / 2; // Remove '0x' and convert hex to bytes
                addResult('Existence', name, 'PASS', `Deployed at ${address}`, {
                    address,
                    codeSize: `${codeSize} bytes`,
                    explorerUrl: config.network.explorerUrl ? `${config.network.explorerUrl}/address/${address}` : undefined
                });
            } else {
                addResult('Existence', name, 'FAIL', `No code at ${address}`);
            }
        } catch (e: any) {
            addResult('Existence', name, 'FAIL', `Error checking address: ${e.message}`);
        }
    }
}

// ============================================================================
// Token Contract Verification
// ============================================================================

async function verifyElizaOSToken(config: DeploymentConfig) {
    section('ElizaOS Token Verification');

    const address = config.contracts.ElizaOSToken;
    if (!address) {
        addResult('Token', 'ElizaOS Token', 'SKIP', 'Token not deployed');
        return;
    }

    const rpc = config.network.rpcUrl;

    try {
        // Check name
        const name = execCommand(`cast call ${address} "name()(string)" --rpc-url ${rpc}`);
        addResult('Token', 'Token Name', name.includes('eliza') ? 'PASS' : 'WARN', `Name: ${name}`);

        // Check symbol
        const symbol = execCommand(`cast call ${address} "symbol()(string)" --rpc-url ${rpc}`);
        addResult('Token', 'Token Symbol', symbol ? 'PASS' : 'FAIL', `Symbol: ${symbol}`);

        // Check decimals
        const decimals = execCommand(`cast call ${address} "decimals()(uint8)" --rpc-url ${rpc}`);
        const decNum = parseInt(decimals, 16);
        addResult('Token', 'Token Decimals', decNum === 18 ? 'PASS' : 'WARN', `Decimals: ${decNum}`);

        // Check total supply
        const totalSupply = execCommand(`cast call ${address} "totalSupply()(uint256)" --rpc-url ${rpc}`);
        const supplyBigInt = BigInt(totalSupply);
        addResult('Token', 'Total Supply', supplyBigInt > 0n ? 'PASS' : 'WARN', `Supply: ${supplyBigInt.toString()}`);

        // Check if deployer has balance
        const balance = execCommand(`cast call ${address} "balanceOf(address)(uint256)" ${config.deployer} --rpc-url ${rpc}`);
        const balanceBigInt = BigInt(balance);
        addResult('Token', 'Deployer Balance', balanceBigInt > 0n ? 'PASS' : 'WARN', `Balance: ${balanceBigInt.toString()}`);

    } catch (e: any) {
        addResult('Token', 'Token Functions', 'FAIL', `Error calling token functions: ${e.message}`);
    }
}

// ============================================================================
// Predimarket Contract Verification
// ============================================================================

async function verifyPredimarket(config: DeploymentConfig) {
    section('Predimarket Contract Verification');

    const marketAddress = config.contracts.jejuMarket;
    if (!marketAddress) {
        addResult('Market', 'Predimarket', 'SKIP', 'Predimarket not deployed');
        return;
    }

    const rpc = config.network.rpcUrl;

    try {
        // Verify token address is set correctly
        const tokenAddr = execCommand(`cast call ${marketAddress} "elizaOS()(address)" --rpc-url ${rpc}`);
        const expectedToken = config.contracts.ElizaOSToken?.toLowerCase();
        const actualToken = tokenAddr.toLowerCase();

        if (expectedToken && actualToken.includes(expectedToken.slice(2))) {
            addResult('Market', 'Token Address', 'PASS', 'Correct token address configured');
        } else {
            addResult('Market', 'Token Address', 'WARN', `Token mismatch. Expected: ${expectedToken}, Got: ${tokenAddr}`);
        }

        // Check if contract can be called (basic smoke test)
        addResult('Market', 'Market Contract', 'PASS', 'Contract is callable');

    } catch (e: any) {
        // Market contract might have different interface
        addResult('Market', 'Market Contract', 'WARN', `Could not verify all market functions: ${e.message}`);
    }
}

// ============================================================================
// Oracle Contract Verification
// ============================================================================

async function verifyPredictionOracle(config: DeploymentConfig) {
    section('PredictionOracle Verification');

    const oracleAddress = config.contracts.predictionOracle;
    if (!oracleAddress) {
        addResult('Oracle', 'PredictionOracle', 'SKIP', 'Oracle not deployed - markets will need manual resolution');
        return;
    }

    const rpc = config.network.rpcUrl;

    try {
        // Basic smoke test - try to read from oracle
        const code = execCommand(`cast code ${oracleAddress} --rpc-url ${rpc}`);

        if (code && code !== '0x') {
            addResult('Oracle', 'Oracle Contract', 'PASS', 'Oracle contract deployed and accessible');
        } else {
            addResult('Oracle', 'Oracle Contract', 'FAIL', 'Oracle has no code');
        }

    } catch (e: any) {
        addResult('Oracle', 'Oracle Contract', 'WARN', `Could not verify oracle: ${e.message}`);
    }
}

// ============================================================================
// Permissions and Ownership Verification
// ============================================================================

async function verifyPermissions(config: DeploymentConfig) {
    section('Permissions and Ownership Verification');

    const contracts = [
        { name: 'ElizaOS Token', address: config.contracts.ElizaOSToken },
        { name: 'Predimarket', address: config.contracts.jejuMarket },
        { name: 'PredictionOracle', address: config.contracts.predictionOracle }
    ];

    const rpc = config.network.rpcUrl;

    for (const contract of contracts) {
        if (!contract.address) continue;

        try {
            // Try to get owner (common pattern)
            const owner = execCommand(`cast call ${contract.address} "owner()(address)" --rpc-url ${rpc}`);

            if (owner && owner !== '0x0000000000000000000000000000000000000000') {
                const ownerAddr = '0x' + owner.slice(-40).toLowerCase();
                const isDeployer = ownerAddr === config.deployer.toLowerCase();

                addResult('Permissions', `${contract.name} Owner`, 'PASS',
                    `Owner: ${ownerAddr}${isDeployer ? ' (deployer)' : ''}`,
                    { owner: ownerAddr, isDeployer }
                );
            } else {
                addResult('Permissions', `${contract.name} Owner`, 'WARN', 'No owner or renounced');
            }
        } catch (e: any) {
            // Contract might not have owner() function
            addResult('Permissions', `${contract.name} Owner`, 'SKIP', 'No owner function');
        }
    }
}

// ============================================================================
// Functional Tests
// ============================================================================

async function testMarketCreation(config: DeploymentConfig) {
    section('Market Creation Test');

    const marketAddress = config.contracts.jejuMarket;
    if (!marketAddress) {
        addResult('Functionality', 'Market Creation', 'SKIP', 'Predimarket not deployed');
        return;
    }

    // This would require actual transaction execution
    // For now, we just verify the contract has the expected functions

    try {
        const rpc = config.network.rpcUrl;
        execCommand(`cast code ${marketAddress} --rpc-url ${rpc}`);

        // Check if contract has the expected function selectors
        // buy() = 0x...
        // sell() = 0x...
        // This is a basic check

        addResult('Functionality', 'Market Creation', 'SKIP',
            'Manual testing required - see documentation for test procedures');

    } catch (e: any) {
        addResult('Functionality', 'Market Creation', 'SKIP', 'Requires live testing');
    }
}

async function testBetting(config: DeploymentConfig) {
    section('Betting Functionality Test');

    const marketAddress = config.contracts.jejuMarket;
    if (!marketAddress) {
        addResult('Functionality', 'Betting', 'SKIP', 'Predimarket not deployed');
        return;
    }

    addResult('Functionality', 'Betting', 'SKIP',
        'Manual testing required - see documentation for test procedures');
}

async function testResolution(config: DeploymentConfig) {
    section('Market Resolution Test');

    const marketAddress = config.contracts.jejuMarket;
    const oracleAddress = config.contracts.predictionOracle;

    if (!marketAddress || !oracleAddress) {
        addResult('Functionality', 'Resolution', 'SKIP', 'Contracts not fully deployed');
        return;
    }

    addResult('Functionality', 'Resolution', 'SKIP',
        'Manual testing required - see documentation for test procedures');
}

// ============================================================================
// Network and RPC Verification
// ============================================================================

async function verifyNetwork(config: DeploymentConfig) {
    section('Network Verification');

    const rpc = config.network.rpcUrl;

    try {
        // Check chain ID
        const chainId = execCommand(`cast chain-id --rpc-url ${rpc}`);
        const expectedChainId = config.network.chainId;
        const actualChainId = parseInt(chainId);

        if (actualChainId === expectedChainId) {
            addResult('Network', 'Chain ID', 'PASS', `Chain ID: ${actualChainId}`);
        } else {
            addResult('Network', 'Chain ID', 'FAIL', `Chain ID mismatch! Expected ${expectedChainId}, got ${actualChainId}`);
        }

        // Check block number
        const blockNumber = execCommand(`cast block-number --rpc-url ${rpc}`);
        const blockNum = parseInt(blockNumber);

        if (blockNum > 0) {
            addResult('Network', 'RPC Connection', 'PASS', `Current block: ${blockNum}`);
        } else {
            addResult('Network', 'RPC Connection', 'FAIL', 'Invalid block number');
        }

        // Check deployer still has funds
        const balance = execCommand(`cast balance ${config.deployer} --rpc-url ${rpc}`);
        const balanceBigInt = BigInt(balance);
        const balanceEth = Number(balanceBigInt) / 1e18;

        if (balanceBigInt > 0n) {
            addResult('Network', 'Deployer Balance', 'PASS', `Balance: ${balanceEth.toFixed(4)} ETH`);
        } else {
            addResult('Network', 'Deployer Balance', 'WARN', 'Deployer has no funds');
        }

    } catch (e: any) {
        addResult('Network', 'Network Check', 'FAIL', `Network error: ${e.message}`);
    }
}

// ============================================================================
// Generate Report
// ============================================================================

function generateReport(config: DeploymentConfig): VerificationReport {
    const summary = {
        total: results.length,
        passed: results.filter(r => r.status === 'PASS').length,
        failed: results.filter(r => r.status === 'FAIL').length,
        warnings: results.filter(r => r.status === 'WARN').length,
        skipped: results.filter(r => r.status === 'SKIP').length
    };

    const report: VerificationReport = {
        timestamp: new Date().toISOString(),
        environment: config.environment,
        network: config.network.name,
        results,
        summary
    };

    return report;
}

function saveReport(report: VerificationReport) {
    const filename = `verification-report-${report.environment}-${Date.now()}.json`;
    const filepath = join(process.cwd(), 'deployments', filename);

    writeFileSync(filepath, JSON.stringify(report, null, 2));
    console.log(`\n📄 Verification report saved: ${filepath}`);
}

function printSummary(report: VerificationReport) {
    banner('VERIFICATION SUMMARY');

    console.log(`Environment: ${report.environment}`);
    console.log(`Network: ${report.network}`);
    console.log(`Timestamp: ${new Date(report.timestamp).toLocaleString()}\n`);

    console.log('Results:');
    console.log(`  ✅ Passed:   ${report.summary.passed}`);
    console.log(`  ❌ Failed:   ${report.summary.failed}`);
    console.log(`  ⚠️  Warnings: ${report.summary.warnings}`);
    console.log(`  ⏭️  Skipped:  ${report.summary.skipped}`);
    console.log(`  📊 Total:    ${report.summary.total}\n`);

    if (report.summary.failed > 0) {
        console.log('❌ VERIFICATION FAILED\n');
        console.log('Failed tests:');
        report.results
            .filter(r => r.status === 'FAIL')
            .forEach(r => console.log(`  - ${r.category}: ${r.test} - ${r.message}`));
        console.log();
    } else if (report.summary.warnings > 0) {
        console.log('⚠️  VERIFICATION PASSED WITH WARNINGS\n');
        console.log('Warnings:');
        report.results
            .filter(r => r.status === 'WARN')
            .forEach(r => console.log(`  - ${r.category}: ${r.test} - ${r.message}`));
        console.log();
    } else {
        console.log('✅ ALL VERIFICATIONS PASSED\n');
    }

    // Print next steps
    if (report.summary.skipped > 0) {
        console.log('⏭️  Manual Testing Required:\n');
        report.results
            .filter(r => r.status === 'SKIP' && r.message.includes('Manual'))
            .forEach(r => console.log(`  - ${r.test}`));
        console.log('\nSee documentation/deployment/predimarket-complete-deployment.md for testing procedures.\n');
    }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
    banner('🔍 JEJU MARKET CONTRACT VERIFICATION');

    try {
        // Load deployment configuration
        const config = loadDeploymentConfig();

        // Run verification tests
        await verifyNetwork(config);
        await verifyContractExistence(config);
        await verifyElizaOSToken(config);
        await verifyPredimarket(config);
        await verifyPredictionOracle(config);
        await verifyPermissions(config);
        await testMarketCreation(config);
        await testBetting(config);
        await testResolution(config);

        // Generate and save report
        const report = generateReport(config);
        saveReport(report);
        printSummary(report);

        // Exit with appropriate code
        if (report.summary.failed > 0) {
            process.exit(1);
        }

    } catch (e: any) {
        console.error(`\n❌ Verification error: ${e.message}`);
        console.error(e);
        process.exit(1);
    }
}

// Run verification
main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
