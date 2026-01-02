#!/usr/bin/env bun

/**
 * Start network localnet using Kurtosis + On-Chain DWS Provisioning
 *
 * This script now uses the SAME on-chain provisioning flow as testnet/mainnet:
 * 1. Start L1 (Geth dev) + L2 (op-geth) via Kurtosis
 * 2. Deploy DWS contracts to local Anvil
 * 3. Register as DWS provider on-chain
 * 4. Provision services through on-chain marketplace
 *
 * This ensures dev matches prod exactly in terms of provisioning logic.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { platform } from 'node:os'
import { join } from 'node:path'
import { $ } from 'bun'
import { z } from 'zod'
import { GitHubReleaseSchema } from './shared'

const ROOT = join(import.meta.dir, '..')
const PROJECT_ROOT = join(ROOT, '../..')
const KURTOSIS_PACKAGE = join(ROOT, 'kurtosis/main.star')
const ENCLAVE_NAME = 'jeju-localnet'
const OUTPUT_DIR = join(process.cwd(), '.kurtosis')
const DWS_BOOTSTRAP_SCRIPT = join(ROOT, 'scripts/deploy/dws-bootstrap.ts')

async function checkDocker(): Promise<boolean> {
  const result = await $`docker info`.quiet().nothrow()
  return result.exitCode === 0
}

async function checkKurtosis(): Promise<boolean> {
  const result = await $`which kurtosis`.quiet().nothrow()
  return result.exitCode === 0
}

async function checkBrew(): Promise<boolean> {
  const result = await $`which brew`.quiet().nothrow()
  return result.exitCode === 0
}

function getArchitecture(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  throw new Error(`Unsupported architecture: ${process.arch}`)
}

async function installKurtosisFromGitHub(): Promise<boolean> {
  const arch = getArchitecture()

  const versionResult =
    await $`curl -fsSL https://api.github.com/repos/kurtosis-tech/kurtosis-cli-release-artifacts/releases/latest`
      .quiet()
      .nothrow()
  if (versionResult.exitCode !== 0) {
    return false
  }

  const releaseData = JSON.parse(versionResult.text())
  const release = GitHubReleaseSchema.parse(releaseData)
  const version = release.tag_name
  const tarball = `kurtosis-cli_${version}_linux_${arch}.tar.gz`
  const url = `https://github.com/kurtosis-tech/kurtosis-cli-release-artifacts/releases/download/${version}/${tarball}`

  console.log(`   Downloading ${tarball}...`)

  const downloadResult = await $`curl -fsSL ${url} -o /tmp/${tarball}`.nothrow()
  if (downloadResult.exitCode !== 0) {
    return false
  }

  const extractResult =
    await $`sudo tar -xzf /tmp/${tarball} -C /usr/local/bin kurtosis`.nothrow()
  if (extractResult.exitCode !== 0) {
    await $`mkdir -p ~/.local/bin`.nothrow()
    const localResult =
      await $`tar -xzf /tmp/${tarball} -C ~/.local/bin kurtosis`.nothrow()
    if (localResult.exitCode !== 0) {
      return false
    }
    console.log('   Installed to ~/.local/bin (add to PATH if needed)')
  }

  return true
}

async function installBrew(): Promise<boolean> {
  console.log('🍺 Installing Homebrew...')
  const result =
    await $`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`.nothrow()
  if (result.exitCode !== 0) {
    return false
  }

  if (process.arch === 'arm64') {
    process.env.PATH = `/opt/homebrew/bin:${process.env.PATH}`
  }

  return await checkBrew()
}

async function installKurtosis(): Promise<void> {
  const os = platform()
  console.log(`📦 Installing Kurtosis for ${os}...`)

  if (os === 'linux') {
    const curlResult =
      await $`curl -fsSL https://get.kurtosis.com -o /tmp/kurtosis-install.sh`
        .quiet()
        .nothrow()
    if (curlResult.exitCode === 0) {
      const installResult = await $`bash /tmp/kurtosis-install.sh`.nothrow()
      if (installResult.exitCode === 0 && (await checkKurtosis())) {
        console.log('✅ Kurtosis installed successfully\n')
        return
      }
    }

    console.log('   Trying GitHub releases as alternative...')
    if ((await installKurtosisFromGitHub()) && (await checkKurtosis())) {
      console.log('✅ Kurtosis installed successfully\n')
      return
    }

    console.error('❌ Failed to install Kurtosis')
    console.log('   Try manually: curl -fsSL https://get.kurtosis.com | bash')
    process.exit(1)
  } else if (os === 'darwin') {
    if (!(await checkBrew())) {
      console.log('⚠️  Homebrew not found, installing first...\n')
      if (!(await installBrew())) {
        console.error('❌ Failed to install Homebrew')
        console.log('   Install manually: https://brew.sh')
        process.exit(1)
      }
      console.log('✅ Homebrew installed\n')
    }

    const result = await $`brew install kurtosis-tech/tap/kurtosis`.nothrow()
    if (result.exitCode !== 0) {
      console.error('❌ Failed to install Kurtosis via Homebrew')
      console.log('   Try manually: brew install kurtosis-tech/tap/kurtosis')
      process.exit(1)
    }
    console.log('✅ Kurtosis installed successfully\n')
  } else {
    console.error(`❌ Unsupported OS: ${os}`)
    console.log(
      '   Install Kurtosis manually: https://docs.kurtosis.com/install/',
    )
    process.exit(1)
  }
}

const PortsConfigSchema = z.object({
  l1Rpc: z.string(),
  l2Rpc: z.string(),
  chainId: z.number(),
  timestamp: z.string(),
})

async function runDWSBootstrap(l2RpcUrl: string): Promise<boolean> {
  console.log('\n📦 Running DWS on-chain bootstrap...')
  console.log(
    '   This provisions services via the SAME flow as testnet/mainnet.\n',
  )

  // Set up environment for bootstrap
  const env = {
    ...process.env,
    NETWORK: 'localnet',
    JEJU_NETWORK: 'localnet',
    JEJU_RPC_URL: l2RpcUrl,
    // Use Anvil's default dev key for localnet
    PRIVATE_KEY:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    DEPLOYER_PRIVATE_KEY:
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    IPFS_API_URL: 'http://127.0.0.1:5001',
  }

  // Check if dws-bootstrap script exists
  if (!existsSync(DWS_BOOTSTRAP_SCRIPT)) {
    console.log(
      '   ⚠️  DWS bootstrap script not found, skipping on-chain provisioning',
    )
    console.log(`      Expected: ${DWS_BOOTSTRAP_SCRIPT}`)
    return false
  }

  try {
    // Run the DWS bootstrap script with skip-apps flag first (just contracts)
    console.log('   📜 Deploying DWS contracts to local chain...')
    execSync(`bun run ${DWS_BOOTSTRAP_SCRIPT} --skip-apps`, {
      cwd: PROJECT_ROOT,
      env,
      stdio: 'inherit',
    })
    console.log('   ✅ DWS contracts deployed')
    return true
  } catch (error) {
    console.log('   ⚠️  DWS bootstrap failed (non-critical for basic local dev)')
    console.log(
      `      Error: ${error instanceof Error ? error.message : String(error)}`,
    )
    console.log(
      '      You can run it manually: NETWORK=localnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts',
    )
    return false
  }
}

async function startIPFSIfNeeded(): Promise<boolean> {
  // Check if IPFS is running
  const ipfsCheck = await $`curl -s http://127.0.0.1:5001/api/v0/id`
    .quiet()
    .nothrow()
  if (ipfsCheck.exitCode === 0) {
    console.log('   ✅ IPFS already running')
    return true
  }

  // Try to start IPFS daemon
  console.log('   📦 Starting IPFS daemon...')
  const _ipfsStart = await $`ipfs daemon --init &`.quiet().nothrow()

  // Wait a bit for IPFS to start
  await new Promise((resolve) => setTimeout(resolve, 3000))

  const verifyCheck = await $`curl -s http://127.0.0.1:5001/api/v0/id`
    .quiet()
    .nothrow()
  if (verifyCheck.exitCode === 0) {
    console.log('   ✅ IPFS daemon started')
    return true
  }

  console.log('   ⚠️  IPFS not available (some features may be limited)')
  return false
}

async function main(): Promise<void> {
  console.log('🚀 Starting Network Localnet with On-Chain Provisioning...\n')
  console.log('   This uses the SAME DWS marketplace flow as testnet/mainnet.')
  console.log('   All services are provisioned via on-chain contracts.\n')

  if (!(await checkDocker())) {
    console.error('❌ Docker is not running. Start Docker and try again.')
    process.exit(1)
  }

  if (!(await checkKurtosis())) {
    console.log('⚠️  Kurtosis not found, installing...\n')
    await installKurtosis()
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  console.log('🧹 Cleaning up existing enclave...')
  await $`kurtosis enclave rm -f ${ENCLAVE_NAME}`.quiet().nothrow()

  console.log('📦 Deploying network stack (L1 + L2)...\n')
  const result =
    await $`kurtosis run ${KURTOSIS_PACKAGE} --enclave ${ENCLAVE_NAME}`.nothrow()

  if (result.exitCode !== 0) {
    console.error('❌ Failed to start localnet')
    process.exit(1)
  }

  const l1Port = await $`kurtosis port print ${ENCLAVE_NAME} geth-l1 rpc`
    .text()
    .then((s) => s.trim().split(':').pop())
  const l2Port = await $`kurtosis port print ${ENCLAVE_NAME} op-geth rpc`
    .text()
    .then((s) => s.trim().split(':').pop())

  const l1RpcUrl = `http://127.0.0.1:${l1Port}`
  const l2RpcUrl = `http://127.0.0.1:${l2Port}`

  const portsConfig = PortsConfigSchema.parse({
    l1Rpc: l1RpcUrl,
    l2Rpc: l2RpcUrl,
    chainId: 31337,
    timestamp: new Date().toISOString(),
  })

  await Bun.write(
    join(OUTPUT_DIR, 'ports.json'),
    JSON.stringify(portsConfig, null, 2),
  )

  console.log('\n✅ Chain infrastructure running')
  console.log(`   L1 RPC: ${l1RpcUrl}`)
  console.log(`   L2 RPC: ${l2RpcUrl}`)

  // Start IPFS if available (needed for DWS storage)
  await startIPFSIfNeeded()

  // Run DWS on-chain bootstrap (same flow as testnet/mainnet)
  const dwsBootstrapped = await runDWSBootstrap(l2RpcUrl)

  // Save extended config
  const extendedConfig = {
    ...portsConfig,
    dwsBootstrapped,
    ipfsAvailable: await $`curl -s http://127.0.0.1:5001/api/v0/id`
      .quiet()
      .nothrow()
      .then((r) => r.exitCode === 0),
  }

  writeFileSync(
    join(OUTPUT_DIR, 'localnet-config.json'),
    JSON.stringify(extendedConfig, null, 2),
  )

  console.log(`\n${'═'.repeat(60)}`)
  console.log('✅ LOCALNET READY - Using On-Chain Provisioning')
  console.log('═'.repeat(60))
  console.log(`
   L1 RPC:        ${l1RpcUrl}
   L2 RPC:        ${l2RpcUrl}
   Chain ID:      31337
   DWS:           ${dwsBootstrapped ? 'Provisioned on-chain' : 'Manual setup required'}

   Config saved:  ${join(OUTPUT_DIR, 'localnet-config.json')}

   To deploy apps via DWS (same as testnet):
     NETWORK=localnet bun run packages/deployment/scripts/deploy/deploy-all-apps-to-dws.ts

   To run a node:
     NETWORK=localnet bun run apps/node/api/cli.ts start --all
`)
}

main()
