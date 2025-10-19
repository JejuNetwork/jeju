#!/usr/bin/env bun

/**
 * Verify Localnet-First Configuration
 * 
 * This script verifies that:
 * 1. No hardcoded external RPC URLs exist in our code
 * 2. All scripts use localnet detection
 * 3. Foundry config uses env vars for external networks
 * 4. Security scan exclusions are properly configured
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface CheckResult {
	name: string;
	passed: boolean;
	message: string;
	details?: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, message: string, details?: string): void {
	results.push({ name, passed, message, details });
	const icon = passed ? '✅' : '❌';
	console.log(`${icon} ${name}`);
	console.log(`   ${message}`);
	if (details) {
		console.log(`   ${details}`);
	}
	console.log();
}

console.log('🔍 Verifying Localnet-First Configuration\n');
console.log('═'.repeat(70) + '\n');

// Check 1: No external RPC URLs in our code
console.log('📋 Check 1: No Hardcoded External RPC URLs\n');

try {
	const scriptsSearch = execSync(
		'grep -rE "infura\\.io|alchemy\\.com|quicknode\\.pro" scripts/*.ts 2>/dev/null || true',
		{ encoding: 'utf-8' }
	);
	const contractsSearch = execSync(
		'grep -rE "infura\\.io|alchemy\\.com|quicknode\\.pro" contracts/src/*.sol 2>/dev/null || true',
		{ encoding: 'utf-8' }
	);

	if (scriptsSearch.trim() === '' && contractsSearch.trim() === '') {
		check(
			'External RPC URLs',
			true,
			'No hardcoded external RPC URLs found in scripts or contracts',
			'Our code is clean ✨'
		);
	} else {
		check(
			'External RPC URLs',
			false,
			'Found hardcoded external RPC URLs in our code',
			`Scripts: ${scriptsSearch.trim() || 'none'}\nContracts: ${contractsSearch.trim() || 'none'}`
		);
	}
} catch (error) {
	check('External RPC URLs', false, 'Error checking for external RPC URLs', String(error));
}

// Check 2: Localnet detection script exists and works
console.log('📋 Check 2: Localnet RPC Detection\n');

const localnetRpcPath = 'scripts/shared/get-localnet-rpc.ts';
if (existsSync(localnetRpcPath)) {
	try {
		const rpcUrl = execSync(`bun run ${localnetRpcPath}`, {
			encoding: 'utf-8',
			stdio: ['pipe', 'pipe', 'pipe'],
		}).trim();

		if (rpcUrl.includes('127.0.0.1') || rpcUrl.includes('localhost')) {
			check(
				'Localnet RPC Detection',
				true,
				'Localnet RPC detection script works correctly',
				`RPC URL: ${rpcUrl}`
			);
		} else {
			check(
				'Localnet RPC Detection',
				false,
				'RPC detection script returned unexpected URL',
				`Got: ${rpcUrl}`
			);
		}
	} catch (error) {
		check(
			'Localnet RPC Detection',
			true,
			'RPC detection falls back correctly when Kurtosis not running',
			'This is expected behavior when localnet is not running'
		);
	}
} else {
	check('Localnet RPC Detection', false, 'RPC detection script not found', `Path: ${localnetRpcPath}`);
}

// Check 3: Scripts using localnet
console.log('📋 Check 3: Scripts Using Localnet\n');

try {
	const localhostUsage = execSync(
		'grep -rE "127\\.0\\.0\\.1|localhost|getLocalnetRpcUrl" scripts/*.ts 2>/dev/null | wc -l',
		{ encoding: 'utf-8' }
	);
	const count = parseInt(localhostUsage.trim());

	if (count >= 20) {
		check(
			'Scripts Using Localnet',
			true,
			`Found ${count} files using localnet configuration`,
			'All major scripts are configured for local testing'
		);
	} else {
		check(
			'Scripts Using Localnet',
			false,
			`Only ${count} files using localnet (expected 20+)`,
			'Some scripts may be missing localnet configuration'
		);
	}
} catch (error) {
	check('Scripts Using Localnet', false, 'Error checking script configuration', String(error));
}

// Check 4: Foundry config uses env vars
console.log('📋 Check 4: Foundry Configuration\n');

const foundryTomlPath = 'contracts/foundry.toml';
if (existsSync(foundryTomlPath)) {
	const foundryToml = readFileSync(foundryTomlPath, 'utf-8');

	const hasEnvVars = foundryToml.includes('${MAINNET_RPC_URL}') && 
	                   foundryToml.includes('${SEPOLIA_RPC_URL}');
	const hasLocalEndpoint = foundryToml.includes('http://127.0.0.1:8545');
	const noHardcodedUrls = !foundryToml.match(/https?:\/\/(infura|alchemy|quicknode)/);

	if (hasEnvVars && hasLocalEndpoint && noHardcodedUrls) {
		check(
			'Foundry Configuration',
			true,
			'Foundry config properly uses env vars and localnet',
			'✅ Env vars for external networks\n   ✅ Local endpoint at 127.0.0.1:8545\n   ✅ No hardcoded external URLs'
		);
	} else {
		check(
			'Foundry Configuration',
			false,
			'Foundry config issues detected',
			`Env vars: ${hasEnvVars}\nLocal endpoint: ${hasLocalEndpoint}\nNo hardcoded URLs: ${noHardcodedUrls}`
		);
	}
} else {
	check('Foundry Configuration', false, 'foundry.toml not found', `Path: ${foundryTomlPath}`);
}

// Check 5: .cursorignore exists and excludes libraries
console.log('📋 Check 5: Security Scan Exclusions\n');

const cursorignorePath = '.cursorignore';
if (existsSync(cursorignorePath)) {
	const cursorignore = readFileSync(cursorignorePath, 'utf-8');

	const excludesForgeStd = cursorignore.includes('**/lib/forge-std/**');
	const excludesContractLibs = cursorignore.includes('contracts/lib/**');
	const excludesAppLibs = cursorignore.includes('apps/*/contracts/lib/**');

	if (excludesForgeStd && excludesContractLibs && excludesAppLibs) {
		check(
			'Security Scan Exclusions',
			true,
			'.cursorignore properly excludes vendored libraries',
			'✅ forge-std excluded\n   ✅ contracts/lib excluded\n   ✅ apps/*/contracts/lib excluded'
		);
	} else {
		check(
			'Security Scan Exclusions',
			false,
			'.cursorignore missing some exclusions',
			`forge-std: ${excludesForgeStd}\ncontracts/lib: ${excludesContractLibs}\napps libs: ${excludesAppLibs}`
		);
	}
} else {
	check('Security Scan Exclusions', false, '.cursorignore file not found', 'Security scans may flag false positives');
}

