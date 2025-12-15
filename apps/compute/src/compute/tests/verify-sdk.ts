/**
 * SDK verification script - run with: bun run src/compute/tests/verify-sdk.ts
 */
import { countTokens } from '../node/inference';
import { ModerationSDK, StakeType } from '../sdk/moderation';
import { ComputeSDK } from '../sdk/sdk';

console.log('🔍 SDK Verification\n');

// 1. Test token counting
console.log('1. Token Counting:');
const text = 'The quick brown fox jumps over the lazy dog';
const tokens = countTokens(text);
console.log(`   Text: "${text}"`);
console.log(`   Tokens: ${tokens}`);
const tokenPass = tokens >= 8 && tokens <= 12;
console.log(
  `   Expected: 8-12, Result: ${tokenPass ? '✅ PASS' : '❌ FAIL'}\n`
);

// 2. Test SDK initialization
console.log('2. ComputeSDK Initialization:');
try {
  const sdk = new ComputeSDK({
    rpcUrl: 'http://localhost:8545',
    contracts: {
      registry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
      ledger: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      inference: '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9',
    },
  });
  console.log('   SDK created: ✅ PASS');
  console.log(
    `   Has discoverProviders(): ${typeof sdk.discoverProviders === 'function' ? '✅' : '❌'}`
  );
  console.log(
    `   Has findProvidersForModel(): ${typeof sdk.findProvidersForModel === 'function' ? '✅' : '❌'}`
  );
  console.log(
    `   Has settleFromResponse(): ${typeof sdk.settleFromResponse === 'function' ? '✅' : '❌'}\n`
  );
} catch (e) {
  console.log(`   SDK creation failed: ❌ FAIL - ${e}\n`);
}

// 3. Test ModerationSDK
console.log('3. ModerationSDK Initialization:');
try {
  // Create SDK to verify it works (not used, just validating constructor)
  new ModerationSDK({
    rpcUrl: 'http://localhost:8545',
    contracts: {
      staking: '0x5FC8d32690cc91D4c39d9d3abcBD16989F875707',
      banManager: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    },
  });
  console.log('   ModerationSDK created: ✅ PASS');
  console.log(
    `   StakeType.USER = ${StakeType.USER} (expected: 0) ${StakeType.USER === 0 ? '✅' : '❌'}`
  );
  console.log(
    `   StakeType.PROVIDER = ${StakeType.PROVIDER} (expected: 1) ${StakeType.PROVIDER === 1 ? '✅' : '❌'}`
  );
  console.log(
    `   StakeType.GUARDIAN = ${StakeType.GUARDIAN} (expected: 2) ${StakeType.GUARDIAN === 2 ? '✅' : '❌'}\n`
  );
} catch (e) {
  console.log(`   ModerationSDK creation failed: ❌ FAIL - ${e}\n`);
}

// Summary
console.log('================================');
console.log('✅ SDK Verification Complete');
console.log('================================');
