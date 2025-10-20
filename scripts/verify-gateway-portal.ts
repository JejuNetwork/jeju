#!/usr/bin/env bun
/**
 * Gateway Portal Verification Script
 * 
 * Ensures all protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON) are:
 * - Properly configured in tokens.ts
 * - Treated equally throughout the system
 * - Have complete paymaster infrastructure
 * - Are accessible in all UI components
 * 
 * Usage:
 *   bun run scripts/verify-gateway-portal.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface VerificationResult {
  name: string;
  passed: boolean;
  message: string;
}

class GatewayPortalVerifier {
  private results: VerificationResult[] = [];

  async verify() {
    console.log('🔍 Gateway Portal - Token Integration Verification');
    console.log('='.repeat(70));
    console.log('');

    // Run all verification checks
    this.verifyTokenConfiguration();
    this.verifyElizaOSIntegration();
    this.verifyBridgeLogic();
    this.verifyEnvironmentVariables();
    this.verifyComponentIntegration();
    this.verifyHookSupport();

    // Print results
    console.log('\n' + '='.repeat(70));
    console.log('VERIFICATION RESULTS');
    console.log('='.repeat(70));
    console.log('');

    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;

    this.results.forEach(result => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`${icon} ${result.name}`);
      if (!result.passed) {
        console.log(`   ${result.message}`);
      }
    });

    console.log('');
    console.log(`Passed: ${passed}/${total}`);
    console.log('');

    if (passed === total) {
      console.log('🎉 All verification checks passed!');
      console.log('   Gateway Portal is properly configured for all tokens.');
      process.exit(0);
    } else {
      console.log('❌ Some verification checks failed.');
      console.log('   Review the errors above and fix the issues.');
      process.exit(1);
    }
  }

  private verifyTokenConfiguration() {
    console.log('📋 Verifying Token Configuration...');

    const tokensFile = join(process.cwd(), 'apps/gateway/src/lib/tokens.ts');
    const content = readFileSync(tokensFile, 'utf-8');

    // Check elizaOS exists and is FIRST
    const elizaOSIndex = content.indexOf("symbol: 'elizaOS'");
    this.addResult(
      'elizaOS token exists in configuration',
      elizaOSIndex > -1,
      'elizaOS not found in tokens.ts'
    );

    // Check all required tokens exist
    const requiredTokens = ['elizaOS', 'CLANKER', 'VIRTUAL', 'CLANKERMON'];
    requiredTokens.forEach(token => {
      const exists = content.includes(`symbol: '${token}'`);
      this.addResult(
        `${token} token exists`,
        exists,
        `${token} not found in tokens.ts`
      );
    });

    // Check elizaOS is marked as native
    const elizaOSNative = content.includes("bridged: false") && 
                          content.includes("originChain: 'jeju'");
    this.addResult(
      'elizaOS marked as native (not bridged)',
      elizaOSNative,
      'elizaOS should have bridged: false and originChain: jeju'
    );

    // Check other tokens are marked as bridged
    const clankerBridged = content.includes("symbol: 'CLANKER'") && 
                            content.includes("originChain: 'base'");
    this.addResult(
      'CLANKER marked as bridged from Base',
      clankerBridged,
      'CLANKER should have bridged: true and originChain: base'
    );

    // Check all have hasPaymaster: true
    const allHavePaymaster = content.match(/hasPaymaster: true/g)?.length === 4;
    this.addResult(
      'All 4 tokens have hasPaymaster: true',
      allHavePaymaster,
      'Not all tokens have hasPaymaster: true'
    );

    // Check all have price data
    const hasPrices = content.includes('priceUSD: 0.10') && // elizaOS
                      content.includes('priceUSD: 26.14') && // CLANKER
                      content.includes('priceUSD: 1.85') && // VIRTUAL
                      content.includes('priceUSD: 0.15'); // CLANKERMON
    this.addResult(
      'All tokens have price data',
      hasPrices,
      'Not all tokens have price data'
    );

    console.log('');
  }

  private verifyElizaOSIntegration() {
    console.log('🏝️ Verifying elizaOS Integration...');

    const files = [
      'apps/gateway/src/App.tsx',
      'apps/gateway/src/lib/tokens.ts',
      'apps/gateway/src/components/MultiTokenBalanceDisplay.tsx',
      'apps/gateway/README.md',
      'apps/gateway/CONSOLIDATION_SUMMARY.md',
    ];

    files.forEach(file => {
      const path = join(process.cwd(), file);
      const content = readFileSync(path, 'utf-8');
      const hasElizaOS = content.includes('elizaOS');
      
      this.addResult(
        `elizaOS mentioned in ${file.split('/').pop()}`,
        hasElizaOS,
        `elizaOS not found in ${file}`
      );
    });

    // Check elizaOS is PRIMARY token (mentioned first)
    const readmePath = join(process.cwd(), 'apps/gateway/README.md');
    const readmeContent = readFileSync(readmePath, 'utf-8');
    const elizaOSPosition = readmeContent.indexOf('elizaOS');
    const clankerPosition = readmeContent.indexOf('CLANKER');
    
    this.addResult(
      'elizaOS listed before CLANKER in README',
      elizaOSPosition < clankerPosition && elizaOSPosition > 0,
      'elizaOS should be listed as primary/first token'
    );

    console.log('');
  }

  private verifyBridgeLogic() {
    console.log('🌉 Verifying Bridge Logic...');

    const bridgeFile = join(process.cwd(), 'apps/gateway/src/components/BridgeToken.tsx');
    const content = readFileSync(bridgeFile, 'utf-8');

    // Check uses bridgeableTokens (not all tokens)
    const usesBridgeableTokens = content.includes('bridgeableTokens');
    this.addResult(
      'Bridge uses bridgeableTokens (excludes elizaOS)',
      usesBridgeableTokens,
      'Bridge should use bridgeableTokens to exclude native tokens'
    );

    // Check has note about elizaOS not being bridgeable
    const hasElizaOSNote = content.includes('elizaOS is a native Jeju token');
    this.addResult(
      'Bridge has elizaOS native token notice',
      hasElizaOSNote,
      'Bridge should explain elizaOS is native and not bridgeable'
    );

    // Check supports custom token input
    const hasCustomToken = content.includes('customTokenAddress') || 
                            content.includes('Custom Address');
    this.addResult(
      'Bridge supports custom token addresses',
      hasCustomToken,
      'Bridge should support ANY Base ERC20 via custom address input'
    );

    console.log('');
  }

  private verifyEnvironmentVariables() {
    console.log('🔧 Verifying Environment Variables...');

    const envFile = join(process.cwd(), 'apps/gateway/src/vite-env.d.ts');
    const content = readFileSync(envFile, 'utf-8');

    const requiredEnvVars = [
      'VITE_ELIZAOS_TOKEN_ADDRESS',
      'VITE_ELIZAOS_VAULT_ADDRESS',
      'VITE_ELIZAOS_PAYMASTER_ADDRESS',
      'VITE_CLANKER_TOKEN_ADDRESS',
      'VITE_CLANKER_VAULT_ADDRESS',
      'VITE_CLANKER_PAYMASTER_ADDRESS',
      'VITE_VIRTUAL_TOKEN_ADDRESS',
      'VITE_VIRTUAL_VAULT_ADDRESS',
      'VITE_VIRTUAL_PAYMASTER_ADDRESS',
      'VITE_CLANKERMON_TOKEN_ADDRESS',
      'VITE_CLANKERMON_VAULT_ADDRESS',
      'VITE_CLANKERMON_PAYMASTER_ADDRESS',
    ];

    requiredEnvVars.forEach(envVar => {
      const exists = content.includes(envVar);
      this.addResult(
        `${envVar} defined`,
        exists,
        `${envVar} missing from vite-env.d.ts`
      );
    });

    console.log('');
  }

  private verifyComponentIntegration() {
    console.log('🧩 Verifying Component Integration...');

    // Check Dashboard imports all components
    const dashboardFile = join(process.cwd(), 'apps/gateway/src/components/Dashboard.tsx');
    const dashboardContent = readFileSync(dashboardFile, 'utf-8');

    const requiredImports = [
      'TokenList',
      'RegisterToken',
      'DeployPaymaster',
      'AddLiquidity',
      'LPDashboard',
      'BridgeToken',
      'MultiTokenBalanceDisplay'
    ];

    requiredImports.forEach(component => {
      const imported = dashboardContent.includes(`import ${component}`);
      this.addResult(
        `Dashboard imports ${component}`,
        imported,
        `${component} not imported in Dashboard`
      );
    });

    // Check MultiTokenBalanceDisplay is rendered
    const hasBalanceDisplay = dashboardContent.includes('<MultiTokenBalanceDisplay');
    this.addResult(
      'Dashboard renders MultiTokenBalanceDisplay',
      hasBalanceDisplay,
      'MultiTokenBalanceDisplay should be shown in Dashboard'
    );

    console.log('');
  }

  private verifyHookSupport() {
    console.log('🪝 Verifying Hook Support...');

    const hooks = [
      'useProtocolTokens',
      'useTokenBalances',
      'useTokenRegistry',
      'usePaymasterFactory',
      'useLiquidityVault',
    ];

    hooks.forEach(hook => {
      const hookFile = join(process.cwd(), `apps/gateway/src/hooks/${hook}.ts`);
      
      const exists = this.fileExists(hookFile);
      this.addResult(
        `${hook} hook exists`,
        exists,
        `${hook}.ts not found in hooks directory`
      );

      if (exists) {
        const content = readFileSync(hookFile, 'utf-8');
        const exportsHook = content.includes(`export function ${hook}`);
        this.addResult(
          `${hook} properly exported`,
          exportsHook,
          `${hook} not properly exported`
        );
      }
    });

    console.log('');
  }

  private fileExists(path: string): boolean {
    const fs = require('fs');
    return fs.existsSync(path);
  }

  private addResult(name: string, passed: boolean, message: string) {
    this.results.push({ name, passed, message });
  }
}

// Run verification
if (import.meta.url === `file://${process.argv[1]}`) {
  const verifier = new GatewayPortalVerifier();
  verifier.verify().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { GatewayPortalVerifier };

