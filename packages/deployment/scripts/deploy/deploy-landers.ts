#!/usr/bin/env bun
/**
 * Deploy Landers to DWS
 *
 * Deploys lander pages for all apps (otto, vpn, wallet, node) to DWS storage
 * and configures JNS and CDN routing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { getL2RpcUrl, getServicesConfig } from '@jejunetwork/config'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { z } from 'zod'

const APPS = ['otto', 'vpn', 'wallet', 'node'] as const
type AppName = (typeof APPS)[number]

interface AppConfig {
  name: AppName
  jnsName: string
  buildDir: string
  hasMiniapp: boolean
  hasWorker: boolean
}

const APP_CONFIGS: Record<AppName, AppConfig> = {
  otto: {
    name: 'otto',
    jnsName: 'otto.jeju',
    buildDir: 'dist/web',
    hasMiniapp: true,
    hasWorker: true,
  },
  vpn: {
    name: 'vpn',
    jnsName: 'vpn.jeju',
    buildDir: 'dist/lander',
    hasMiniapp: true,
    hasWorker: true,
  },
  wallet: {
    name: 'wallet',
    jnsName: 'wallet.jeju',
    buildDir: 'dist',
    hasMiniapp: true,
    hasWorker: false,
  },
  node: {
    name: 'node',
    jnsName: 'node.jeju',
    buildDir: 'dist/lander',
    hasMiniapp: false,
    hasWorker: false,
  },
}

interface DeployOptions {
  network: 'localnet' | 'testnet' | 'mainnet'
  app?: AppName
  dryRun: boolean
  skipBuild: boolean
  skipJns: boolean
}

const UploadResponseSchema = z.object({
  cid: z.string(),
  size: z.number().optional(),
})

async function main() {
  const { values } = parseArgs({
    options: {
      network: { type: 'string', short: 'n', default: 'localnet' },
      app: { type: 'string', short: 'a' },
      'dry-run': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      'skip-jns': { type: 'boolean', default: false },
    },
  })

  const options: DeployOptions = {
    network: (values.network as DeployOptions['network']) ?? 'localnet',
    app: values.app as AppName | undefined,
    dryRun: values['dry-run'] ?? false,
    skipBuild: values['skip-build'] ?? false,
    skipJns: values['skip-jns'] ?? false,
  }

  if (options.app && !APPS.includes(options.app)) {
    console.error(
      `Invalid app: ${options.app}. Must be one of: ${APPS.join(', ')}`,
    )
    process.exit(1)
  }

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║              Deploy Landers to DWS                          ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log(`Network:    ${options.network}`)
  console.log(`App:        ${options.app ?? 'all'}`)
  console.log(`Dry Run:    ${options.dryRun}`)
  console.log('')

  const rootDir = findMonorepoRoot()
  const config = getDeployConfig(options.network)

  const appsToProcess = options.app ? [options.app] : APPS

  for (const appName of appsToProcess) {
    await deployApp(rootDir, appName, config, options)
  }

  console.log('')
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║                  Deployment Complete                        ║')
  console.log('╠════════════════════════════════════════════════════════════╣')
  for (const appName of appsToProcess) {
    const appConfig = APP_CONFIGS[appName]
    console.log(
      `${`║  ${appConfig.jnsName.padEnd(15)} -> ${appConfig.name}.jejunetwork.org`.padEnd(60)}║`,
    )
  }
  console.log('╚════════════════════════════════════════════════════════════╝')
}

interface DeployConfig {
  dwsUrl: string
  rpcUrl: string
  chain: typeof baseSepolia | typeof base
  privateKey: Hex
}

function getDeployConfig(network: string): DeployConfig {
  const services = getServicesConfig(
    network as 'localnet' | 'testnet' | 'mainnet',
  )

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY ?? process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY or PRIVATE_KEY required')
  }

  const configs: Record<string, Partial<DeployConfig>> = {
    localnet: {
      dwsUrl: services.dws.api,
      rpcUrl: getL2RpcUrl(),
      chain: baseSepolia,
    },
    testnet: {
      dwsUrl: 'https://dws.testnet.jejunetwork.org',
      rpcUrl: 'https://sepolia.base.org',
      chain: baseSepolia,
    },
    mainnet: {
      dwsUrl: 'https://dws.jejunetwork.org',
      rpcUrl: 'https://mainnet.base.org',
      chain: base,
    },
  }

  return {
    ...configs[network],
    privateKey: privateKey as Hex,
  } as DeployConfig
}

async function deployApp(
  rootDir: string,
  appName: AppName,
  config: DeployConfig,
  options: DeployOptions,
): Promise<void> {
  const appConfig = APP_CONFIGS[appName]
  const appDir = join(rootDir, 'apps', appName)

  console.log(`\n[${appName}] Deploying ${appConfig.jnsName}...`)

  // Build if needed
  if (!options.skipBuild && !options.dryRun) {
    console.log(`[${appName}] Building...`)
    const buildProc = Bun.spawn(['bun', 'run', 'build'], {
      cwd: appDir,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    await buildProc.exited
    if (buildProc.exitCode !== 0) {
      console.error(`[${appName}] Build failed`)
      return
    }
  }

  const distDir = join(appDir, appConfig.buildDir)
  if (!existsSync(distDir)) {
    console.error(`[${appName}] Build directory not found: ${distDir}`)
    return
  }

  // Upload files to DWS storage
  console.log(`[${appName}] Uploading to DWS storage...`)
  const uploadedFiles = await uploadDirectory(
    config.dwsUrl,
    distDir,
    `${appName}-lander`,
    options.dryRun,
  )
  console.log(`[${appName}] Uploaded ${uploadedFiles.size} files`)

  // Get index.html CID
  const indexCid = uploadedFiles.get('index.html')
  if (!indexCid) {
    console.error(`[${appName}] index.html not found in build`)
    return
  }

  // Configure CDN
  console.log(`[${appName}] Configuring CDN...`)
  if (!options.dryRun) {
    const cdnConfig = {
      name: appName,
      domain: `${appName}.jejunetwork.org`,
      jnsName: appConfig.jnsName,
      spa: {
        enabled: true,
        fallback: '/index.html',
      },
      routes: [
        { path: '/api/*', backend: `${appName}-api` },
        { path: '/storage/*', backend: 'dws-storage' },
        ...(appConfig.hasMiniapp
          ? [
              {
                path: '/miniapp',
                static: `${appName}-lander/miniapp/index.html`,
              },
              { path: '/miniapp/*', static: `${appName}-lander/miniapp/` },
            ]
          : []),
      ],
    }

    try {
      await fetch(`${config.dwsUrl}/cdn/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cdnConfig),
      })
      console.log(`[${appName}] CDN configured`)
    } catch (_e) {
      console.warn(
        `[${appName}] CDN configuration failed (may not be available)`,
      )
    }
  }

  // Register JNS
  if (!options.skipJns && !options.dryRun) {
    console.log(`[${appName}] Registering JNS name...`)
    try {
      await registerJNSName(appConfig.jnsName, indexCid, config)
      console.log(`[${appName}] JNS registered: ${appConfig.jnsName}`)
    } catch (e) {
      console.warn(`[${appName}] JNS registration failed: ${e}`)
    }
  }

  console.log(`[${appName}] Done`)
}

async function uploadDirectory(
  dwsUrl: string,
  dirPath: string,
  prefix: string,
  dryRun: boolean,
): Promise<Map<string, string>> {
  const results = new Map<string, string>()

  async function uploadFile(
    filePath: string,
    relativePath: string,
  ): Promise<void> {
    const key = relativePath

    if (dryRun) {
      results.set(key, 'dry-run-cid')
      return
    }

    const content = readFileSync(filePath)
    const formData = new FormData()
    formData.append('file', new Blob([content]), `${prefix}/${relativePath}`)
    formData.append('name', `${prefix}/${relativePath}`)

    const response = await fetch(`${dwsUrl}/storage/upload`, {
      method: 'POST',
      body: formData,
    })

    if (!response.ok) {
      throw new Error(`Upload failed for ${relativePath}: ${response.status}`)
    }

    const rawJson = await response.json()
    const parsed = UploadResponseSchema.safeParse(rawJson)
    if (!parsed.success) {
      throw new Error(`Invalid upload response for ${relativePath}`)
    }

    results.set(key, parsed.data.cid)
  }

  async function processDir(dir: string, baseDir: string): Promise<void> {
    const entries = readdirSync(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      const relativePath = relative(baseDir, fullPath)

      if (entry.isDirectory()) {
        await processDir(fullPath, baseDir)
      } else if (entry.isFile()) {
        await uploadFile(fullPath, relativePath)
      }
    }
  }

  await processDir(dirPath, dirPath)
  return results
}

async function registerJNSName(
  name: string,
  contentCid: string,
  config: DeployConfig,
): Promise<void> {
  // Parse name (e.g., "vpn.jeju" -> label="vpn", parent="jeju")
  const parts = name.split('.')
  if (parts.length !== 2 || parts[1] !== 'jeju') {
    throw new Error(`Invalid JNS name: ${name}. Expected format: <name>.jeju`)
  }

  const appLabel = parts[0]
  const account = privateKeyToAccount(config.privateKey)

  const client = createWalletClient({
    account,
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  // Load contract addresses from deployment
  const contractsPath = join(
    findMonorepoRoot(),
    'packages/contracts/deployments',
    config.chain.id === baseSepolia.id ? 'base-sepolia' : 'base',
    'contracts.json',
  )

  if (!existsSync(contractsPath)) {
    console.warn('JNS contracts not deployed, skipping JNS registration')
    return
  }

  const contracts = JSON.parse(readFileSync(contractsPath, 'utf-8'))
  const jnsRegistry = contracts.JNSRegistry as Address
  const jnsResolver = contracts.JNSResolver as Address

  if (!jnsRegistry || !jnsResolver) {
    console.warn('JNS contracts not found in deployment, skipping')
    return
  }

  // Calculate node hashes
  const jejuLabel = keccak256(stringToBytes('jeju'))
  const jejuNode = keccak256(`0x${'0'.repeat(64)}${jejuLabel.slice(2)}` as Hex)
  const appLabelHash = keccak256(stringToBytes(appLabel))
  const appNode = keccak256(`${jejuNode}${appLabelHash.slice(2)}` as Hex)

  // ABI for JNS operations
  const JNS_REGISTRY_ABI = [
    {
      name: 'setSubnodeOwner',
      type: 'function',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'label', type: 'bytes32' },
        { name: 'owner', type: 'address' },
      ],
      outputs: [{ type: 'bytes32' }],
      stateMutability: 'nonpayable',
    },
    {
      name: 'setResolver',
      type: 'function',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'resolver', type: 'address' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const

  const JNS_RESOLVER_ABI = [
    {
      name: 'setContenthash',
      type: 'function',
      inputs: [
        { name: 'node', type: 'bytes32' },
        { name: 'hash', type: 'bytes' },
      ],
      outputs: [],
      stateMutability: 'nonpayable',
    },
  ] as const

  // Register subnode
  const setSubnodeHash = await client.writeContract({
    address: jnsRegistry,
    abi: JNS_REGISTRY_ABI,
    functionName: 'setSubnodeOwner',
    args: [jejuNode, appLabelHash, account.address],
  })

  const publicClient = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  })

  await publicClient.waitForTransactionReceipt({ hash: setSubnodeHash })

  // Set resolver
  const setResolverHash = await client.writeContract({
    address: jnsRegistry,
    abi: JNS_REGISTRY_ABI,
    functionName: 'setResolver',
    args: [appNode, jnsResolver],
  })
  await publicClient.waitForTransactionReceipt({ hash: setResolverHash })

  // Set contenthash
  const contenthash = encodeIPFSContenthash(contentCid)
  const setContenthashTx = await client.writeContract({
    address: jnsResolver,
    abi: JNS_RESOLVER_ABI,
    functionName: 'setContenthash',
    args: [appNode, contenthash],
  })
  await publicClient.waitForTransactionReceipt({ hash: setContenthashTx })
}

function encodeIPFSContenthash(cid: string): Hex {
  // EIP-1577 contenthash encoding for IPFS
  if (cid.startsWith('Qm')) {
    const BASE58_ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    function base58Decode(str: string): Uint8Array {
      const bytes: number[] = [0]
      for (const char of str) {
        const value = BASE58_ALPHABET.indexOf(char)
        if (value === -1) throw new Error(`Invalid base58 character: ${char}`)
        let carry = value
        for (let i = bytes.length - 1; i >= 0; i--) {
          const n = bytes[i] * 58 + carry
          bytes[i] = n % 256
          carry = Math.floor(n / 256)
        }
        while (carry > 0) {
          bytes.unshift(carry % 256)
          carry = Math.floor(carry / 256)
        }
      }
      let leadingZeros = 0
      for (const char of str) {
        if (char === '1') leadingZeros++
        else break
      }
      const result = new Uint8Array(leadingZeros + bytes.length)
      result.set(new Uint8Array(bytes), leadingZeros)
      return result
    }

    const multihash = base58Decode(cid)
    const contenthash = new Uint8Array(3 + multihash.length)
    contenthash[0] = 0xe3
    contenthash[1] = 0x01
    contenthash[2] = 0x70
    contenthash.set(multihash, 3)

    return `0x${Array.from(contenthash)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}` as Hex
  }

  const cidBytes = new TextEncoder().encode(cid)
  const contenthash = new Uint8Array(1 + cidBytes.length)
  contenthash[0] = 0xe3
  contenthash.set(cidBytes, 1)
  return `0x${Array.from(contenthash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}` as Hex
}

function findMonorepoRoot(): string {
  let dir = process.cwd()
  while (dir !== '/') {
    if (
      existsSync(join(dir, 'package.json')) &&
      existsSync(join(dir, 'apps'))
    ) {
      return dir
    }
    dir = resolve(dir, '..')
  }
  throw new Error('Could not find monorepo root')
}

main().catch((err) => {
  console.error('Deployment failed:', err)
  process.exit(1)
})
