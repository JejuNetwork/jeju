/**
 * @fileoverview Deploy Autocrat contracts to localnet
 *
 * Usage:
 *   bun run scripts/deploy-localnet.ts
 */

import { execSync } from 'child_process';
import { join } from 'path';

const CONTRACTS_DIR = join(__dirname, '../../../packages/contracts');
const RPC_URL = 'http://localhost:8545';

async function main() {
  console.log('🚀 Deploying Autocrat contracts to localnet...\n');

  // Check if anvil is running
  try {
    execSync(`curl -s ${RPC_URL} -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`);
  } catch {
    console.error('Error: Anvil is not running. Start it with: anvil');
    process.exit(1);
  }

  // Deploy using forge script
  const output = execSync(
    `cd ${CONTRACTS_DIR} && forge script script/DeployAutocrat.s.sol:DeployAutocratLocalnet --rpc-url ${RPC_URL} --broadcast`,
    { encoding: 'utf-8' }
  );

  console.log(output);

  // Parse deployed addresses
  const treasuryMatch = output.match(/AUTOCRAT_TREASURY=(.+)/);
  if (treasuryMatch) {
    console.log('\n✅ Deployment successful!');
    console.log(`\nAdd to your .env file:\n`);
    console.log(`AUTOCRAT_TREASURY_1337=${treasuryMatch[1]}`);
  }
}

main().catch((error) => {
  console.error('Deployment failed:', error);
  process.exit(1);
});
