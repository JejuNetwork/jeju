#!/usr/bin/env bun
/**
 * Jeju Node Daemon
 *
 * The daemon that runs all node services for earning rewards by providing:
 * - Compute (CPU/GPU inference)
 * - Storage (IPFS + SQLit hosting)
 * - Network (VPN exit, residential proxy, edge CDN)
 * - Infrastructure (sequencer, oracle, bridge relaying)
 */

import {
  getChainId,
  getNetworkName,
  getRpcUrl,
  getServicesConfig,
  type NetworkType,
} from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { z } from 'zod'
import { configureNode, config as nodeConfig } from '../../api/config'
import { createSecureNodeClient } from '../../api/lib/contracts'
import { detectHardware, getComputeCapabilities } from '../../api/lib/hardware'
import {
  createNodeServices,
  type NodeServices,
  type NodeServicesConfig,
} from '../../api/lib/services'

const VERSION = '0.1.0'
const networkName = getNetworkName()

interface DaemonConfig {
  network: NetworkType
  all: boolean
  minimal: boolean
  enableCompute: boolean
  enableStorage: boolean
  enableVPN: boolean
  enableProxy: boolean
  enableOracle: boolean
  enableSequencer: boolean
  enableBridge: boolean
  enableDatabase: boolean
  enableCDN: boolean
  keyId: string
}

interface RunningService {
  name: string
  started: boolean
  error: string | null
}

class NodeDaemon {
  private config: DaemonConfig
  private services: NodeServices | null = null
  private runningServices: Map<string, RunningService> = new Map()
  private isShuttingDown = false

  constructor(config: DaemonConfig) {
    this.config = config
  }

  async start(): Promise<void> {
    console.log(chalk.cyan(`\n  ${networkName} Node Daemon v${VERSION}\n`))
    console.log(chalk.dim(`  Network: ${this.config.network}`))
    console.log(chalk.dim(`  Mode: ${this.getModeDescription()}`))
    console.log()

    // Configure the node
    const rpcUrl = getRpcUrl(this.config.network)
    const chainId = getChainId(this.config.network)
    const servicesConfig = getServicesConfig(this.config.network)

    configureNode({
      network: this.config.network,
      rpcUrl,
    })

    // Detect hardware
    console.log(chalk.dim('  Detecting hardware...'))
    const hardware = detectHardware()
    const capabilities = getComputeCapabilities(hardware)

    console.log(
      chalk.dim(
        `  CPU: ${hardware.cpu.name} (${hardware.cpu.coresPhysical} cores)`,
      ),
    )
    if (hardware.gpus.length > 0) {
      console.log(
        chalk.dim(
          `  GPU: ${hardware.gpus.map((g) => g.name).join(', ')} (${capabilities.gpuCompute.totalVram} MB VRAM)`,
        ),
      )
    }
    console.log()

    // For localnet, use a dev key if no KMS key is provided
    let keyId = this.config.keyId
    if (!keyId && this.config.network === 'localnet') {
      keyId = 'dev-localnet-key'
      console.log(chalk.yellow('  Using development key for localnet'))
    }

    if (!keyId) {
      console.log(chalk.red('  Error: KMS key ID required for testnet/mainnet'))
      console.log(chalk.dim('  Set KMS_KEY_ID or use --key-id'))
      process.exit(1)
    }

    // Create node client
    const client = createSecureNodeClient(rpcUrl, chainId, keyId)

    // Create services config - bootstrap nodes fetched from on-chain registry
    console.log(
      chalk.dim('  Fetching bootstrap nodes from on-chain registry...'),
    )
    const bootstrapNodes = await this.getBootstrapNodesFromChain(
      rpcUrl,
      chainId,
    )

    const servicesConf: NodeServicesConfig = {
      keyId,
      bridge: {
        operatorAddress: client.walletAddress,
        evmKeyId: keyId,
      },
      edge: {
        keyId,
        bootstrapNodes,
        region: nodeConfig.proxyRegion,
      },
      vpn: {},
      staticAssets: {
        ipfsGateway: servicesConfig.ipfs.gateway,
        ipfsApiUrl: servicesConfig.ipfs.api,
      },
      sequencer: {
        l1RpcUrl: servicesConfig.rpc.l1,
        l2RpcUrl: servicesConfig.rpc.l2,
      },
      staking: {},
    }

    // Create all services
    console.log(chalk.dim('  Initializing services...'))
    this.services = createNodeServices(client, servicesConf)

    // Setup hardware for compute service
    this.services.compute.setHardware(hardware)

    // Register signal handlers
    this.setupSignalHandlers()

    // Start enabled services
    await this.startEnabledServices()

    // Start health monitoring
    this.startHealthMonitor()

    console.log(chalk.green('\n  Node daemon running. Press Ctrl+C to stop.\n'))

    // Keep the process alive
    await this.keepAlive()
  }

