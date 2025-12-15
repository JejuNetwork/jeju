/**
 * OAuth3 Registry Seeding Script
 *
 * Seeds the OAuth3 registry with:
 * - The example-app as an OAuth3 application
 * - A mock TEE node for local development
 *
 * Run with: bun run seed
 */

import { getRegistryService } from '../src/services/registry';
import { AuthProvider, TEEProvider } from '@jeju/oauth3';
import { getNetworkName } from '@jejunetwork/config';
import type { Address, Hex } from 'viem';

async function seedOAuth3Registry() {
  console.log('\n🌱 Seeding OAuth3 Registry for Example App...\n');

  const registry = getRegistryService();
  const network = getNetworkName();

  console.log(`Network: ${network}`);

  if (network !== 'localnet' && network !== 'testnet') {
    console.log('⚠️  Skipping OAuth3 seeding for mainnet. Use CLI deploy instead.');
    return;
  }

  const appId = process.env.OAUTH3_APP_ID || 'example-app.oauth3.jeju';
  const frontendPort = process.env.FRONTEND_PORT || '4501';
  const teeAgentPort = process.env.OAUTH3_TEE_AGENT_PORT || '8004';

  // Dev wallet addresses (Anvil default accounts)
  const devWallets = {
    deployer: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address,
    council: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Address,
    teeOperator: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Address,
  };

  // 1. Register the Example App as an OAuth3 App
  console.log(`📝 Registering OAuth3 App: ${appId}`);
  console.log(`   Owner: ${devWallets.deployer}`);
  console.log(`   Redirect URI: http://localhost:${frontendPort}/oauth3/callback`);

  const appTx = await registry.registerApp({
    appId: appId as Hex,
    name: 'Decentralized App Template',
    description: 'A template for building fully decentralized applications on Jeju Network',
    owner: devWallets.deployer,
    council: devWallets.council,
    redirectUris: [`http://localhost:${frontendPort}/oauth3/callback`],
    allowedProviders: [
      AuthProvider.WALLET,
      AuthProvider.FARCASTER,
      AuthProvider.GITHUB,
      AuthProvider.GOOGLE,
      AuthProvider.TWITTER,
      AuthProvider.DISCORD,
    ],
    jnsName: appId,
    active: true,
    createdAt: Date.now(),
    metadata: {
      logoUri: '',
      policyUri: '',
      termsUri: '',
      supportEmail: 'dev@jeju.network',
      webhookUrl: `http://localhost:${process.env.PORT || 4500}/webhooks/oauth3`,
    },
  });

  console.log(`   ✅ App registered (tx: ${appTx.slice(0, 18)}...)\n`);

  // 2. Register a mock TEE Node
  const teeEndpoint = `http://localhost:${teeAgentPort}`;
  console.log(`📝 Registering TEE Node`);
  console.log(`   Endpoint: ${teeEndpoint}`);
  console.log(`   Operator: ${devWallets.teeOperator}`);

  const nodeTx = await registry.registerTEENode({
    nodeId: devWallets.teeOperator,
    endpoint: teeEndpoint,
    provider: TEEProvider.SIMULATED,
    attestation: {
      quote: '0x00' as Hex,
      measurement: '0x00' as Hex,
      reportData: '0x00' as Hex,
      timestamp: Date.now(),
      provider: TEEProvider.SIMULATED,
      verified: true,
    },
    publicKey: '0x00' as Hex,
    stake: BigInt(1e18), // 1 ETH stake
    active: true,
  });

  console.log(`   ✅ TEE Node registered (tx: ${nodeTx.slice(0, 18)}...)\n`);

  // 3. Verify registration
  console.log('🔍 Verifying registration...');

  const app = await registry.getApp(appId);
  if (app) {
    console.log(`   ✅ App "${app.name}" found`);
    console.log(`      - JNS: ${app.jnsName}`);
    console.log(`      - Providers: ${app.allowedProviders.join(', ')}`);
  } else {
    console.log('   ⚠️  App not found (may need on-chain deployment)');
  }

  const node = await registry.getTEENode(devWallets.teeOperator);
  if (node) {
    console.log(`   ✅ TEE Node found at ${node.endpoint}`);
  } else {
    console.log('   ⚠️  TEE Node not found (may need on-chain deployment)');
  }

  // Health check
  const healthy = await registry.isHealthy();
  console.log(`\n🏥 Registry Health: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}`);

  console.log('\n🎉 OAuth3 Registry seeding complete!\n');
  console.log('Next steps:');
  console.log(`  1. Start the TEE agent: bun run --cwd packages/oauth3 start:agent`);
  console.log(`  2. Start the app: bun run dev`);
  console.log(`  3. Visit: http://localhost:${frontendPort}\n`);
}

// Run seeding
seedOAuth3Registry().catch((error) => {
  console.error('❌ Seeding failed:', error);
  process.exit(1);
});
