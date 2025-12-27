/**
 * Local Bootstrap Script
 *
 * Boots a complete DWS stack locally with NO external dependencies:
 * - L1 devnet (anvil)
 * - L2 (op-geth in dev mode)
 * - IPFS daemon
 * - DWS services
 * - JNS contracts
 *
 * This enables fully local development and testing without any cloud services.
 */

import { type ChildProcess, execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = join(__dirname, '../../..')
const DATA_DIR = join(ROOT_DIR, '.local-dws')

interface ServiceConfig {
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  cwd?: string
  readyPattern?: RegExp
  port?: number
}

interface BootstrapConfig {
  l1Port: number
  l2Port: number
  ipfsApiPort: number
  ipfsGatewayPort: number
  dwsPort: number
  jnsGatewayPort: number
}

const DEFAULT_CONFIG: BootstrapConfig = {
  l1Port: 8545,
  l2Port: 9545,
  ipfsApiPort: 5001,
  ipfsGatewayPort: 8080,
  dwsPort: 4030,
  jnsGatewayPort: 4080,
}

class LocalBootstrap {
  private config: BootstrapConfig
  private processes: Map<string, ChildProcess> = new Map()
  private deployedContracts: Record<string, string> = {}

  constructor(config: Partial<BootstrapConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Bootstrap everything
   */
  async bootstrap(): Promise<void> {
    console.log(
      '╔═══════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                 DWS LOCAL BOOTSTRAP                          ║',
    )
    console.log(
      '║      Complete decentralized stack - no cloud required        ║',
    )
    console.log(
      '╚═══════════════════════════════════════════════════════════════╝',
    )
    console.log()

    // Create data directory
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true })
    }

    // Step 1: Start L1 (Anvil)
    console.log(
      '┌─ Step 1: Starting L1 (Anvil) ─────────────────────────────────┐',
    )
    await this.startService({
      name: 'l1',
      command: 'anvil',
      args: [
        '--port',
        String(this.config.l1Port),
        '--chain-id',
        '31337',
        '--block-time',
        '1',
        '--accounts',
        '10',
        '--balance',
        '10000',
      ],
      readyPattern: /Listening on/,
      port: this.config.l1Port,
    })
    console.log(
      `└─ L1 running on http://localhost:${this.config.l1Port} ─────────────────────┘`,
    )
    console.log()

    // Step 2: Deploy core contracts
    console.log(
      '┌─ Step 2: Deploying Core Contracts ────────────────────────────┐',
    )
    await this.deployContracts()
    console.log(
      '└─ Contracts deployed ──────────────────────────────────────────┘',
    )
    console.log()

    // Step 3: Start IPFS
    console.log(
      '┌─ Step 3: Starting IPFS ───────────────────────────────────────┐',
    )
    await this.startIPFS()
    console.log(
      `└─ IPFS running (API: ${this.config.ipfsApiPort}, Gateway: ${this.config.ipfsGatewayPort}) ─────────────┘`,
    )
    console.log()

    // Step 4: Start L2 (op-geth dev mode)
    console.log(
      '┌─ Step 4: Starting L2 (op-geth dev mode) ──────────────────────┐',
    )
    await this.startL2()
    console.log(
      `└─ L2 running on http://localhost:${this.config.l2Port} ─────────────────────┘`,
    )
    console.log()

    // Step 5: Start DWS
    console.log(
      '┌─ Step 5: Starting DWS Services ───────────────────────────────┐',
    )
    await this.startDWS()
    console.log(
      `└─ DWS running on http://localhost:${this.config.dwsPort} ───────────────────┘`,
    )
    console.log()

    // Print summary
    this.printSummary()

    // Save state
    this.saveState()
  }

  /**
   * Start a service
   */
  private async startService(config: ServiceConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`  Starting ${config.name}...`)

      const proc = spawn(config.command, config.args, {
        cwd: config.cwd ?? ROOT_DIR,
        env: { ...process.env, ...config.env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      this.processes.set(config.name, proc)

      let resolved = false

      const checkReady = (data: Buffer) => {
        const text = data.toString()
        if (!resolved && config.readyPattern?.test(text)) {
          resolved = true
          resolve()
        }
      }

      proc.stdout?.on('data', checkReady)
      proc.stderr?.on('data', checkReady)

      proc.on('error', (err) => {
        if (!resolved) {
          reject(new Error(`Failed to start ${config.name}: ${err.message}`))
        }
      })

      proc.on('exit', (code) => {
        if (!resolved && code !== 0) {
          reject(new Error(`${config.name} exited with code ${code}`))
        }
      })

      // Timeout if no ready pattern
      if (!config.readyPattern) {
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            resolve()
          }
        }, 2000)
      }

      // Timeout for ready pattern
      setTimeout(() => {
        if (!resolved) {
          resolved = true
          resolve() // Assume it's ready if pattern not seen after 10s
        }
      }, 10000)
    })
  }

  /**
   * Deploy core contracts using forge
   */
  private async deployContracts(): Promise<void> {
    const contractsDir = join(ROOT_DIR, 'packages/contracts')
    const rpcUrl = `http://localhost:${this.config.l1Port}`

    // Deploy JNS Registry
    console.log('  Deploying JNS Registry...')
    const jnsRegistry = this.deployContract(contractsDir, 'JNSRegistry', rpcUrl)
    this.deployedContracts.jnsRegistry = jnsRegistry

    // Deploy JNS Resolver
    console.log('  Deploying JNS Resolver...')
    const jnsResolver = this.deployContract(
      contractsDir,
      'JNSResolver',
      rpcUrl,
      [jnsRegistry],
    )
    this.deployedContracts.jnsResolver = jnsResolver

    // Deploy Storage Market
    console.log('  Deploying Storage Market...')
    const storageMarket = this.deployContract(
      contractsDir,
      'StorageMarket',
      rpcUrl,
    )
    this.deployedContracts.storageMarket = storageMarket

    // Deploy CDN Registry
    console.log('  Deploying CDN Registry...')
    const cdnRegistry = this.deployContract(contractsDir, 'CDNRegistry', rpcUrl)
    this.deployedContracts.cdnRegistry = cdnRegistry

    // Deploy Compute Registry
    console.log('  Deploying Compute Registry...')
    const computeRegistry = this.deployContract(
      contractsDir,
      'ComputeRegistry',
      rpcUrl,
    )
    this.deployedContracts.computeRegistry = computeRegistry

    console.log('  All contracts deployed.')
  }

  /**
   * Deploy a single contract
   */
  private deployContract(
    contractsDir: string,
    contractName: string,
    rpcUrl: string,
    constructorArgs: string[] = [],
  ): string {
    // Using anvil's default private key
    const privateKey =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

    const srcPath = this.findContractPath(contractsDir, contractName)
    const argsStr =
      constructorArgs.length > 0
        ? `--constructor-args ${constructorArgs.join(' ')}`
        : ''

    try {
      const result = execSync(
        `forge create ${srcPath}:${contractName} ` +
          `--rpc-url ${rpcUrl} ` +
          `--private-key ${privateKey} ` +
          argsStr,
        {
          cwd: contractsDir,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )

      // Extract deployed address from output
      const match = result.match(/Deployed to: (0x[a-fA-F0-9]{40})/)
      if (!match) {
        throw new Error(`Could not find deployed address for ${contractName}`)
      }

      console.log(`    ${contractName}: ${match[1]}`)
      return match[1]
    } catch (e) {
      console.error(`    Failed to deploy ${contractName}`)
      throw e
    }
  }

  /**
   * Find contract source path
   */
  private findContractPath(contractsDir: string, contractName: string): string {
    const searchDirs = [
      'src',
      'src/names',
      'src/storage',
      'src/compute',
      'src/cdn',
    ]

    for (const dir of searchDirs) {
      const path = join(contractsDir, dir, `${contractName}.sol`)
      if (existsSync(path)) {
        return `${dir}/${contractName}.sol`
      }
    }

    return `src/${contractName}.sol`
  }

  /**
   * Start local IPFS daemon
   */
  private async startIPFS(): Promise<void> {
    const ipfsDir = join(DATA_DIR, 'ipfs')

    // Initialize IPFS if needed
    if (!existsSync(ipfsDir)) {
      console.log('  Initializing IPFS...')
      execSync(`ipfs init --profile server`, {
        env: { ...process.env, IPFS_PATH: ipfsDir },
        stdio: 'pipe',
      })
    }

    // Configure IPFS
    execSync(
      `ipfs config Addresses.API /ip4/0.0.0.0/tcp/${this.config.ipfsApiPort}`,
      { env: { ...process.env, IPFS_PATH: ipfsDir }, stdio: 'pipe' },
    )
    execSync(
      `ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/${this.config.ipfsGatewayPort}`,
      { env: { ...process.env, IPFS_PATH: ipfsDir }, stdio: 'pipe' },
    )

    // Start daemon
    await this.startService({
      name: 'ipfs',
      command: 'ipfs',
      args: ['daemon', '--migrate'],
      env: { IPFS_PATH: ipfsDir },
      readyPattern: /Daemon is ready/,
    })
  }

  /**
   * Start L2 in dev mode
   */
  private async startL2(): Promise<void> {
    // Check if op-geth is available, otherwise use geth --dev
    const useOpGeth = this.commandExists('op-geth')

    if (useOpGeth) {
      await this.startService({
        name: 'l2',
        command: 'op-geth',
        args: [
          '--dev',
          '--dev.period=2',
          '--http',
          '--http.addr=0.0.0.0',
          `--http.port=${this.config.l2Port}`,
          '--http.api=eth,net,web3,debug,txpool',
          '--http.corsdomain=*',
          '--ws',
          '--ws.addr=0.0.0.0',
          `--ws.port=${this.config.l2Port + 1}`,
          '--nodiscover',
          `--datadir=${join(DATA_DIR, 'l2')}`,
        ],
        readyPattern: /HTTP server started/,
        port: this.config.l2Port,
      })
    } else {
      // Fallback to regular geth --dev
      await this.startService({
        name: 'l2',
        command: 'geth',
        args: [
          '--dev',
          '--dev.period=2',
          '--http',
          '--http.addr=0.0.0.0',
          `--http.port=${this.config.l2Port}`,
          '--http.api=eth,net,web3,debug',
          '--http.corsdomain=*',
          '--nodiscover',
          `--datadir=${join(DATA_DIR, 'l2')}`,
        ],
        readyPattern: /HTTP server started/,
        port: this.config.l2Port,
      })
    }
  }

  /**
   * Start DWS services
   */
  private async startDWS(): Promise<void> {
    const dwsDir = join(ROOT_DIR, 'apps/dws')

    await this.startService({
      name: 'dws',
      command: 'bun',
      args: ['run', 'dev'],
      cwd: dwsDir,
      env: {
        PORT: String(this.config.dwsPort),
        RPC_URL: `http://localhost:${this.config.l1Port}`,
        L2_RPC_URL: `http://localhost:${this.config.l2Port}`,
        IPFS_API_URL: `http://localhost:${this.config.ipfsApiPort}`,
        IPFS_GATEWAY_URL: `http://localhost:${this.config.ipfsGatewayPort}`,
        JNS_REGISTRY_ADDRESS: this.deployedContracts.jnsRegistry,
        JNS_RESOLVER_ADDRESS: this.deployedContracts.jnsResolver,
        STORAGE_MARKET_ADDRESS: this.deployedContracts.storageMarket,
        CDN_REGISTRY_ADDRESS: this.deployedContracts.cdnRegistry,
        COMPUTE_REGISTRY_ADDRESS: this.deployedContracts.computeRegistry,
      },
      readyPattern: /listening on/i,
      port: this.config.dwsPort,
    })
  }

  /**
   * Check if a command exists
   */
  private commandExists(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /**
   * Print summary of running services
   */
  private printSummary(): void {
    console.log()
    console.log(
      '╔═══════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║                    LOCAL DWS STACK READY                      ║',
    )
    console.log(
      '╠═══════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Services:                                                     ║',
    )
    console.log(
      `║   L1 RPC:        http://localhost:${this.config.l1Port.toString().padEnd(24)}║`,
    )
    console.log(
      `║   L2 RPC:        http://localhost:${this.config.l2Port.toString().padEnd(24)}║`,
    )
    console.log(
      `║   IPFS API:      http://localhost:${this.config.ipfsApiPort.toString().padEnd(24)}║`,
    )
    console.log(
      `║   IPFS Gateway:  http://localhost:${this.config.ipfsGatewayPort.toString().padEnd(24)}║`,
    )
    console.log(
      `║   DWS:           http://localhost:${this.config.dwsPort.toString().padEnd(24)}║`,
    )
    console.log(
      '╠═══════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Contracts:                                                    ║',
    )
    console.log(
      `║   JNS Registry:     ${this.deployedContracts.jnsRegistry?.slice(0, 20) ?? 'N/A'}...          ║`,
    )
    console.log(
      `║   JNS Resolver:     ${this.deployedContracts.jnsResolver?.slice(0, 20) ?? 'N/A'}...          ║`,
    )
    console.log(
      `║   Storage Market:   ${this.deployedContracts.storageMarket?.slice(0, 20) ?? 'N/A'}...          ║`,
    )
    console.log(
      `║   CDN Registry:     ${this.deployedContracts.cdnRegistry?.slice(0, 20) ?? 'N/A'}...          ║`,
    )
    console.log(
      `║   Compute Registry: ${this.deployedContracts.computeRegistry?.slice(0, 20) ?? 'N/A'}...          ║`,
    )
    console.log(
      '╠═══════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Default Account (for testing):                                ║',
    )
    console.log(
      '║   Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266          ║',
    )
    console.log(
      '║   Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478c...  ║',
    )
    console.log(
      '╠═══════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ Quick Start:                                                  ║',
    )
    console.log(
      '║   jeju deploy ./my-app --network localnet                     ║',
    )
    console.log(
      '║   jeju node setup --network localnet                          ║',
    )
    console.log(
      '╚═══════════════════════════════════════════════════════════════╝',
    )
  }

  /**
   * Save state to file
   */
  private saveState(): void {
    const state = {
      config: this.config,
      contracts: this.deployedContracts,
      startedAt: new Date().toISOString(),
    }

    writeFileSync(join(DATA_DIR, 'state.json'), JSON.stringify(state, null, 2))
  }

  /**
   * Stop all services
   */
  stop(): void {
    console.log('Stopping all services...')
    for (const [name, proc] of this.processes) {
      console.log(`  Stopping ${name}...`)
      proc.kill('SIGTERM')
    }
    this.processes.clear()
  }
}

// CLI
if (import.meta.main) {
  const bootstrap = new LocalBootstrap()

  process.on('SIGINT', () => {
    console.log('\nShutting down...')
    bootstrap.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    bootstrap.stop()
    process.exit(0)
  })

  bootstrap.bootstrap().catch((e) => {
    console.error('Bootstrap failed:', e)
    bootstrap.stop()
    process.exit(1)
  })
}

export { LocalBootstrap, type BootstrapConfig }