  private getModeDescription(): string {
    if (this.config.all) return 'All services'
    if (this.config.minimal) return 'Minimal (essential only)'
    const enabled: string[] = []
    if (this.config.enableCompute) enabled.push('compute')
    if (this.config.enableStorage) enabled.push('storage')
    if (this.config.enableVPN) enabled.push('vpn')
    if (this.config.enableProxy) enabled.push('proxy')
    if (this.config.enableOracle) enabled.push('oracle')
    if (this.config.enableSequencer) enabled.push('sequencer')
    if (this.config.enableBridge) enabled.push('bridge')
    if (this.config.enableDatabase) enabled.push('database')
    if (this.config.enableCDN) enabled.push('cdn')
    return enabled.length > 0 ? enabled.join(', ') : 'default'
  }

  /**
   * Get bootstrap nodes from on-chain registry
   *
   * IMPORTANT: This fetches active edge nodes from the CDN registry contract
   * instead of using hardcoded URLs. This ensures:
   * - Nodes discover peers dynamically
   * - New nodes can join without config changes
   * - Network is truly decentralized
   *
   * Uses the actual CDNRegistry contract functions:
   * - getActiveNodesInRegion(uint8 region) returns bytes32[]
   * - getEdgeNode(bytes32 nodeId) returns EdgeNode struct
   */
  private async getBootstrapNodesFromChain(
    rpcUrl: string,
    chainId: number,
  ): Promise<string[]> {
    try {
      const { createPublicClient, http } = await import('viem')
      const { getContractAddresses } = await import('../../api/lib/contracts')

      const publicClient = createPublicClient({
        transport: http(rpcUrl),
      })

      const addresses = getContractAddresses(chainId)

      if (
        addresses.cdnRegistry === '0x0000000000000000000000000000000000000000'
      ) {
        console.log(chalk.dim('  CDN registry not deployed yet'))
        return this.getFallbackBootstrapNodes()
      }

      // Real CDNRegistry ABI matching the contract
      const CDN_REGISTRY_ABI = [
        {
          name: 'getActiveNodesInRegion',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'region', type: 'uint8' }],
          outputs: [{ name: '', type: 'bytes32[]' }],
        },
        {
          name: 'getEdgeNode',
          type: 'function',
          stateMutability: 'view',
          inputs: [{ name: 'nodeId', type: 'bytes32' }],
          outputs: [
            {
              name: '',
              type: 'tuple',
              components: [
                { name: 'nodeId', type: 'bytes32' },
                { name: 'operator', type: 'address' },
                { name: 'endpoint', type: 'string' },
                { name: 'region', type: 'uint8' },
                { name: 'providerType', type: 'uint8' },
                { name: 'status', type: 'uint8' },
                { name: 'stake', type: 'uint256' },
                { name: 'registeredAt', type: 'uint256' },
                { name: 'lastSeen', type: 'uint256' },
                { name: 'agentId', type: 'uint256' },
              ],
            },
          ],
        },
      ] as const

      // Query all regions (0-6 based on ICDNTypes.Region enum)
      const endpoints: string[] = []

      for (let region = 0; region <= 6; region++) {
        try {
          const nodeIds = await publicClient.readContract({
            address: addresses.cdnRegistry,
            abi: CDN_REGISTRY_ABI,
            functionName: 'getActiveNodesInRegion',
            args: [region],
          })

          // Fetch endpoint for each node (limit to first 5 per region)
          for (const nodeId of nodeIds.slice(0, 5)) {
            try {
              const node = await publicClient.readContract({
                address: addresses.cdnRegistry,
                abi: CDN_REGISTRY_ABI,
                functionName: 'getEdgeNode',
                args: [nodeId],
              })

              if (node.endpoint && node.status === 0) {
                // 0 = HEALTHY
                endpoints.push(node.endpoint)
              }
            } catch {
              // Skip nodes that fail to fetch
            }
          }

          // Stop if we have enough nodes
          if (endpoints.length >= 10) break
        } catch {
          // Region may have no nodes
        }
      }

