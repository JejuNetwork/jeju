#!/usr/bin/env bun
/**
 * Test Jeju Network Detection
 *
 * Verifies that RpcDetector correctly identifies Jeju network
 * and that all apps will connect to the right chain.
 */

import { RpcDetector } from './rpcDetector';

async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║                                                           ║');
  console.log('║   🔍 JEJU NETWORK DETECTION TEST                       ║');
  console.log('║                                                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  try {
    // Clear cache to force fresh detection
    RpcDetector.clearCache();

    console.log('📡 Testing RPC Detection...\n');

    // Test detection
    const chainInfo = await RpcDetector.getChainInfo();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📊 DETECTION RESULTS:\n');
    console.log(`   Network Name:    ${chainInfo.name}`);
    console.log(`   Chain ID:        ${chainInfo.chainId} (0x${chainInfo.chainId.toString(16)})`);
    console.log(`   RPC URL:         ${chainInfo.rpcUrl}`);
    console.log(`   Is Jeju:         ${chainInfo.isJeju ? '✅ YES' : '❌ NO'}`);
    console.log(`   Block Number:    ${chainInfo.blockNumber}`);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Verification checks
    console.log('🔍 VERIFICATION CHECKS:\n');

    const checks = [
      {
        name: 'Chain ID is 420691 (Jeju Localnet)',
        pass: chainInfo.chainId === 420691,
        value: chainInfo.chainId
      },
      {
        name: 'Detected as Jeju network',
        pass: chainInfo.isJeju === true,
        value: chainInfo.isJeju
      },
      {
        name: 'Network name contains "Jeju"',
        pass: chainInfo.name.includes('Jeju'),
        value: chainInfo.name
      },
      {
        name: 'RPC endpoint is responding',
        pass: chainInfo.blockNumber >= 0,
        value: `Block ${chainInfo.blockNumber}`
      },
      {
        name: 'NOT detected as Anvil',
        pass: !chainInfo.name.includes('Anvil'),
        value: chainInfo.name
      }
    ];

    let allPassed = true;
    for (const check of checks) {
      const status = check.pass ? '✅ PASS' : '❌ FAIL';
      console.log(`   ${status} - ${check.name}`);
      if (!check.pass) {
        console.log(`            Expected: true, Got: ${check.value}`);
        allPassed = false;
      }
    }

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    if (allPassed) {
      console.log('🎉 SUCCESS: All checks passed!\n');
      console.log('   ✅ RpcDetector correctly identifies chain 420691 as Jeju');
      console.log('   ✅ All apps will connect to Jeju network');
      console.log('   ✅ Anvil fallback will NOT be used\n');
      process.exit(0);
    } else {
      console.log('❌ FAILURE: Some checks failed!\n');
      console.log('   Please review the configuration:\n');
      console.log('   1. Check shared/rpcDetector.ts');
      console.log('   2. Verify JEJU_LOCALNET_ID = 420691');
      console.log('   3. Ensure chain detection logic includes 420691\n');
      process.exit(1);
    }

  } catch (error) {
    console.log('❌ ERROR: Detection failed!\n');
    console.error(error);
    console.log('\n   Possible causes:');
    console.log('   1. No blockchain running on localhost:8545');
    console.log('   2. RPC endpoint not responding');
    console.log('   3. Network configuration issue\n');
    console.log('   To fix: Start Jeju or Anvil with chain ID 420691\n');
    process.exit(1);
  }
}

main();