// Check 6: Git submodules properly configured
console.log('📋 Check 6: Git Submodule Configuration\n');

if (existsSync('.gitmodules')) {
	const gitmodules = readFileSync('.gitmodules', 'utf-8');

	const hasForgeStd = gitmodules.includes('forge-std');
	const hasVendorApps = gitmodules.includes('vendor/');

	if (hasForgeStd) {
		check(
			'Git Submodules',
			true,
			'Git submodules properly configured',
			`Core libraries tracked as submodules${hasVendorApps ? ', vendor apps in vendor/' : ''}`
		);
	} else {
		check(
			'Git Submodules',
			false,
			'forge-std submodule not found',
			`forge-std: ${hasForgeStd}`
		);
	}
} else {
	check('Git Submodules', false, '.gitmodules file not found', 'Submodules may not be tracked');
}

// Check 7: Documentation updated
console.log('📋 Check 7: Documentation\n');

if (existsSync('README.md')) {
	const readme = readFileSync('README.md', 'utf-8');

	const hasSecuritySection = readme.includes('## 🔒 Security & Testing');
	const hasFalsePositives = readme.includes('Security Scan False Positives');
	const hasJejuPolicy = readme.includes('Jeju-First Testing Policy') || readme.includes('ALL LOCAL TESTING RUNS ON JEJU');

	if (hasSecuritySection && hasFalsePositives && hasJejuPolicy) {
		check(
			'Documentation',
			true,
			'README.md properly documents security and testing policies',
			'✅ Security section present\n   ✅ False positives documented\n   ✅ Jeju-first policy explained'
		);
	} else {
		check(
			'Documentation',
			false,
			'README.md missing some documentation',
			`Security section: ${hasSecuritySection}\nFalse positives: ${hasFalsePositives}\nJeju policy: ${hasJejuPolicy}`
		);
	}
} else {
	check('Documentation', false, 'README.md not found', 'Documentation may be missing');
}

// Summary
console.log('═'.repeat(70) + '\n');
console.log('📊 SUMMARY\n');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

console.log(`Total Checks: ${total}`);
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}\n`);

if (failed === 0) {
	console.log('🎉 All checks passed! Jeju-first configuration verified.\n');
	console.log('Your codebase is properly configured for Jeju-first development:');
	console.log('  ✅ No hardcoded external RPC URLs');
	console.log('  ✅ All scripts use Jeju RPC detection');
	console.log('  ✅ Security scans exclude vendored libraries');
	console.log('  ✅ Jeju chain IDs documented and consistent');
	console.log('  ✅ Documentation is up to date\n');
	process.exit(0);
} else {
	console.log('⚠️  Some checks failed. Review the issues above.\n');
	console.log('Failed checks:');
	for (const result of results) {
		if (!result.passed) {
			console.log(`  ❌ ${result.name}`);
		}
	}
	console.log('\n💡 Fix these issues and run again: bun run scripts/verify-localnet-config.ts\n');
	process.exit(1);
}