      if (endpoints.length > 0) {
        console.log(
          chalk.dim(
            `  Found ${endpoints.length} bootstrap nodes from on-chain registry`,
          ),
        )
        return endpoints
      }
    } catch (error) {
      console.log(
        chalk.dim(
          `  Could not fetch on-chain nodes: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }

    // Fallback to well-known seed nodes (only used during initial network bootstrap)
    return this.getFallbackBootstrapNodes()
  }

  /**
   * Fallback bootstrap nodes - ONLY used when on-chain registry is empty
   * This enables initial network bootstrap before any nodes are registered
   */
  private getFallbackBootstrapNodes(): string[] {
    const fallbackNodes: Record<NetworkType, string[]> = {
      localnet: [], // Local dev: nodes discover each other via mDNS or direct connection
      testnet: [
        // Seed nodes operated by Jeju - nodes should register on-chain ASAP
        'wss://edge-seed-1.testnet.jejunetwork.org',
        'wss://edge-seed-2.testnet.jejunetwork.org',
      ],
      mainnet: [
        'wss://edge-seed-1.jejunetwork.org',
        'wss://edge-seed-2.jejunetwork.org',
      ],
    }

    if (fallbackNodes[this.config.network].length > 0) {
      console.log(
        chalk.yellow(
          '  Using fallback seed nodes (register on-chain for decentralized discovery)',
        ),
      )
    }

    return fallbackNodes[this.config.network]
  }

  private async startEnabledServices(): Promise<void> {
    if (!this.services) return

    const servicesToStart: Array<{
      name: string
      enabled: boolean
      start: () => Promise<void>
    }> = [
      // ============================================================
      // Core Infrastructure Services
      // ============================================================
      {
        name: 'Compute',
        enabled: this.config.all || this.config.enableCompute,
        start: async () => {
          await this.services?.compute.start()
        },
      },
      {
        name: 'Storage',
        enabled:
          this.config.all ||
          this.config.enableStorage ||
          (!this.config.minimal && !this.hasExplicitServices()),
        start: async () => {
          await this.services?.torrent.start()
        },
      },
      {
        name: 'Database',
        enabled: this.config.all || this.config.enableDatabase,
        start: async () => {
          await this.services?.database.start()
        },
      },
      {
        name: 'CDN',
        enabled:
          this.config.all ||
          this.config.enableCDN ||
          (!this.config.minimal && !this.hasExplicitServices()),
        start: async () => {
          await this.services?.edgeCoordinator.start()
        },
      },

      // ============================================================
      // Network Services
      // ============================================================
      {
        name: 'VPN Exit',
        enabled: this.config.all || this.config.enableVPN,
        start: async () => {
          await this.services?.vpn.start()
        },
      },
      {
        name: 'Residential Proxy',
        enabled: this.config.all || this.config.enableProxy,
        start: async () => {
          await this.services?.proxy.start()
        },
      },

      // ============================================================
      // Chain Infrastructure Services
      // ============================================================
      {
        name: 'Sequencer',
        enabled: this.config.all || this.config.enableSequencer,
        start: async () => {
          await this.services?.sequencer.start()
        },
      },
      {
        name: 'Bridge',
        enabled: this.config.all || this.config.enableBridge,
        start: async () => {
          await this.services?.bridge.start()
        },
      },
      {
        name: 'Oracle',
        enabled: this.config.all || this.config.enableOracle,
        start: async () => {
          await this.services?.oracle.start()
        },
      },
      {
        name: 'Cron',
        enabled:
          this.config.all ||
          (!this.config.minimal && !this.hasExplicitServices()),
        start: async () => {
          await this.services?.cron.start()
        },
      },
    ]

    for (const service of servicesToStart) {
      if (service.enabled) {
        await this.startService(service.name, service.start)
      }
    }
  }

  private hasExplicitServices(): boolean {
    return (
      this.config.enableCompute ||
      this.config.enableStorage ||
      this.config.enableVPN ||
      this.config.enableProxy ||
      this.config.enableOracle ||
      this.config.enableSequencer ||
      this.config.enableBridge ||
      this.config.enableDatabase ||
      this.config.enableCDN
    )
  }

  private async startService(
    name: string,
    startFn: () => Promise<void>,
  ): Promise<void> {
    const serviceInfo: RunningService = {
      name,
      started: false,
      error: null,
    }

    console.log(chalk.dim(`  Starting ${name}...`))

    try {
      await startFn()
      serviceInfo.started = true
      console.log(chalk.green(`  ✓ ${name} started`))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      serviceInfo.error = message
      console.log(chalk.red(`  ✗ ${name} failed: ${message}`))
    }

    this.runningServices.set(name, serviceInfo)
  }

  private setupSignalHandlers(): void {
    const shutdown = async (signal: string) => {
      if (this.isShuttingDown) return
      this.isShuttingDown = true

      console.log(chalk.yellow(`\n  Received ${signal}, shutting down...`))
      await this.stop()
      process.exit(0)
    }

    process.on('SIGINT', () => shutdown('SIGINT'))
    process.on('SIGTERM', () => shutdown('SIGTERM'))
  }

  async stop(): Promise<void> {
    if (!this.services) return

    console.log(chalk.dim('  Stopping services...'))

    // Stop in reverse order (chain infrastructure first, then network, then core)
    const stopFns: Array<{ name: string; stop: () => Promise<void> }> = [
      // Chain infrastructure - stop first (need chain access)
      { name: 'Cron', stop: async () => this.services?.cron.stop() },
      { name: 'Oracle', stop: async () => this.services?.oracle.stop() },
      { name: 'Bridge', stop: async () => this.services?.bridge.stop() },
      { name: 'Sequencer', stop: async () => this.services?.sequencer.stop() },

      // Network services
      {
        name: 'Residential Proxy',
        stop: async () => this.services?.proxy.stop(),
      },
      { name: 'VPN Exit', stop: async () => this.services?.vpn.stop() },

      // Core infrastructure - stop last
      {
        name: 'CDN',
        stop: async () => this.services?.edgeCoordinator.stop(),
      },
      { name: 'Database', stop: async () => this.services?.database.stop() },
      { name: 'Storage', stop: async () => this.services?.torrent.stop() },
      { name: 'Compute', stop: async () => this.services?.compute.stop() },
    ]

    for (const { name, stop } of stopFns) {
      if (this.runningServices.get(name)?.started) {
        try {
          await stop()
          console.log(chalk.dim(`  Stopped ${name}`))
        } catch (error) {
          console.log(
            chalk.red(
              `  Failed to stop ${name}: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        }
      }
    }

    console.log(chalk.green('  Shutdown complete'))
  }

  private startHealthMonitor(): void {
    // Log health status every 60 seconds
    setInterval(() => {
      if (this.isShuttingDown) return

      const running = Array.from(this.runningServices.values()).filter(
        (s) => s.started,
      )
      const failed = Array.from(this.runningServices.values()).filter(
        (s) => s.error,
      )

      console.log(
        chalk.dim(
          `  [${new Date().toISOString()}] Health: ${running.length} running, ${failed.length} failed`,
        ),
      )
    }, 60 * 1000)
  }

  private async keepAlive(): Promise<void> {
    return new Promise((resolve) => {
      const checkShutdown = () => {
        if (this.isShuttingDown) {
          resolve()
        } else {
          setTimeout(checkShutdown, 1000)
        }
      }
      checkShutdown()
    })
  }
}

