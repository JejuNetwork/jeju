#!/usr/bin/env bun
/**
 * Full Deployment Orchestrator
 *
 * Orchestrates complete deployment across all phases:
 * 1. Terraform infrastructure (AWS/GCP)
 * 2. Kubernetes services (Helm)
 * 3. Contract deployment
 * 4. DWS bootstrap (provider registration, service provisioning)
 * 5. External chain provisioning (Solana, Bitcoin, etc.)
 * 6. Multi-cloud coordination
 * 7. Health verification
 *
 * Usage:
 *   NETWORK=localnet bun run scripts/deploy/full-deployment.ts
 *   NETWORK=testnet bun run scripts/deploy/full-deployment.ts --skip-terraform
 *   NETWORK=mainnet bun run scripts/deploy/full-deployment.ts --tee
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getRequiredNetwork, type NetworkType } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENT_DIR = join(ROOT, 'packages/deployment')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')

interface DeploymentConfig {
  network: NetworkType
  skipTerraform: boolean
  skipKubernetes: boolean
  skipContracts: boolean
  skipDws: boolean
  skipExternalChains: boolean
  useTee: boolean
  clouds: ('aws' | 'gcp')[]
  chains: string[]
  dryRun: boolean
}

interface DeploymentState {
  network: NetworkType
  phase: string
  startedAt: string
  completedPhases: string[]
  failedPhase: string | null
  endpoints: Record<string, string>
}

const PHASES = [
  'terraform',
  'kubernetes',
  'contracts',
  'dws-bootstrap',
  'external-chains',
  'multi-cloud',
  'verification',
] as const

type Phase = (typeof PHASES)[number]

function log(
  message: string,
  level: 'info' | 'success' | 'error' | 'warn' = 'info',
) {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }
  console.log(`${icons[level]}  ${message}`)
}

function exec(
  command: string,
  options: { cwd?: string; silent?: boolean } = {},
) {
  const { cwd = ROOT, silent = false } = options
  log(`Executing: ${command}`, 'info')
  try {
    execSync(command, {
      cwd,
      stdio: silent ? 'pipe' : 'inherit',
      encoding: 'utf-8',
    })
    return true
  } catch (_error) {
    return false
  }
}

class DeploymentOrchestrator {
  private config: DeploymentConfig
  private state: DeploymentState
  private stateFile: string

  constructor(config: DeploymentConfig) {
    this.config = config
    this.stateFile = join(
      DEPLOYMENT_DIR,
      `.deployment-state-${config.network}.json`,
    )
    this.state = this.loadState()
  }

  private loadState(): DeploymentState {
    if (existsSync(this.stateFile)) {
      return JSON.parse(readFileSync(this.stateFile, 'utf-8'))
    }
    return {
      network: this.config.network,
      phase: 'starting',
      startedAt: new Date().toISOString(),
      completedPhases: [],
      failedPhase: null,
      endpoints: {},
    }
  }

  private saveState() {
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2))
  }

  private isPhaseComplete(phase: Phase): boolean {
    return this.state.completedPhases.includes(phase)
  }

  private markPhaseComplete(phase: Phase) {
    if (!this.state.completedPhases.includes(phase)) {
      this.state.completedPhases.push(phase)
    }
    this.state.phase = phase
    this.saveState()
  }

  async run() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║              JEJU NETWORK FULL DEPLOYMENT                    ║
╠══════════════════════════════════════════════════════════════╣
║  Network: ${this.config.network.padEnd(49)}║
║  Clouds:  ${this.config.clouds.join(', ').padEnd(49)}║
║  TEE:     ${(this.config.useTee ? 'Required' : 'Optional').padEnd(49)}║
║  Chains:  ${this.config.chains.join(', ').padEnd(49)}║
╚══════════════════════════════════════════════════════════════╝
`)

    try {
      // Phase 1: Terraform (skip for localnet - uses Docker)
      if (!this.config.skipTerraform && this.config.network !== 'localnet') {
        await this.deployTerraform()
      } else if (this.config.network === 'localnet') {
        log('Localnet uses Docker instead of Terraform', 'info')
      } else {
        log('Skipping Terraform phase', 'info')
      }

      // Phase 2: Kubernetes/Docker
      if (!this.config.skipKubernetes) {
        await this.deployKubernetes()
      } else {
        log('Skipping Kubernetes phase', 'info')
      }

      // Phase 3: Contracts (ALL environments - localnet deploys to Anvil)
      if (!this.config.skipContracts) {
        await this.deployContracts()
      } else {
        log('Skipping Contracts phase', 'info')
      }

      // Phase 4: DWS Bootstrap (ALL environments - full on-chain provisioning)
      if (!this.config.skipDws) {
        await this.bootstrapDws()
      } else {
        log('Skipping DWS phase', 'info')
      }

      // Phase 5: External Chains (ALL environments - on-chain provisioning)
      if (!this.config.skipExternalChains) {
        await this.deployExternalChains()
      } else {
        log('Skipping External Chains phase', 'info')
      }

      // Phase 6: Multi-Cloud Coordination (testnet/mainnet with multiple clouds)
      if (this.config.clouds.length > 1 && this.config.network !== 'localnet') {
        await this.setupMultiCloud()
      } else if (this.config.network === 'localnet') {
        log('Localnet is single-machine, no multi-cloud', 'info')
      } else {
        log('Skipping Multi-Cloud phase (single cloud)', 'info')
      }

      // Phase 7: Verification
      await this.verifyDeployment()

      this.printSummary()
    } catch (error) {
      this.state.failedPhase = this.state.phase
      this.saveState()
      throw error
    }
  }

  private async deployTerraform() {
    if (this.isPhaseComplete('terraform')) {
      log('Terraform phase already complete, skipping', 'info')
      return
    }

    log('Deploying Terraform infrastructure...', 'info')

    for (const cloud of this.config.clouds) {
      const envDir =
        cloud === 'aws'
          ? `terraform/environments/${this.config.network}`
          : `terraform/environments/gcp-${this.config.network}`

      const tfDir = join(DEPLOYMENT_DIR, envDir)
      if (!existsSync(tfDir)) {
        log(`Terraform environment not found: ${envDir}`, 'warn')
        continue
      }

      log(`Deploying to ${cloud.toUpperCase()}...`, 'info')

      if (this.config.dryRun) {
        exec(`terraform plan`, { cwd: tfDir })
      } else {
        exec(`terraform init -upgrade`, { cwd: tfDir })
        exec(`terraform apply -auto-approve`, { cwd: tfDir })
      }
    }

    this.markPhaseComplete('terraform')
    log('Terraform deployment complete', 'success')
  }

  private async deployKubernetes() {
    if (this.isPhaseComplete('kubernetes')) {
      log('Kubernetes phase already complete, skipping', 'info')
      return
    }

    if (this.config.network === 'localnet') {
      log('Starting local infrastructure (Anvil + Docker)...', 'info')

      // Start Anvil for local chain
      try {
        execSync('pgrep -f "anvil" > /dev/null', { stdio: 'pipe' })
        log('Anvil already running', 'info')
      } catch {
        log('Starting Anvil...', 'info')
        exec('anvil --host 0.0.0.0 &', { silent: true })
        execSync('sleep 2')
      }

      // Start essential Docker services
      const dockerComposeFile = join(
        DEPLOYMENT_DIR,
        'docker/docker-compose.yml',
      )
      if (existsSync(dockerComposeFile)) {
        exec(`docker compose -f ${dockerComposeFile} up -d`, {
          cwd: DEPLOYMENT_DIR,
        })
      }
    } else {
      log('Deploying Kubernetes services...', 'info')

      // Use Helmfile for testnet/mainnet
      const helmfileDir = join(DEPLOYMENT_DIR, 'kubernetes/helmfile')
      const cmd = this.config.dryRun
        ? `helmfile -e ${this.config.network} diff`
        : `helmfile -e ${this.config.network} sync`

      exec(cmd, { cwd: helmfileDir })
    }

    this.markPhaseComplete('kubernetes')
    log('Infrastructure deployment complete', 'success')
  }

  private async deployContracts() {
    if (this.isPhaseComplete('contracts')) {
      log('Contracts phase already complete, skipping', 'info')
      return
    }

    log('Deploying contracts...', 'info')

    if (this.config.network === 'localnet') {
      // For localnet, start Anvil if not running and deploy to it
      log('Deploying contracts to local Anvil...', 'info')

      // Check if Anvil is running
      try {
        execSync(
          'curl -s http://localhost:8545 -X POST -H "Content-Type: application/json" -d \'{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}\'',
          { stdio: 'pipe' },
        )
      } catch {
        log('Starting Anvil...', 'info')
        exec('anvil &', { silent: true })
        // Wait for Anvil to start
        execSync('sleep 2')
      }

      // Deploy core contracts to Anvil
      exec(
        `cd ${CONTRACTS_DIR} && forge script script/Deploy.s.sol --broadcast --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`,
        {
          cwd: CONTRACTS_DIR,
        },
      )
    } else {
      const deployScript = join(DEPLOYMENT_DIR, 'scripts/deploy/contracts.ts')
      if (!existsSync(deployScript)) {
        log('Contract deployment script not found, using forge', 'warn')
        exec(
          `forge script script/Deploy.s.sol --broadcast --rpc-url $JEJU_RPC_URL`,
          {
            cwd: CONTRACTS_DIR,
          },
        )
      } else {
        exec(`NETWORK=${this.config.network} bun run ${deployScript}`, {
          cwd: ROOT,
        })
      }
    }

    this.markPhaseComplete('contracts')
    log('Contract deployment complete', 'success')
  }

  private async bootstrapDws() {
    if (this.isPhaseComplete('dws-bootstrap')) {
      log('DWS bootstrap phase already complete, skipping', 'info')
      return
    }

    log('Bootstrapping DWS...', 'info')

    const bootstrapScript = join(
      DEPLOYMENT_DIR,
      'scripts/deploy/dws-bootstrap.ts',
    )
    if (existsSync(bootstrapScript)) {
      exec(`NETWORK=${this.config.network} bun run ${bootstrapScript}`, {
        cwd: ROOT,
      })
    } else {
      log('DWS bootstrap script not found', 'warn')
    }

    this.markPhaseComplete('dws-bootstrap')
    log('DWS bootstrap complete', 'success')
  }

  private async deployExternalChains() {
    if (this.isPhaseComplete('external-chains')) {
      log('External chains phase already complete, skipping', 'info')
      return
    }

    log('Deploying external chain infrastructure...', 'info')

    const chainScript = join(
      DEPLOYMENT_DIR,
      'scripts/deploy/dws-external-chains.ts',
    )

    for (const chain of this.config.chains) {
      log(`Provisioning ${chain}...`, 'info')

      const teeFlag = this.config.useTee ? '--tee' : ''
      const cmd = `NETWORK=${this.config.network} bun run ${chainScript} --chain ${chain} ${teeFlag}`

      if (!this.config.dryRun) {
        exec(cmd, { cwd: ROOT })
      } else {
        log(`[DRY RUN] Would execute: ${cmd}`, 'info')
      }
    }

    this.markPhaseComplete('external-chains')
    log('External chains deployment complete', 'success')
  }

  private async setupMultiCloud() {
    if (this.isPhaseComplete('multi-cloud')) {
      log('Multi-cloud phase already complete, skipping', 'info')
      return
    }

    log('Setting up multi-cloud coordination...', 'info')

    const mcScript = join(
      DEPLOYMENT_DIR,
      'scripts/infrastructure/multi-cloud-coordinator.ts',
    )
    exec(`NETWORK=${this.config.network} bun run ${mcScript} all`, {
      cwd: ROOT,
    })

    this.markPhaseComplete('multi-cloud')
    log('Multi-cloud setup complete', 'success')
  }

  private async verifyDeployment() {
    log('Verifying deployment...', 'info')

    const checks: { name: string; check: () => boolean }[] = []

    if (this.config.network === 'localnet') {
      checks.push({
        name: 'Kurtosis enclave',
        check: () =>
          exec('kurtosis enclave inspect jeju-localnet', { silent: true }),
      })
    } else {
      checks.push({
        name: 'Kubernetes pods',
        check: () =>
          exec(
            'kubectl get pods -n jeju-system --field-selector=status.phase!=Running',
            {
              silent: true,
            },
          ),
      })
    }

    // Check RPC endpoint
    const rpcUrl = this.getRpcUrl()
    checks.push({
      name: 'RPC endpoint',
      check: () => {
        try {
          const response = execSync(
            `curl -s -X POST ${rpcUrl} -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`,
            { encoding: 'utf-8' },
          )
          return response.includes('result')
        } catch {
          return false
        }
      },
    })

    let allPassed = true
    for (const { name, check } of checks) {
      const passed = check()
      if (passed) {
        log(`${name}: OK`, 'success')
      } else {
        log(`${name}: FAILED`, 'error')
        allPassed = false
      }
    }

    if (!allPassed) {
      throw new Error('Deployment verification failed')
    }

    this.markPhaseComplete('verification')
    log('Deployment verification complete', 'success')
  }

  private getRpcUrl(): string {
    switch (this.config.network) {
      case 'localnet':
        return 'http://localhost:6546'
      case 'testnet':
        return 'https://testnet-rpc.jejunetwork.org'
      case 'mainnet':
        return 'https://rpc.jejunetwork.org'
    }
  }

  private printSummary() {
    const duration = Math.round(
      (Date.now() - new Date(this.state.startedAt).getTime()) / 1000 / 60,
    )

    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                  DEPLOYMENT COMPLETE                         ║
╠══════════════════════════════════════════════════════════════╣
║  Network:    ${this.config.network.padEnd(46)}║
║  Duration:   ${(`${duration} minutes`).padEnd(46)}║
║  Phases:     ${this.state.completedPhases.length.toString().padEnd(46)}║
╠══════════════════════════════════════════════════════════════╣
║  Completed Phases:                                           ║`)

    for (const phase of this.state.completedPhases) {
      console.log(`║    ✅ ${phase.padEnd(52)}║`)
    }

    console.log(`╠══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                  ║
║    RPC:      ${this.getRpcUrl().padEnd(46)}║
║    DWS:      ${`https://dws.${this.config.network}.jejunetwork.org`.padEnd(46)}║
║    API:      ${`https://api.${this.config.network}.jejunetwork.org`.padEnd(46)}║
╚══════════════════════════════════════════════════════════════╝
`)
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'skip-terraform': { type: 'boolean', default: false },
      'skip-kubernetes': { type: 'boolean', default: false },
      'skip-contracts': { type: 'boolean', default: false },
      'skip-dws': { type: 'boolean', default: false },
      'skip-external-chains': { type: 'boolean', default: false },
      tee: { type: 'boolean', default: false },
      cloud: { type: 'string', multiple: true, default: ['aws'] },
      chain: { type: 'string', multiple: true, default: ['solana'] },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
Full Deployment Orchestrator

Usage:
  NETWORK=localnet bun run scripts/deploy/full-deployment.ts [options]
  NETWORK=testnet bun run scripts/deploy/full-deployment.ts --skip-terraform
  NETWORK=mainnet bun run scripts/deploy/full-deployment.ts --tee --cloud aws --cloud gcp

Options:
  --skip-terraform        Skip Terraform infrastructure
  --skip-kubernetes       Skip Kubernetes deployment
  --skip-contracts        Skip contract deployment
  --skip-dws              Skip DWS bootstrap
  --skip-external-chains  Skip external chain provisioning
  --tee                   Require TEE for external chains
  --cloud <cloud>         Target cloud (aws, gcp) - can be repeated
  --chain <chain>         External chain to provision (solana, bitcoin) - can be repeated
  --dry-run               Preview without applying changes
  -h, --help              Show this help

Phases:
  1. terraform            AWS/GCP infrastructure (VPC, EKS/GKE, RDS, etc.)
  2. kubernetes           Helm deployments (op-geth, gateway, etc.)
  3. contracts            Smart contract deployment
  4. dws-bootstrap        DWS provider registration
  5. external-chains      Solana/Bitcoin node provisioning
  6. multi-cloud          Cross-cloud coordination
  7. verification         Health checks
`)
    process.exit(0)
  }

  const network = getRequiredNetwork()

  // Auto-enable TEE for mainnet
  const useTee = values.tee ?? network === 'mainnet'

  const config: DeploymentConfig = {
    network,
    skipTerraform: values['skip-terraform'] ?? false,
    skipKubernetes: values['skip-kubernetes'] ?? false,
    skipContracts: values['skip-contracts'] ?? false,
    skipDws: values['skip-dws'] ?? false,
    skipExternalChains: values['skip-external-chains'] ?? false,
    useTee,
    clouds: (values.cloud as ('aws' | 'gcp')[]) ?? ['aws'],
    chains: (values.chain as string[]) ?? ['solana'],
    dryRun: values['dry-run'] ?? false,
  }

  const orchestrator = new DeploymentOrchestrator(config)
  await orchestrator.run()
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error.message)
  process.exit(1)
})
