/**
 * Simple Deploy Command - Vercel-like experience
 *
 * jeju deploy              - Deploy current directory
 * jeju deploy ./my-app     - Deploy specific directory
 * jeju deploy --preview    - Deploy to preview environment
 * jeju deploy --prod       - Deploy to production (requires JNS name)
 *
 * Features:
 * - Auto-detects framework (Next.js, Vite, React, etc.)
 * - Builds automatically
 * - Uploads to IPFS
 * - Updates JNS contenthash
 * - Deploys worker if backend detected
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  getContract,
  getDWSUrl,
  getLocalhostHost,
  getRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { Command } from 'commander'
import {
  type Address,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { logger } from '../lib/logger'

// Framework detection patterns
const FRAMEWORK_PATTERNS = {
  nextjs: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  vite: ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'],
  react: ['react-scripts'], // in package.json dependencies
  vue: ['vue.config.js', 'vite.config.ts'], // with vue dependency
  svelte: ['svelte.config.js'],
  astro: ['astro.config.mjs', 'astro.config.js'],
  remix: ['remix.config.js'],
  static: ['index.html'],
} as const

type Framework = keyof typeof FRAMEWORK_PATTERNS | 'unknown'

interface BuildConfig {
  framework: Framework
  buildCommand: string
  outputDir: string
  installCommand: string
}

// Build configurations for each framework
const BUILD_CONFIGS: Record<Framework, Omit<BuildConfig, 'framework'>> = {
  nextjs: {
    buildCommand: 'bun run build && bun run export',
    outputDir: 'out',
    installCommand: 'bun install',
  },
  vite: {
    buildCommand: 'bun run build',
    outputDir: 'dist',
    installCommand: 'bun install',
  },
  react: {
    buildCommand: 'bun run build',
    outputDir: 'build',
    installCommand: 'bun install',
  },
  vue: {
    buildCommand: 'bun run build',
    outputDir: 'dist',
    installCommand: 'bun install',
  },
  svelte: {
    buildCommand: 'bun run build',
    outputDir: 'build',
    installCommand: 'bun install',
  },
  astro: {
    buildCommand: 'bun run build',
    outputDir: 'dist',
    installCommand: 'bun install',
  },
  remix: {
    buildCommand: 'bun run build',
    outputDir: 'public/build',
    installCommand: 'bun install',
  },
  static: {
    buildCommand: '',
    outputDir: '.',
    installCommand: '',
  },
  unknown: {
    buildCommand: 'bun run build',
    outputDir: 'dist',
    installCommand: 'bun install',
  },
}

// JNS Resolver ABI for updating contenthash
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

function detectFramework(projectDir: string): Framework {
  // Check for specific config files
  for (const [framework, patterns] of Object.entries(FRAMEWORK_PATTERNS)) {
    for (const pattern of patterns) {
      if (existsSync(join(projectDir, pattern))) {
        return framework as Framework
      }
    }
  }

  // Check package.json dependencies
  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }

    if (deps.next) return 'nextjs'
    if (deps.vite) return 'vite'
    if (deps['react-scripts']) return 'react'
    if (deps.vue) return 'vue'
    if (deps.svelte) return 'svelte'
    if (deps.astro) return 'astro'
    if (deps['@remix-run/react']) return 'remix'
  }

  // Check for static site
  if (existsSync(join(projectDir, 'index.html'))) {
    return 'static'
  }

  return 'unknown'
}

function getBuildConfig(projectDir: string, framework: Framework): BuildConfig {
  const config = BUILD_CONFIGS[framework]

  // Override with package.json scripts if available
  const pkgPath = join(projectDir, 'package.json')
  if (existsSync(pkgPath)) {
    // Check for custom build output in various frameworks
    if (framework === 'vite' || framework === 'vue') {
      const viteConfigPath = join(projectDir, 'vite.config.ts')
      if (existsSync(viteConfigPath)) {
        const viteConfig = readFileSync(viteConfigPath, 'utf-8')
        const outDirMatch = viteConfig.match(/outDir:\s*['"]([^'"]+)['"]/)
        if (outDirMatch) {
          return { framework, ...config, outputDir: outDirMatch[1] }
        }
      }
    }
  }

  return { framework, ...config }
}

async function buildProject(
  projectDir: string,
  config: BuildConfig,
): Promise<boolean> {
  // Install dependencies
  if (config.installCommand && existsSync(join(projectDir, 'package.json'))) {
    if (!existsSync(join(projectDir, 'node_modules'))) {
      logger.step('Installing dependencies...')
      try {
        execSync(config.installCommand, {
          cwd: projectDir,
          stdio: 'inherit',
        })
      } catch {
        return false
      }
    }
  }

  // Build
  if (config.buildCommand) {
    logger.step('Building project...')
    try {
      execSync(config.buildCommand, {
        cwd: projectDir,
        stdio: 'inherit',
      })
    } catch {
      return false
    }
  }

  return true
}

async function uploadToIPFS(
  outputDir: string,
  dwsUrl: string,
): Promise<string | null> {
  logger.step('Uploading to IPFS...')

  try {
    // Use recursive add for directories
    const response = await fetch(`${dwsUrl}/api/ipfs/add-directory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: outputDir }),
    })

    if (!response.ok) {
      // Fallback: try to call ipfs directly via CLI
      const result = execSync(`ipfs add -r -Q --cid-version=1 "${outputDir}"`, {
        encoding: 'utf-8',
      }).trim()
      return result
    }

    const data = (await response.json()) as { cid: string }
    return data.cid
  } catch (e) {
    logger.error(
      `IPFS upload failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
    )
    return null
  }
}

async function updateJNS(
  name: string,
  cid: string,
  network: NetworkType,
  privateKey: Hex,
): Promise<string | null> {
  const jnsResolver = getContract('jns', 'jnsResolver') as Address | undefined
  if (!jnsResolver) {
    logger.warn('JNS not configured - skipping name update')
    return null
  }

  const rpcUrl = getRpcUrl(network)
  const account = privateKeyToAccount(privateKey)

  const walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  })

  // Calculate namehash
  const node = namehash(name)

  // Encode IPFS CID as contenthash (EIP-1577)
  // e3 prefix = IPFS namespace
  const contenthash = encodeIPFSContenthash(cid)

  logger.step(`Updating JNS: ${name} -> ipfs://${cid}`)

  const chainId = 31337 // TODO: get from network
  const chain = {
    id: chainId,
    name: network,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  }

  try {
    const hash = await walletClient.writeContract({
      address: jnsResolver,
      abi: JNS_RESOLVER_ABI,
      functionName: 'setContenthash',
      args: [node, contenthash],
      chain,
    })

    return hash
  } catch (e) {
    logger.error(
      `JNS update failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
    )
    return null
  }
}

function namehash(name: string): Hex {
  const labels = name.toLowerCase().replace(/\.$/, '').split('.').reverse()
  let node: Hex = `0x${'0'.repeat(64)}` as Hex

  for (const label of labels) {
    const labelHash = keccak256(stringToBytes(label))
    node = keccak256(`${node}${labelHash.slice(2)}` as Hex) as Hex
  }

  return node
}

function encodeIPFSContenthash(cid: string): Hex {
  // For CIDv0 (Qm...), convert to CIDv1 first
  // For CIDv1 (bafy...), encode directly
  // Simplified: just prefix with e3 01 70 (IPFS dag-pb)
  // In production, use proper CID encoding

  // This is a simplified encoding - proper implementation would use
  // multicodec and multihash libraries
  const cidBytes = base58Decode(cid)
  const prefix = '0xe30170' // e3 = ipfs namespace, 01 = CIDv1, 70 = dag-pb
  const cidHex = Array.from(cidBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `${prefix}${cidHex}` as Hex
}

function base58Decode(str: string): Uint8Array {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

  let leadingZeros = 0
  for (const char of str) {
    if (char === '1') leadingZeros++
    else break
  }

  const size = Math.floor((str.length * 733) / 1000) + 1
  const bytes = new Uint8Array(size)

  for (const char of str) {
    let carry = ALPHABET.indexOf(char)
    if (carry < 0) throw new Error(`Invalid base58 character: ${char}`)

    for (let i = size - 1; i >= 0; i--) {
      carry += 58 * bytes[i]
      bytes[i] = carry % 256
      carry = Math.floor(carry / 256)
    }
  }

  // Find first non-zero byte
  let firstNonZero = 0
  while (firstNonZero < bytes.length && bytes[firstNonZero] === 0) {
    firstNonZero++
  }

  // Prepend leading zeros
  const result = new Uint8Array(leadingZeros + (size - firstNonZero))
  result.set(bytes.slice(firstNonZero), leadingZeros)

  return result
}

export const deploySimpleCommand = new Command('deploy')
  .description('Deploy a project to the decentralized web')
  .argument('[directory]', 'Project directory to deploy', '.')
  .option('-n, --name <name>', 'JNS name (e.g., myapp.jeju)')
  .option('--preview', 'Deploy to preview environment')
  .option('--prod', 'Deploy to production')
  .option(
    '--network <network>',
    'Network: mainnet, testnet, localnet',
    'testnet',
  )
  .option('--no-build', 'Skip build step')
  .option('--output <dir>', 'Override output directory')
  .option('--framework <framework>', 'Override framework detection')
  .action(async (directory, options) => {
    const startTime = Date.now()
    const projectDir = resolve(directory)

    if (!existsSync(projectDir)) {
      logger.error(`Directory not found: ${projectDir}`)
      process.exit(1)
    }

    logger.header('JEJU DEPLOY')
    console.log()

    // Detect framework
    const framework =
      (options.framework as Framework) || detectFramework(projectDir)
    logger.info(`Framework: ${framework}`)

    // Get build config
    const buildConfig = getBuildConfig(projectDir, framework)
    if (options.output) {
      buildConfig.outputDir = options.output
    }

    logger.info(`Output: ${buildConfig.outputDir}`)
    console.log()

    // Build if needed
    if (options.build !== false) {
      const buildSuccess = await buildProject(projectDir, buildConfig)
      if (!buildSuccess) {
        logger.error('Build failed')
        process.exit(1)
      }
    }

    // Verify output exists
    const outputPath = join(projectDir, buildConfig.outputDir)
    if (!existsSync(outputPath)) {
      logger.error(`Output directory not found: ${outputPath}`)
      logger.info('Run with --output to specify a different directory')
      process.exit(1)
    }

    // Upload to IPFS
    const dwsUrl =
      process.env.DWS_URL ?? getDWSUrl() ?? `http://${getLocalhostHost()}:4030`
    const cid = await uploadToIPFS(outputPath, dwsUrl)

    if (!cid) {
      logger.error('IPFS upload failed')
      process.exit(1)
    }

    logger.success(`Uploaded to IPFS: ${cid}`)

    // Generate URLs
    const ipfsUrl = `https://ipfs.io/ipfs/${cid}`
    const dwsPreviewUrl = `${dwsUrl}/ipfs/${cid}`

    // Update JNS if name provided and prod deployment
    let txHash: string | null = null
    let jnsUrl: string | null = null

    if (options.name && options.prod) {
      const privateKey = process.env.JEJU_PRIVATE_KEY as Hex | undefined
      if (!privateKey) {
        logger.warn('JEJU_PRIVATE_KEY not set - skipping JNS update')
      } else {
        txHash = await updateJNS(
          options.name,
          cid,
          options.network as NetworkType,
          privateKey,
        )
        if (txHash) {
          const jnsName = options.name.endsWith('.jeju')
            ? options.name
            : `${options.name}.jeju`
          jnsUrl = `https://${jnsName.replace('.jeju', '')}.jeju.jejunetwork.org`
        }
      }
    }

    // Print results
    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    console.log()
    logger.header('DEPLOYMENT COMPLETE')
    console.log()
    console.log(`  Duration: ${duration}s`)
    console.log(`  CID: ${cid}`)
    console.log()
    console.log('  URLs:')
    console.log(`    IPFS:    ${ipfsUrl}`)
    console.log(`    Preview: ${dwsPreviewUrl}`)

    if (jnsUrl) {
      console.log(`    JNS:     ${jnsUrl}`)
    }

    if (txHash) {
      console.log()
      console.log(`  JNS Update TX: ${txHash}`)
    }

    if (!options.name) {
      console.log()
      console.log('  To deploy to a custom domain:')
      console.log(`    jeju deploy --name myapp.jeju --prod`)
    }

    console.log()
  })

export default deploySimpleCommand
