#!/usr/bin/env bun

/**
 * EVMSol Orchestrator
 *
 * Main entry point for running the complete EVMSol bridge infrastructure:
 * - Relayer service
 * - Prover service
 * - Beacon watcher (for EVM chains)
 * - Health monitoring
 *
 * Uses @jejunetwork/config for centralized configuration.
 * For Solana consensus, use the Geyser plugin which runs inside the validator.
 */

import { parseArgs } from 'node:util'
import { type Subprocess, spawn } from 'bun'
import {
  CORE_PORTS,
  getBridgeMode,
  getBridgePrivateKey,
  loadBridgeConfig,
  type BridgeConfig,
  type BridgeMode,
} from '@jejunetwork/config'
import {
  createHealthChecker,
  type HealthCheckConfig,
} from '../src/monitoring/health.js'
import {
  createRelayerService,
  type RelayerConfig,
} from '../src/relayer/service.js'
import { ChainId } from '../src/types/index.js'

class Orchestrator {
  private config: BridgeConfig
  private processes: Map<string, Subprocess> = new Map()
  private relayer: ReturnType<typeof createRelayerService> | null = null
  private healthChecker: ReturnType<typeof createHealthChecker> | null = null

  constructor(config: BridgeConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    console.log(
      `\n🚀 Starting EVMSol Orchestrator (${this.config.mode} mode)\n`,
    )
    console.log(`${'='.repeat(60)}\n`)

    // Start health monitor first
    if (this.config.components.healthMonitor) {
      await this.startHealthMonitor()
    }

    // Start prover service
    if (this.config.components.prover) {
      await this.startProver()
    }

    // Start relayer service
    if (this.config.components.relayer) {
      await this.startRelayer()
    }

    // Start beacon watcher
    if (this.config.components.beaconWatcher) {
      await this.startBeaconWatcher()
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log('\n✅ All components started\n')
    this.printStatus()
  }

  async stop(): Promise<void> {
    console.log('\n🛑 Stopping EVMSol Orchestrator...\n')

    // Stop processes
    for (const [name, proc] of this.processes) {
      console.log(`  Stopping ${name}...`)
      proc.kill()
    }

    // Stop services
    if (this.relayer) {
      this.relayer.stop()
    }

    if (this.healthChecker) {
      this.healthChecker.stop()
    }

    console.log('\n✅ All components stopped\n')
  }

  private async startHealthMonitor(): Promise<void> {
    console.log('📊 Starting health monitor...')

    const evmChain = this.config.chains.evm[0]
    const healthConfig: HealthCheckConfig = {
      evmRpcUrls: new Map(
        this.config.chains.evm.map((c) => [c.chainId as ChainId, c.rpcUrl]),
      ),
      solanaRpcUrl: this.config.chains.solana.rpcUrl,
      beaconRpcUrl: evmChain.beaconUrl ?? '',
      proverEndpoint: `http://127.0.0.1:${this.config.ports.prover}`,
      relayerEndpoint: `http://127.0.0.1:${this.config.ports.relayer}`,
      checkIntervalMs: 30000,
    }

    this.healthChecker = createHealthChecker(healthConfig)
    this.healthChecker.start()

    console.log(
      `   ✅ Health monitor started on port ${this.config.ports.health}`,
    )
  }

  private async startProver(): Promise<void> {
    console.log('🔐 Starting prover service...')

    // For production, this would start the SP1 prover
    // For now, we spawn our prover service
    const proc = spawn({
      cmd: ['bun', 'run', 'prover/services/prover.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        PROVER_PORT: this.config.ports.prover.toString(),
        USE_MOCK_PROOFS: this.config.prover.useMockProofs.toString(),
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    this.processes.set('prover', proc)

    // Wait for prover to be ready
    await this.waitForService(
      `http://127.0.0.1:${this.config.ports.prover}/health`,
      10,
    )

    console.log(
      `   ✅ Prover service started on port ${this.config.ports.prover}`,
    )
  }

  private async startRelayer(): Promise<void> {
    console.log('🔗 Starting relayer service...')

    const privateKey = getBridgePrivateKey(this.config.mode)

    const relayerConfig: RelayerConfig = {
      port: this.config.ports.relayer,
      evmChains: this.config.chains.evm.map((c) => ({
        chainId: c.chainId as ChainId,
        rpcUrl: c.rpcUrl,
        bridgeAddress: c.bridgeAddress,
        lightClientAddress: c.lightClientAddress,
        privateKey,
      })),
      solanaConfig: {
        rpcUrl: this.config.chains.solana.rpcUrl,
        bridgeProgramId: this.config.chains.solana.bridgeProgramId,
        evmLightClientProgramId:
          this.config.chains.solana.evmLightClientProgramId,
        keypairPath: process.env.SOLANA_KEYPAIR ?? '~/.config/solana/id.json',
      },
      proverEndpoint: `http://127.0.0.1:${this.config.ports.prover}`,
      teeEndpoint: this.config.tee.endpoint,
      batchSize: this.config.tee.maxBatchSize,
      batchTimeoutMs: this.config.tee.batchTimeoutMs,
      retryAttempts: 3,
      retryDelayMs: 5000,
    }

    this.relayer = createRelayerService(relayerConfig)
    await this.relayer.start()

    console.log(
      `   ✅ Relayer service started on port ${this.config.ports.relayer}`,
    )
  }

  private async startBeaconWatcher(): Promise<void> {
    const beaconUrl = this.config.chains.evm[0]?.beaconUrl
    if (!beaconUrl) {
      console.log('⚠️  No beacon URL configured, skipping beacon watcher')
      return
    }

    console.log('👀 Starting beacon watcher...')

    const proc = spawn({
      cmd: ['bun', 'run', 'geyser/ethereum-watcher/src/watcher.ts'],
      cwd: process.cwd(),
      env: {
        ...process.env,
        BEACON_RPC_URL: beaconUrl,
        EXECUTION_RPC_URL: this.config.chains.evm[0].rpcUrl,
        RELAYER_ENDPOINT: `http://127.0.0.1:${this.config.ports.relayer}`,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    this.processes.set('beacon-watcher', proc)
    console.log('   ✅ Beacon watcher started')
  }

  private async waitForService(
    url: string,
    maxAttempts: number,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(url)
        if (response.ok) return true
      } catch {
        // Service not ready yet
      }
      await Bun.sleep(1000)
    }
    return false
  }

  private printStatus(): void {
    console.log('Components:')
    console.log(
      `  Relayer:        http://127.0.0.1:${this.config.ports.relayer}`,
    )
    console.log(
      `  Prover:         http://127.0.0.1:${this.config.ports.prover}`,
    )
    console.log(
      `  Health:         http://127.0.0.1:${this.config.ports.health}/monitoring/health`,
    )
    console.log('')
    console.log('Chains:')
    for (const chain of this.config.chains.evm) {
      console.log(`  ${chain.name}: ${chain.rpcUrl}`)
    }
    console.log(`  Solana: ${this.config.chains.solana.rpcUrl}`)
    console.log('')
    console.log('Press Ctrl+C to stop')
    console.log('')
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      mode: {
        type: 'string',
        short: 'm',
        default: undefined,
      },
      help: {
        type: 'boolean',
        short: 'h',
        default: false,
      },
    },
    strict: true,
    allowPositionals: false,
  })

  if (values.help) {
    console.log(`
EVMSol Orchestrator

Usage: bun run scripts/orchestrator.ts [options]

Options:
  -m, --mode <mode>  Deployment mode (local, testnet, mainnet)
                     Can also be set via BRIDGE_MODE env var
  -h, --help         Show this help message

Environment Variables:
  BRIDGE_MODE              Deployment mode (local, testnet, mainnet)
  PRIVATE_KEY              EVM wallet private key (required for testnet/mainnet)
  SOLANA_KEYPAIR           Path to Solana keypair file
  BASE_SEPOLIA_RPC         Base Sepolia RPC URL
  BEACON_URL               Beacon chain RPC URL
  SOLANA_RPC               Solana RPC URL
  BRIDGE_PROGRAM_ID        Solana bridge program ID
  EVM_LIGHT_CLIENT_PROGRAM_ID  Solana EVM light client program ID

Config Files:
  The bridge uses JSON config files from packages/bridge/config/:
    - local.json   (local development with Anvil)
    - testnet.json (testnet deployment)
    - mainnet.json (production deployment)

  These configs are loaded via @jejunetwork/config and support
  environment variable placeholders like \${BASE_SEPOLIA_RPC}.
`)
    process.exit(0)
  }

  // Get mode from CLI arg or env var
  const mode: BridgeMode = (values.mode as BridgeMode) ?? getBridgeMode()

  if (mode !== 'local' && mode !== 'testnet' && mode !== 'mainnet') {
    console.error(`Unknown mode: ${mode}`)
    console.error('Available modes: local, testnet, mainnet')
    process.exit(1)
  }

  // Load config from @jejunetwork/config (uses JSON files with env var resolution)
  const config = await loadBridgeConfig(mode)

  const orchestrator = new Orchestrator(config)

  // Handle shutdown
  process.on('SIGINT', async () => {
    await orchestrator.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    await orchestrator.stop()
    process.exit(0)
  })

  await orchestrator.start()

  // Keep process alive
  await new Promise(() => {
    /* noop - keep process running */
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