// CLI
const program = new Command()

program
  .name(`${networkName.toLowerCase()}-daemon`)
  .description('Node daemon for running services')
  .version(VERSION)

program
  .option('-a, --all', 'Enable all services')
  .option('-m, --minimal', 'Only essential services')
  .option(
    '-n, --network <network>',
    'Network (mainnet, testnet, localnet)',
    'localnet',
  )
  .option('--compute', 'Enable compute service')
  .option('--storage', 'Enable storage service')
  .option('--vpn', 'Enable VPN exit service')
  .option('--proxy', 'Enable residential proxy')
  .option('--oracle', 'Enable oracle service')
  .option('--sequencer', 'Enable sequencer participation')
  .option('--bridge', 'Enable bridge relaying')
  .option('--database', 'Enable SQLit database hosting')
  .option('--cdn', 'Enable CDN/edge service')
  .option(
    '--key-id <keyId>',
    'KMS key ID for signing',
    process.env.KMS_KEY_ID ?? '',
  )
  .action(async (options) => {
    const NetworkSchema = z.enum(['mainnet', 'testnet', 'localnet'])

    try {
      const network = NetworkSchema.parse(options.network)

      const config: DaemonConfig = {
        network,
        all: options.all ?? false,
        minimal: options.minimal ?? false,
        enableCompute:
          options.compute ??
          (process.env.JEJU_ENABLE_CPU === '1' ||
            process.env.JEJU_ENABLE_GPU === '1'),
        enableStorage: options.storage ?? false,
        enableVPN: options.vpn ?? false,
        enableProxy: options.proxy ?? false,
        enableOracle: options.oracle ?? false,
        enableSequencer: options.sequencer ?? false,
        enableBridge: options.bridge ?? false,
        enableDatabase: options.database ?? false,
        enableCDN: options.cdn ?? false,
        keyId: options.keyId,
      }

      if (!config.keyId) {
        console.log(
          chalk.yellow(
            '  Warning: No KMS key ID provided. Some services will not work.',
          ),
        )
        console.log(
          chalk.yellow(
            '  Set KMS_KEY_ID environment variable or use --key-id option.',
          ),
        )
      }

      const daemon = new NodeDaemon(config)
      await daemon.start()
    } catch (e) {
      if (e instanceof z.ZodError) {
        console.error(chalk.red('\n  Configuration Error:'))
        for (const issue of e.issues) {
          console.error(
            chalk.red(`    ${issue.path.join('.')}: ${issue.message}`),
          )
        }
        process.exit(1)
      }
      throw e
    }
  })

program.parse()
