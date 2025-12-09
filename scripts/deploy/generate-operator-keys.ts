#!/usr/bin/env bun
/**
 * Generate Operator Keys for Jeju Network
 * 
 * Generates all required keys for running the L2:
 * - Sequencer (produces L2 blocks)
 * - Batcher (submits batches to L1)
 * - Proposer (submits output roots)
 * - Challenger (challenges invalid outputs)
 * - Admin (owns proxy contracts)
 * 
 * Usage:
 *   bun run scripts/deploy/generate-operator-keys.ts
 */

import { Wallet } from 'ethers';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '../..');
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys');
const CONFIG_DIR = join(ROOT, 'packages/contracts/deploy-config');

interface OperatorKey {
  name: string;
  role: string;
  address: string;
  privateKey: string;
}

function generateKey(name: string, role: string): OperatorKey {
  const wallet = Wallet.createRandom();
  return {
    name,
    role,
    address: wallet.address,
    privateKey: wallet.privateKey,
  };
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  Jeju Network - Operator Key Generation                              ║
║  WARNING: Store these keys securely. They control your chain.        ║
╚══════════════════════════════════════════════════════════════════════╝
`);

  // Create keys directory
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
  }

  // Generate all operator keys
  const keys: OperatorKey[] = [
    generateKey('sequencer', 'Produces L2 blocks'),
    generateKey('batcher', 'Submits transaction batches to L1'),
    generateKey('proposer', 'Submits L2 output roots to L1'),
    generateKey('challenger', 'Challenges invalid output roots'),
    generateKey('admin', 'Proxy admin owner'),
    generateKey('feeRecipient', 'Receives sequencer fees'),
    generateKey('guardian', 'Superchain config guardian'),
  ];

  console.log('Generated Keys:\n');
  console.log('┌─────────────────┬────────────────────────────────────────────┐');
  console.log('│ Role            │ Address                                    │');
  console.log('├─────────────────┼────────────────────────────────────────────┤');
  
  for (const key of keys) {
    console.log(`│ ${key.name.padEnd(15)} │ ${key.address} │`);
  }
  
  console.log('└─────────────────┴────────────────────────────────────────────┘');

  // Save keys to secure file
  const keysFile = join(KEYS_DIR, 'testnet-operators.json');
  writeFileSync(keysFile, JSON.stringify(keys, null, 2), { mode: 0o600 });
  console.log(`\n✅ Keys saved to: ${keysFile}`);
  console.log('   ⚠️  Add this file to .gitignore immediately');

  // Generate deploy config update
  const deployConfigUpdate = {
    p2pSequencerAddress: keys.find(k => k.name === 'sequencer')?.address,
    batchSenderAddress: keys.find(k => k.name === 'batcher')?.address,
    l2OutputOracleProposer: keys.find(k => k.name === 'proposer')?.address,
    l2OutputOracleChallenger: keys.find(k => k.name === 'challenger')?.address,
    proxyAdminOwner: keys.find(k => k.name === 'admin')?.address,
    baseFeeVaultRecipient: keys.find(k => k.name === 'feeRecipient')?.address,
    l1FeeVaultRecipient: keys.find(k => k.name === 'feeRecipient')?.address,
    sequencerFeeVaultRecipient: keys.find(k => k.name === 'feeRecipient')?.address,
    finalSystemOwner: keys.find(k => k.name === 'admin')?.address,
    superchainConfigGuardian: keys.find(k => k.name === 'guardian')?.address,
  };

  const configUpdateFile = join(KEYS_DIR, 'deploy-config-addresses.json');
  writeFileSync(configUpdateFile, JSON.stringify(deployConfigUpdate, null, 2));
  console.log(`\n✅ Deploy config addresses saved to: ${configUpdateFile}`);

  // Generate .env file for operators
  const envContent = keys.map(k => `${k.name.toUpperCase()}_PRIVATE_KEY=${k.privateKey}`).join('\n');
  const envFile = join(KEYS_DIR, 'operators.env');
  writeFileSync(envFile, envContent, { mode: 0o600 });
  console.log(`✅ Environment file saved to: ${envFile}`);

  // Funding requirements
  console.log(`
═══════════════════════════════════════════════════════════════════════
FUNDING REQUIREMENTS (Sepolia Testnet)
═══════════════════════════════════════════════════════════════════════

Fund these addresses on Sepolia before deployment:

1. Admin/Deployer: ${keys.find(k => k.name === 'admin')?.address}
   Amount: 0.5 ETH (for L1 contract deployments)

2. Batcher: ${keys.find(k => k.name === 'batcher')?.address}
   Amount: 0.1 ETH (for submitting batches)

3. Proposer: ${keys.find(k => k.name === 'proposer')?.address}
   Amount: 0.1 ETH (for submitting proposals)

Sepolia Faucets:
- https://sepoliafaucet.com
- https://www.alchemy.com/faucets/ethereum-sepolia
- https://cloud.google.com/application/web3/faucet/ethereum/sepolia

═══════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════

1. Add to .gitignore:
   echo "packages/deployment/.keys/" >> .gitignore

2. Update deploy config:
   bun run scripts/deploy/update-deploy-config.ts

3. Fund operator addresses on Sepolia

4. Deploy L1 contracts:
   bun run scripts/deploy/deploy-l1-contracts.ts

5. Generate L2 genesis:
   NETWORK=testnet bun run packages/deployment/scripts/l2-genesis.ts

═══════════════════════════════════════════════════════════════════════
`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});


