/**
 * Oracle Network Localnet Deployment
 * 
 * Deploys oracle contracts to local Anvil and updates gateway addresses.
 * 
 * Usage:
 *   bun scripts/deploy-oracle-localnet.ts
 */

import { createPublicClient, http } from 'viem';
import { foundry } from 'viem/chains';

const RPC_URL = 'http://localhost:9545';

// Anvil default private key (account 0)
const DEPLOYER_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

interface DeployedAddresses {
  feedRegistry: `0x${string}`;
  committeeManager: `0x${string}`;
  reportVerifier: `0x${string}`;
  feeRouter: `0x${string}`;
  disputeGame: `0x${string}`;
  networkConnector: `0x${string}`;
}

async function main() {
  console.log('==========================================');
  console.log('Oracle Network Localnet Deployment');
  console.log('==========================================');
  console.log('');

  // Check if Anvil is running
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  try {
    await publicClient.getBlockNumber();
    console.log('✅ Anvil is running');
  } catch {
    console.error('❌ Anvil is not running. Start it with: anvil');
    process.exit(1);
  }

  console.log('');
  console.log('Running Forge deployment script...');
  console.log('');

  // Run forge script
  const proc = Bun.spawn([
    'forge', 'script',
    'script/DeployOracleNetwork.s.sol:DeployOracleNetwork',
    '--rpc-url', RPC_URL,
    '--broadcast',
    '--json',
  ], {
    cwd: './packages/contracts',
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      DEPLOYER_PRIVATE_KEY,
    },
  });

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    console.error('❌ Forge deployment failed');
    process.exit(1);
  }

  console.log('✅ Deployment completed');
  console.log('');

  // Parse deployment output to extract addresses
  // The forge script outputs console.log statements we can parse
  const addresses = parseDeploymentOutput(output);

  if (!addresses) {
    console.log('Output:');
    console.log(output);
    console.error('');
    console.error('❌ Could not parse deployed addresses from output');
    console.error('Please update gateway addresses manually from the output above.');
    process.exit(1);
  }

  console.log('Deployed Addresses:');
  console.log(`  FeedRegistry:          ${addresses.feedRegistry}`);
  console.log(`  CommitteeManager:      ${addresses.committeeManager}`);
  console.log(`  ReportVerifier:        ${addresses.reportVerifier}`);
  console.log(`  OracleFeeRouter:       ${addresses.feeRouter}`);
  console.log(`  DisputeGame:           ${addresses.disputeGame}`);
  console.log(`  OracleNetworkConnector:${addresses.networkConnector}`);
  console.log('');

  // Update gateway config
  await updateGatewayConfig(addresses);

  // Update oracle node config template
  await updateOracleNodeConfig(addresses);

  console.log('');
  console.log('==========================================');
  console.log('DEPLOYMENT COMPLETE');
  console.log('==========================================');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Start the oracle node:');
  console.log('     cd apps/gateway && bun run dev:oracle');
  console.log('');
  console.log('  2. Start the gateway UI:');
  console.log('     cd apps/gateway && bun run dev:ui');
  console.log('');
  console.log('  3. Register as an operator (via UI or script)');
  console.log('');
}

function parseDeploymentOutput(output: string): DeployedAddresses | null {
  // Look for contract addresses in the forge output
  const patterns: Record<keyof DeployedAddresses, RegExp> = {
    feedRegistry: /FeedRegistry:\s*(0x[a-fA-F0-9]{40})/,
    committeeManager: /CommitteeManager:\s*(0x[a-fA-F0-9]{40})/,
    reportVerifier: /ReportVerifier:\s*(0x[a-fA-F0-9]{40})/,
    feeRouter: /OracleFeeRouter:\s*(0x[a-fA-F0-9]{40})/,
    disputeGame: /DisputeGame:\s*(0x[a-fA-F0-9]{40})/,
    networkConnector: /OracleNetworkConnector:\s*(0x[a-fA-F0-9]{40})/,
  };

  const addresses: Partial<DeployedAddresses> = {};

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = output.match(pattern);
    if (match) {
      addresses[key as keyof DeployedAddresses] = match[1] as `0x${string}`;
    }
  }

  // Check if we got all addresses
  const requiredKeys: (keyof DeployedAddresses)[] = [
    'feedRegistry', 'committeeManager', 'reportVerifier', 'feeRouter', 'disputeGame', 'networkConnector'
  ];

  for (const key of requiredKeys) {
    if (!addresses[key]) {
      console.error(`Missing address for ${key}`);
      return null;
    }
  }

  return addresses as DeployedAddresses;
}

async function updateGatewayConfig(addresses: DeployedAddresses) {
  const configPath = './apps/gateway/src/lib/oracleNetwork.ts';
  
  try {
    const content = await Bun.file(configPath).text();
    
    // Update localnet addresses (chain ID 1337)
    const updatedContent = content.replace(
      /1337:\s*\{[^}]+\}/s,
      `1337: {
    feedRegistry: '${addresses.feedRegistry}',
    reportVerifier: '${addresses.reportVerifier}',
    committeeManager: '${addresses.committeeManager}',
    feeRouter: '${addresses.feeRouter}',
  }`
    );
    
    await Bun.write(configPath, updatedContent);
    console.log(`✅ Updated ${configPath}`);
  } catch (error) {
    console.error(`❌ Failed to update ${configPath}:`, error);
  }
}

async function updateOracleNodeConfig(addresses: DeployedAddresses) {
  const envPath = './apps/gateway/.env.oracle';
  
  const envContent = `# Oracle Node Configuration (Localnet)
# Generated by deploy-oracle-localnet.ts

JEJU_NETWORK=localnet
RPC_URL=http://localhost:9545
CHAIN_ID=1337

# Contract addresses
FEED_REGISTRY_ADDRESS=${addresses.feedRegistry}
REPORT_VERIFIER_ADDRESS=${addresses.reportVerifier}
COMMITTEE_MANAGER_ADDRESS=${addresses.committeeManager}
FEE_ROUTER_ADDRESS=${addresses.feeRouter}
NETWORK_CONNECTOR_ADDRESS=${addresses.networkConnector}

# Operator keys (Anvil default accounts)
OPERATOR_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
WORKER_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

# Node settings
POLL_INTERVAL_MS=30000
HEARTBEAT_INTERVAL_MS=60000
METRICS_PORT=9090
`;

  try {
    await Bun.write(envPath, envContent);
    console.log(`✅ Created ${envPath}`);
  } catch (error) {
    console.error(`❌ Failed to create ${envPath}:`, error);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

