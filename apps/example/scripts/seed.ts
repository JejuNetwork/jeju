import { getNetworkName } from '@jejunetwork/config'
import { AuthProvider, TEEProvider } from '@jejunetwork/oauth3'
import { expectAddress, expectHex } from '@jejunetwork/types'
import { getRegistryService } from '../api/services/registry'

// Validated Anvil dev addresses
const DEV_DEPLOYER = expectAddress(
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  'DEV_DEPLOYER',
)
const DEV_COUNCIL = expectAddress(
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  'DEV_COUNCIL',
)
const DEV_TEE_OPERATOR = expectAddress(
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  'DEV_TEE_OPERATOR',
)
const MOCK_HEX_ZERO = expectHex('0x00', 'MOCK_HEX_ZERO')

async function seedOAuth3Registry() {
  console.log('\n🌱 Seeding OAuth3 Registry for Example App...\n')

  const registry = getRegistryService()
  const network = getNetworkName()

  console.log(`Network: ${network}`)

  if (network !== 'localnet' && network !== 'testnet') {
    console.log(
      '⚠️  Skipping OAuth3 seeding for mainnet. Use CLI deploy instead.',
    )
    return
  }

  const appId = process.env.OAUTH3_APP_ID || 'example.oauth3.jeju'
  const frontendPort = process.env.FRONTEND_PORT || '4501'
  const teeAgentPort = process.env.OAUTH3_TEE_AGENT_PORT || '8004'

  const devWallets = {
    deployer: DEV_DEPLOYER,
    council: DEV_COUNCIL,
    teeOperator: DEV_TEE_OPERATOR,
  }

  console.log(`📝 Registering OAuth3 App: ${appId}`)
  console.log(`   Owner: ${devWallets.deployer}`)
  console.log(
    `   Redirect URI: http://localhost:${frontendPort}/oauth3/callback`,
  )

  // Convert app ID to hex if needed
  const appIdHex = appId.startsWith('0x')
    ? expectHex(appId, 'App ID')
    : expectHex(
        `0x${Buffer.from(appId).toString('hex').padEnd(64, '0')}`,
        'App ID hex conversion',
      )

  const appTx = await registry.registerApp({
    appId: appIdHex,
    name: 'Decentralized App Template',
    description:
      'A template for building fully decentralized applications on Jeju Network',
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
      supportEmail: 'dev@jejunetwork.org',
      webhookUrl: `http://localhost:${process.env.PORT || 4500}/webhooks/oauth3`,
    },
  })

  console.log(`   ✅ App registered (tx: ${appTx.slice(0, 18)}...)\n`)

  const teeEndpoint = `http://localhost:${teeAgentPort}`
  console.log(`📝 Registering TEE Node`)
  console.log(`   Endpoint: ${teeEndpoint}`)
  console.log(`   Operator: ${devWallets.teeOperator}`)

  const nodeTx = await registry.registerTEENode({
    nodeId: devWallets.teeOperator,
    endpoint: teeEndpoint,
    provider: TEEProvider.SIMULATED,
    attestation: {
      quote: MOCK_HEX_ZERO,
      measurement: MOCK_HEX_ZERO,
      reportData: MOCK_HEX_ZERO,
      timestamp: Date.now(),
      provider: TEEProvider.SIMULATED,
      verified: true,
    },
    publicKey: MOCK_HEX_ZERO,
    stake: BigInt(1e18), // 1 ETH stake
    active: true,
  })

  console.log(`   ✅ TEE Node registered (tx: ${nodeTx.slice(0, 18)}...)\n`)

  console.log('🔍 Verifying registration...')

  const app = await registry.getApp(appId)
  if (app) {
    console.log(`   ✅ App "${app.name}" found`)
    console.log(`      - JNS: ${app.jnsName}`)
    console.log(`      - Providers: ${app.allowedProviders.join(', ')}`)
  } else {
    console.log('   ⚠️  App not found (may need on-chain deployment)')
  }

  const node = await registry.getTEENode(devWallets.teeOperator)
  if (node) {
    console.log(`   ✅ TEE Node found at ${node.endpoint}`)
  } else {
    console.log('   ⚠️  TEE Node not found (may need on-chain deployment)')
  }

  const healthy = await registry.isHealthy()
  console.log(
    `\n🏥 Registry Health: ${healthy ? '✅ Healthy' : '❌ Unhealthy'}`,
  )

  console.log('\n🎉 OAuth3 Registry seeding complete!\n')
  console.log('Next steps:')
  console.log(
    `  1. Start the TEE agent: bun run --cwd packages/oauth3 start:agent`,
  )
  console.log(`  2. Start the app: bun run dev`)
  console.log(`  3. Visit: http://localhost:${frontendPort}\n`)
}

seedOAuth3Registry().catch((error) => {
  console.error('❌ Seeding failed:', error)
  process.exit(1)
})
