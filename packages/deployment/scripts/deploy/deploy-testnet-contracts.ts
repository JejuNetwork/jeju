#!/usr/bin/env bun
/**
 * Deploy All Testnet Contracts
 *
 * Orchestrates deployment of all Jeju contracts to testnet.
 * Runs Foundry scripts in the correct order with dependencies.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy/deploy-testnet-contracts.ts
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy/deploy-testnet-contracts.ts --phase dws
 *   DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy/deploy-testnet-contracts.ts --dry-run
 */

import { type ExecSyncOptions, execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { type Address, createPublicClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const CONFIG_DIR = join(ROOT, 'packages/config')

// Jeju Testnet configuration
const TESTNET_RPC = 'https://testnet-rpc.jejunetwork.org'
const TESTNET_CHAIN_ID = 420690

interface DeploymentPhase {
  name: string
  description: string
  script: string
  dependsOn: string[]
  envVars?: Record<string, string>
  skipOnMissingScript?: boolean
}

interface DeploymentResult {
  phase: string
  success: boolean
  contracts: Record<string, Address>
  txHash?: string
  error?: string
}

// Deployment phases in order
const DEPLOYMENT_PHASES: DeploymentPhase[] = [
  {
    name: 'dws',
    description: 'JNS + Storage + Workers + CDN + Git + Packages',
    script: 'script/DeployDWS.s.sol:DeployDWS',
    dependsOn: [],
  },
  {
    name: 'x402',
    description: 'x402 Payment Protocol',
    script: 'script/DeployX402.s.sol:DeployX402',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'decentralization',
    description: 'Decentralization contracts (Sequencer, Governance)',
    script: 'script/DeployDecentralization.s.sol:DeployDecentralization',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'commerce',
    description: 'Commerce contracts (Escrow, Payments)',
    script: 'script/DeployCommerce.s.sol:DeployCommerce',
    dependsOn: ['dws', 'x402'],
    skipOnMissingScript: true,
  },
  {
    name: 'chainlink',
    description: 'Chainlink VRF and Automation',
    script: 'script/DeployChainlink.s.sol:DeployChainlink',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'training',
    description: 'AI Training infrastructure',
    script: 'script/DeployTraining.s.sol:DeployTraining',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'federation',
    description: 'Federation contracts',
    script: 'script/DeployFederation.s.sol:DeployFederation',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'da',
    description: 'Data Availability contracts',
    script: 'script/DeployDA.s.sol:DeployDA',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'decentralized-rpc',
    description: 'Decentralized RPC contracts',
    script: 'script/DeployDecentralizedRPC.s.sol:DeployDecentralizedRPC',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'liquidity',
    description: 'Liquidity contracts',
    script: 'script/DeployLiquidity.s.sol:DeployLiquidity',
    dependsOn: ['dws', 'x402'],
    skipOnMissingScript: true,
  },
  {
    name: 'dao-registry',
    description: 'DAO Registry contracts',
    script: 'script/DeployDAORegistry.s.sol:DeployDAORegistry',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'git-pkg',
    description: 'Git and Package Registry (additional)',
    script: 'script/DeployGitPkg.s.sol:DeployGitPkg',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'content-registry',
    description: 'Content Registry',
    script: 'script/DeployContentRegistry.s.sol:DeployContentRegistry',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
  {
    name: 'proof-of-cloud',
    description: 'Proof of Cloud compute contracts',
    script: 'script/DeployProofOfCloud.s.sol:DeployProofOfCloud',
    dependsOn: ['dws'],
    skipOnMissingScript: true,
  },
]

class ContractDeployer {
  private privateKey: `0x${string}`
  private deployerAddress: Address
  private dryRun: boolean
  private phase: string | null
  private results: DeploymentResult[] = []
  private deployedContracts: Record<string, Address> = {}

  constructor(
    privateKey: `0x${string}`,
    dryRun = false,
    phase: string | null = null,
  ) {
    this.privateKey = privateKey
    this.dryRun = dryRun
    this.phase = phase
    this.deployerAddress = privateKeyToAccount(privateKey).address
  }

  private log(
    message: string,
    level: 'info' | 'success' | 'error' | 'warn' = 'info',
  ): void {
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }
    const colors = {
      info: '\x1b[36m',
      success: '\x1b[32m',
      error: '\x1b[31m',
      warn: '\x1b[33m',
    }
    console.log(`${colors[level]}${icons[level]}  ${message}\x1b[0m`)
  }

  async run(): Promise<void> {
    this.printBanner()

    // Check balance
    await this.checkBalance()

    // Load existing deployments
    this.loadExistingDeployments()

    // Run deployment phases
    const phases = this.phase
      ? DEPLOYMENT_PHASES.filter((p) => p.name === this.phase)
      : DEPLOYMENT_PHASES

    for (const phase of phases) {
      console.log(`\n${'═'.repeat(70)}`)
      console.log(`📋 Phase: ${phase.name}`)
      console.log(`   ${phase.description}`)
      console.log(`${'═'.repeat(70)}\n`)

      // Check dependencies
      const missingDeps = phase.dependsOn.filter(
        (dep) => !this.isPhaseComplete(dep),
      )
      if (missingDeps.length > 0 && this.phase === null) {
        this.log(`Missing dependencies: ${missingDeps.join(', ')}`, 'warn')
      }

      // Check if script exists
      const scriptPath = join(CONTRACTS_DIR, phase.script.split(':')[0])
      if (!existsSync(scriptPath)) {
        if (phase.skipOnMissingScript) {
          this.log(`Script not found: ${phase.script} (skipping)`, 'warn')
          continue
        }
        this.log(`Script not found: ${phase.script}`, 'error')
        this.results.push({
          phase: phase.name,
          success: false,
          contracts: {},
          error: 'Script not found',
        })
        continue
      }

      // Deploy
      const result = await this.deployPhase(phase)
      this.results.push(result)

      if (result.success) {
        // Update deployed contracts
        Object.assign(this.deployedContracts, result.contracts)
        this.saveDeployments()
        this.log(`Phase ${phase.name} complete`, 'success')
      } else {
        this.log(`Phase ${phase.name} failed: ${result.error}`, 'error')
        if (!this.dryRun) {
          // Continue to next phase even if one fails
          this.log('Continuing to next phase...', 'warn')
        }
      }
    }

    // Save final state
    this.saveDeployments()
    this.updateContractsConfig()

    this.printSummary()
  }

  private printBanner(): void {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   📜 JEJU TESTNET CONTRACT DEPLOYMENT                                    ║
║                                                                          ║
║   Chain: Jeju Testnet (${TESTNET_CHAIN_ID})                                        ║
║   Deployer: ${this.deployerAddress}                ║
║   ${this.dryRun ? '🔍 DRY RUN MODE - No transactions will be sent' : '🚀 LIVE DEPLOYMENT MODE'}                              ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
  }

  private async checkBalance(): Promise<void> {
    this.log('Checking deployer balance...', 'info')

    const client = createPublicClient({
      transport: http(TESTNET_RPC),
    })

    const balance = await client
      .getBalance({ address: this.deployerAddress })
      .catch(() => null)

    if (balance === null) {
      this.log('Could not connect to testnet RPC', 'warn')
      this.log('RPC may be down or not yet deployed', 'warn')

      if (!this.dryRun) {
        this.log('Use --dry-run to preview deployment without RPC', 'info')
      }
      return
    }

    const balanceEth = parseFloat(formatEther(balance))
    this.log(`Balance: ${balanceEth.toFixed(4)} ETH`, 'info')

    if (balanceEth < 1 && !this.dryRun) {
      this.log('Low balance - deployment may fail. Recommend 1+ ETH.', 'warn')
    }
  }

  private loadExistingDeployments(): void {
    const deploymentFile = join(
      CONTRACTS_DIR,
      'deployments/testnet/deployment.json',
    )
    if (existsSync(deploymentFile)) {
      const data = JSON.parse(readFileSync(deploymentFile, 'utf-8'))
      this.deployedContracts = this.flattenContracts(data)
      this.log(
        `Loaded ${Object.keys(this.deployedContracts).length} existing contract addresses`,
        'info',
      )
    }
  }

  private flattenContracts(
    obj: Record<string, unknown>,
    prefix = '',
  ): Record<string, Address> {
    const result: Record<string, Address> = {}
    for (const [key, value] of Object.entries(obj)) {
      if (
        typeof value === 'string' &&
        value.startsWith('0x') &&
        value.length === 42
      ) {
        result[prefix ? `${prefix}.${key}` : key] = value as Address
      } else if (typeof value === 'object' && value !== null) {
        Object.assign(
          result,
          this.flattenContracts(
            value as Record<string, unknown>,
            prefix ? `${prefix}.${key}` : key,
          ),
        )
      }
    }
    return result
  }

  private isPhaseComplete(phaseName: string): boolean {
    // Check if we have contracts from this phase
    const phaseContracts: Record<string, string[]> = {
      dws: [
        'jnsRegistry',
        'storageManager',
        'workerRegistry',
        'JNSRegistry',
        'StorageManager',
        'WorkerRegistry',
      ],
      x402: ['x402Facilitator', 'X402Facilitator'],
      decentralization: ['sequencerRegistry', 'SequencerRegistry'],
    }

    const expected = phaseContracts[phaseName] || []
    return expected.some((c) =>
      Object.keys(this.deployedContracts).some((k) =>
        k.toLowerCase().includes(c.toLowerCase()),
      ),
    )
  }

  private async deployPhase(phase: DeploymentPhase): Promise<DeploymentResult> {
    if (this.dryRun) {
      this.log(`[DRY RUN] Would run: forge script ${phase.script}`, 'info')
      return {
        phase: phase.name,
        success: true,
        contracts: {},
      }
    }

    // Build environment variables
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      DEPLOYER_PRIVATE_KEY: this.privateKey,
      ...phase.envVars,
    }

    // Build forge command
    const cmd = [
      'forge',
      'script',
      phase.script,
      '--rpc-url',
      TESTNET_RPC,
      '--broadcast',
      '--legacy',
      '-vvv',
    ].join(' ')

    this.log(`Running: ${cmd}`, 'info')

    const options: ExecSyncOptions = {
      cwd: CONTRACTS_DIR,
      encoding: 'utf-8',
      maxBuffer: 100 * 1024 * 1024,
      env,
      stdio: 'pipe',
    }

    const output = execSync(cmd, options) as string

    // Parse deployed addresses from output
    const contracts = this.parseDeploymentOutput(output)

    // Also check broadcast files
    const broadcastContracts = this.parseBroadcastFiles(phase.script)
    Object.assign(contracts, broadcastContracts)

    return {
      phase: phase.name,
      success: true,
      contracts,
    }
  }

  private parseDeploymentOutput(output: string): Record<string, Address> {
    const contracts: Record<string, Address> = {}
    const addressPattern = /([A-Za-z0-9_]+):\s*(0x[a-fA-F0-9]{40})/g

    let match = addressPattern.exec(output)
    while (match !== null) {
      const [, name, address] = match
      contracts[name] = address as Address
      this.log(`Deployed: ${name} at ${address}`, 'success')
      match = addressPattern.exec(output)
    }

    return contracts
  }

  private parseBroadcastFiles(script: string): Record<string, Address> {
    const contracts: Record<string, Address> = {}
    const scriptPath = script.split(':')[0]
    const broadcastDir = join(
      CONTRACTS_DIR,
      `broadcast/${scriptPath}/${TESTNET_CHAIN_ID}`,
    )

    const runLatest = join(broadcastDir, 'run-latest.json')
    if (existsSync(runLatest)) {
      const broadcast = JSON.parse(readFileSync(runLatest, 'utf-8'))
      for (const tx of broadcast.transactions || []) {
        if (
          tx.transactionType === 'CREATE' &&
          tx.contractName &&
          tx.contractAddress
        ) {
          contracts[tx.contractName] = tx.contractAddress
          this.log(
            `Found in broadcast: ${tx.contractName} at ${tx.contractAddress}`,
            'info',
          )
        }
      }
    }

    return contracts
  }

  private saveDeployments(): void {
    const deploymentDir = join(CONTRACTS_DIR, 'deployments/testnet')
    if (!existsSync(deploymentDir)) {
      mkdirSync(deploymentDir, { recursive: true })
    }

    const deploymentFile = join(deploymentDir, 'deployment.json')
    const data = {
      network: 'testnet',
      chainId: TESTNET_CHAIN_ID,
      deployedAt: new Date().toISOString(),
      deployer: this.deployerAddress,
      contracts: this.deployedContracts,
    }

    writeFileSync(deploymentFile, JSON.stringify(data, null, 2))
    this.log(`Saved deployments to ${deploymentFile}`, 'success')
  }

  private updateContractsConfig(): void {
    const configFile = join(CONFIG_DIR, 'contracts.json')
    if (!existsSync(configFile)) {
      this.log('contracts.json not found, skipping config update', 'warn')
      return
    }

    const config = JSON.parse(readFileSync(configFile, 'utf-8'))

    // Map contract names to config paths
    const mapping: Record<string, string> = {
      JNSRegistry: 'testnet.jns.registry',
      JNSResolver: 'testnet.jns.resolver',
      JNSRegistrar: 'testnet.jns.registrar',
      JNSReverseRegistrar: 'testnet.jns.reverseRegistrar',
      StorageManager: 'testnet.dws.storageManager',
      WorkerRegistry: 'testnet.dws.workerRegistry',
      CDNRegistry: 'testnet.cdn.registry',
      RepoRegistry: 'testnet.dws.gitRegistry',
      PackageRegistry: 'testnet.dws.packageRegistry',
      X402Facilitator: 'testnet.payments.x402Facilitator',
    }

    for (const [contractName, address] of Object.entries(
      this.deployedContracts,
    )) {
      const configPath = mapping[contractName]
      if (configPath) {
        const parts = configPath.split('.')
        let obj = config
        for (let i = 0; i < parts.length - 1; i++) {
          obj = obj[parts[i]] = obj[parts[i]] || {}
        }
        obj[parts[parts.length - 1]] = address
      }
    }

    config.lastUpdated = new Date().toISOString().split('T')[0]
    writeFileSync(configFile, JSON.stringify(config, null, 2))
    this.log(`Updated contracts.json`, 'success')
  }

  private printSummary(): void {
    const successful = this.results.filter((r) => r.success).length
    const failed = this.results.filter((r) => !r.success).length

    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                     DEPLOYMENT SUMMARY                                    ║
╠══════════════════════════════════════════════════════════════════════════╣
║  Phases Run:     ${String(this.results.length).padEnd(4)}                                                ║
║  Successful:     ${String(successful).padEnd(4)} ✅                                              ║
║  Failed:         ${String(failed).padEnd(4)} ❌                                              ║
╠══════════════════════════════════════════════════════════════════════════╣
║  DEPLOYED CONTRACTS:                                                     ║`)

    const contracts = Object.entries(this.deployedContracts)
    for (const [name, address] of contracts.slice(0, 15)) {
      console.log(`║    ${name.padEnd(30)} ${address}  ║`)
    }
    if (contracts.length > 15) {
      console.log(
        `${`║    ... and ${contracts.length - 15} more contracts`.padEnd(73)}║`,
      )
    }

    console.log(`╠══════════════════════════════════════════════════════════════════════════╣
║  NEXT STEPS:                                                             ║
║  1. Update contracts.json: bun run update-contracts                      ║
║  2. Deploy apps via DWS: bun run deploy:testnet-babylon                  ║
║  3. Verify deployment: bun run verify:testnet                            ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      phase: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
Deploy Testnet Contracts

Usage:
  DEPLOYER_PRIVATE_KEY=0x... bun run scripts/deploy/deploy-testnet-contracts.ts [options]

Options:
  --dry-run        Preview deployment without sending transactions
  -p, --phase <n>  Deploy only specific phase (dws, x402, etc.)
  -h, --help       Show this help

Phases (in order):
${DEPLOYMENT_PHASES.map((p, i) => `  ${i + 1}. ${p.name.padEnd(20)} ${p.description}`).join('\n')}

Environment:
  DEPLOYER_PRIVATE_KEY  Required. Private key with ETH on testnet.
`)
    process.exit(0)
  }

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  if (!privateKey) {
    console.error('❌ DEPLOYER_PRIVATE_KEY or PRIVATE_KEY is required')
    process.exit(1)
  }

  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error(
      '❌ Invalid private key format. Must be 0x-prefixed 64-character hex string.',
    )
    process.exit(1)
  }

  const deployer = new ContractDeployer(
    privateKey as `0x${string}`,
    values['dry-run'],
    values.phase || null,
  )
  await deployer.run()
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error.message)
  process.exit(1)
})
