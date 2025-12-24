#!/usr/bin/env bun
/**
 * Register Dev Endpoints in JNS
 *
 * Sets the `dws.dev` text record on JNS names to point to local dev servers.
 * This enables the JNS Gateway to proxy requests to local dev servers during development.
 *
 * Usage:
 *   bun run scripts/dev/register-dev-endpoints.ts
 *   bun run scripts/dev/register-dev-endpoints.ts --app bazaar
 *   bun run scripts/dev/register-dev-endpoints.ts --clear  # Remove dev endpoints
 *
 * The dev endpoint is stored as a JNS text record:
 *   key: "dws.dev"
 *   value: "http://localhost:PORT"
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  namehash,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

// ABIs
const JNS_RESOLVER_ABI = [
  {
    name: 'setText',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
  },
] as const

// Default dev ports (from @jejunetwork/config)
const DEV_PORTS: Record<string, number> = {
  gateway: 4013,
  bazaar: 4006,
  docs: 4004,
  documentation: 4004,
  factory: 4009,
  autocrat: 4040,
  crucible: 4020,
  dws: 4030,
  monitoring: 3002,
  node: 4080,
  indexer: 4350,
  auth: 4060,
  otto: 4042,
  vpn: 4021,
  wallet: 4100,
}

interface AppConfig {
  name: string
  jnsName: string
  devPort: number
  devUrl: string
}

function findRepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'packages', 'deployment')) &&
      existsSync(join(dir, 'apps'))
    ) {
      return dir
    }
    dir = join(dir, '..')
  }
  return process.cwd()
}

function discoverApps(filter?: string[]): AppConfig[] {
  const rootDir = findRepoRoot()
  const appsDir = join(rootDir, 'apps')
  const apps: AppConfig[] = []

  for (const appDir of readdirSync(appsDir)) {
    if (filter?.length && !filter.includes(appDir)) continue

    const manifestPath = join(appsDir, appDir, 'jeju-manifest.json')
    if (!existsSync(manifestPath)) continue

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    const jnsName = manifest.jns?.name ?? `${appDir}.jeju`
    const label = jnsName.replace('.jeju', '')

    // Get port from manifest, environment, or default
    const envPort = process.env[`${appDir.toUpperCase()}_PORT`]
    const manifestPort = manifest.ports?.frontend ?? manifest.ports?.api
    const defaultPort = DEV_PORTS[label] ?? 4000

    const devPort = envPort
      ? parseInt(envPort, 10)
      : (manifestPort ?? defaultPort)
    const devUrl = `http://localhost:${devPort}`

    apps.push({
      name: appDir,
      jnsName,
      devPort,
      devUrl,
    })
  }

  return apps
}

async function main() {
  const { values } = parseArgs({
    options: {
      app: { type: 'string', short: 'a' },
      clear: { type: 'boolean', default: false },
      'rpc-url': { type: 'string', default: 'http://localhost:6546' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })

  if (values.help) {
    console.log(`
Register Dev Endpoints in JNS

Usage:
  bun run scripts/dev/register-dev-endpoints.ts [options]

Options:
  -a, --app <name>    Register only specific app(s), comma-separated
  --clear             Remove dev endpoints instead of setting them
  --rpc-url <url>     RPC URL (default: http://localhost:6546)
  -h, --help          Show this help

Examples:
  bun run scripts/dev/register-dev-endpoints.ts
  bun run scripts/dev/register-dev-endpoints.ts --app bazaar,gateway
  bun run scripts/dev/register-dev-endpoints.ts --clear
`)
    process.exit(0)
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║           🔧 JNS DEV ENDPOINT REGISTRATION                            ║
╚═══════════════════════════════════════════════════════════════════════╝
`)

  // Setup clients
  const privateKey =
    process.env.PRIVATE_KEY ??
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
  const account = privateKeyToAccount(privateKey as Hex)

  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(values['rpc-url']),
  })

  const walletClient = createWalletClient({
    chain: foundry,
    transport: http(values['rpc-url']),
    account,
  })

  // Load contract addresses from deployments
  const rootDir = findRepoRoot()
  const deploymentPath = join(
    rootDir,
    'packages/contracts/deployments/localnet.json',
  )

  if (!existsSync(deploymentPath)) {
    console.error('Deployment file not found. Run bootstrap first.')
    process.exit(1)
  }

  const deployment = JSON.parse(readFileSync(deploymentPath, 'utf-8'))
  const jnsResolver =
    deployment.contracts?.jnsResolver ?? deployment.JNSResolver

  if (!jnsResolver) {
    console.error('JNS Resolver address not found in deployment.')
    process.exit(1)
  }

  console.log(`JNS Resolver: ${jnsResolver}`)
  console.log(
    `Mode: ${values.clear ? 'CLEAR dev endpoints' : 'SET dev endpoints'}`,
  )
  console.log('')

  // Discover apps
  const filter = values.app?.split(',').map((s) => s.trim())
  const apps = discoverApps(filter)

  if (apps.length === 0) {
    console.log('No apps found.')
    process.exit(0)
  }

  console.log(
    `Found ${apps.length} app(s) to ${values.clear ? 'clear' : 'register'}:`,
  )
  for (const app of apps) {
    console.log(`  - ${app.name}: ${app.jnsName} → ${app.devUrl}`)
  }
  console.log('')

  // Register/clear each app
  for (const app of apps) {
    const node = namehash(app.jnsName) as Hex
    const value = values.clear ? '' : app.devUrl

    console.log(
      `${values.clear ? '🗑️  Clearing' : '📝 Setting'} ${app.jnsName}...`,
    )

    const hash = await walletClient.writeContract({
      address: jnsResolver as Address,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setText',
      args: [node, 'dws.dev', value],
    })

    await publicClient.waitForTransactionReceipt({ hash })

    // Verify
    const stored = await publicClient.readContract({
      address: jnsResolver as Address,
      abi: JNS_RESOLVER_ABI,
      functionName: 'text',
      args: [node, 'dws.dev'],
    })

    if (values.clear) {
      console.log(`  ✅ Cleared dws.dev for ${app.jnsName}`)
    } else {
      console.log(`  ✅ Set dws.dev = "${stored}" for ${app.jnsName}`)
    }
  }

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`)

  if (values.clear) {
    console.log('Dev endpoints cleared. JNS Gateway will serve from IPFS.')
  } else {
    console.log(
      'Dev endpoints registered. Start the JNS Gateway with DEV_MODE=true',
    )
    console.log('to enable proxying to local dev servers.')
    console.log('')
    console.log('Example:')
    console.log('  DEV_MODE=true bun run apps/gateway/api/jns-gateway.ts')
  }
}

main().catch((error) => {
  console.error('Error:', error.message)
  process.exit(1)
})
