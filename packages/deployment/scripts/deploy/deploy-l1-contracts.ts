#!/usr/bin/env bun

/**
 * Deploy OP Stack L1 Contracts
 *
 * Uses op-deployer to deploy the core OP Stack L1 contracts:
 * - OptimismPortal
 * - L2OutputOracle
 * - L1CrossDomainMessenger
 * - L1StandardBridge
 * - SystemConfig
 *
 * Prerequisites:
 * - op-deployer installed (go install github.com/ethereum-optimism/optimism/op-deployer@latest)
 * - Funded deployer wallet on Sepolia
 * - Generated operator keys
 *
 * Usage:
 *   bun run scripts/deploy/deploy-l1-contracts.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { $ } from 'bun'
import {
  type ChainConfigValidation,
  ChainConfigValidationSchema,
  DeployConfigSchema,
  expectJson,
  type OpDeployerState,
  OpDeployerStateSchema,
  OperatorKeysArraySchema,
} from '../../schemas'

const ROOT = join(import.meta.dir, '../..')
const KEYS_DIR = join(ROOT, 'packages/deployment/.keys')
const CONFIG_DIR = join(ROOT, 'packages/contracts/deploy-config')
const DEPLOYMENTS_DIR = join(ROOT, 'packages/contracts/deployments/testnet')
const CHAIN_CONFIG_DIR = join(ROOT, 'packages/config/chain')

interface DeploymentResult {
  OptimismPortal: string
  L2OutputOracle: string
  L1CrossDomainMessenger: string
  L1StandardBridge: string
  SystemConfig: string
  AddressManager: string
  ProxyAdmin: string
  L1ERC721Bridge: string
  OptimismMintableERC20Factory: string
}

async function checkPrerequisites(): Promise<boolean> {
  console.log('Checking prerequisites...\n')

  // Check op-deployer
  const opDeployerCheck = await $`which op-deployer`.quiet().nothrow()
  if (opDeployerCheck.exitCode !== 0) {
    const errorMsg = opDeployerCheck.stderr.toString() ?? 'Command not found'
    console.log('❌ op-deployer not found')
    if (process.env.DEBUG) {
      console.log(`   Error: ${errorMsg.split('\n')[0]}`)
    }
    console.log(
      '   Install: go install github.com/ethereum-optimism/optimism/op-deployer@latest',
    )
    console.log(
      '   Or use: curl -L https://github.com/ethereum-optimism/optimism/releases/download/op-deployer/v1.0.0/op-deployer_linux_amd64 -o /usr/local/bin/op-deployer && chmod +x /usr/local/bin/op-deployer',
    )
    return false
  }
  console.log('✅ op-deployer found')

  // Check operator keys
  const keysFile = join(KEYS_DIR, 'testnet-operators.json')
  if (!existsSync(keysFile)) {
    console.log('❌ Operator keys not found')
    console.log('   Run: bun run scripts/deploy/generate-operator-keys.ts')
    return false
  }
  console.log('✅ Operator keys found')

  // Check deploy config
  const configFile = join(CONFIG_DIR, 'testnet.json')
  if (!existsSync(configFile)) {
    console.log('❌ Deploy config not found')
    return false
  }

  const content = readFileSync(configFile, 'utf-8')
  const config = expectJson(content, DeployConfigSchema, 'deploy config')
  if (
    config.p2pSequencerAddress === '0x0000000000000000000000000000000000000000'
  ) {
    console.log('❌ Deploy config not updated with operator addresses')
    console.log('   Run: bun run scripts/deploy/update-deploy-config.ts')
    return false
  }
  console.log('✅ Deploy config updated')

  return true
}

async function deployWithOpDeployer(): Promise<DeploymentResult> {
  const keysFile = join(KEYS_DIR, 'testnet-operators.json')
  const content = readFileSync(keysFile, 'utf-8')
  const keys = expectJson(content, OperatorKeysArraySchema, 'operator keys')

  const adminKey = keys.find((k) => k.name === 'admin')

  if (!adminKey) {
    throw new Error('Admin key not found')
  }

  console.log('\nDeploying L1 contracts with op-deployer...')
  console.log(`Deployer: ${adminKey.address}`)

  // Create intent file for op-deployer
  const intentFile = join(DEPLOYMENTS_DIR, 'deploy-intent.json')
  if (!existsSync(DEPLOYMENTS_DIR)) {
    mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
  }

  const intent = {
    l1ChainID: 11155111,
    l2ChainIDs: [420690],
    superchainRoles: {
      proxyAdminOwner: adminKey.address,
      protocolVersionsOwner: adminKey.address,
      guardian: keys.find((k) => k.name === 'guardian')?.address,
    },
    chains: [
      {
        id: '420690',
        roles: {
          l1ProxyAdminOwner: adminKey.address,
          l2ProxyAdminOwner: adminKey.address,
          systemConfigOwner: adminKey.address,
          unsafeBlockSigner: keys.find((k) => k.name === 'sequencer')?.address,
          batcher: keys.find((k) => k.name === 'batcher')?.address,
          proposer: keys.find((k) => k.name === 'proposer')?.address,
          challenger: keys.find((k) => k.name === 'challenger')?.address,
        },
      },
    ],
  }

  writeFileSync(intentFile, JSON.stringify(intent, null, 2))
  console.log(`Created intent file: ${intentFile}`)

  // Run op-deployer
  const result = await $`op-deployer apply \
    --l1-rpc-url https://ethereum-sepolia-rpc.publicnode.com \
    --private-key ${adminKey.privateKey} \
    --intent ${intentFile} \
    --outdir ${DEPLOYMENTS_DIR}`.nothrow()

  if (result.exitCode !== 0) {
    console.error('op-deployer failed. Trying manual deployment...')
    return deployManually(adminKey.privateKey)
  }

  // Parse deployment output
  const stateFile = join(DEPLOYMENTS_DIR, 'state.json')
  if (existsSync(stateFile)) {
    const stateContent = readFileSync(stateFile, 'utf-8')
    const state = expectJson(
      stateContent,
      OpDeployerStateSchema,
      'op-deployer state',
    )
    return extractAddresses(state)
  }

  throw new Error('Deployment output not found')
}

async function deployManually(_privateKey: string): Promise<DeploymentResult> {
  console.log('\nManual deployment not yet implemented.')
  console.log('Please use op-deployer or deploy contracts manually using:')
  console.log(
    '  https://docs.optimism.io/builders/chain-operators/tutorials/create-l2-rollup',
  )

  throw new Error('Manual deployment required')
}

function extractAddresses(state: OpDeployerState): DeploymentResult {
  // Extract addresses from op-deployer state
  const addresses = state.addresses ?? {}

  return {
    OptimismPortal: addresses.OptimismPortalProxy ?? '',
    L2OutputOracle: addresses.L2OutputOracleProxy ?? '',
    L1CrossDomainMessenger: addresses.L1CrossDomainMessengerProxy ?? '',
    L1StandardBridge: addresses.L1StandardBridgeProxy ?? '',
    SystemConfig: addresses.SystemConfigProxy ?? '',
    AddressManager: addresses.AddressManager ?? '',
    ProxyAdmin: addresses.ProxyAdmin ?? '',
    L1ERC721Bridge: addresses.L1ERC721BridgeProxy ?? '',
    OptimismMintableERC20Factory:
      addresses.OptimismMintableERC20FactoryProxy ?? '',
  }
}

async function updateChainConfig(addresses: DeploymentResult) {
  const configFile = join(CHAIN_CONFIG_DIR, 'testnet.json')
  const content = readFileSync(configFile, 'utf-8')
  const config = expectJson(
    content,
    ChainConfigValidationSchema,
    'chain config',
  )

  // Cast to mutable for update
  const mutableConfig = config as ChainConfigValidation & {
    contracts: { l1: Record<string, string> }
  }

  mutableConfig.contracts = mutableConfig.contracts ?? { l1: {}, l2: {} }
  mutableConfig.contracts.l1 = {
    OptimismPortal: addresses.OptimismPortal,
    L2OutputOracle: addresses.L2OutputOracle,
    L1CrossDomainMessenger: addresses.L1CrossDomainMessenger,
    L1StandardBridge: addresses.L1StandardBridge,
    SystemConfig: addresses.SystemConfig,
    AddressManager: addresses.AddressManager,
    ProxyAdmin: addresses.ProxyAdmin,
    L1ERC721Bridge: addresses.L1ERC721Bridge,
    OptimismMintableERC20Factory: addresses.OptimismMintableERC20Factory,
  }

  writeFileSync(configFile, JSON.stringify(mutableConfig, null, 2))
  console.log(`✅ Updated chain config: ${configFile}`)
}

async function saveDeployment(addresses: DeploymentResult) {
  const deploymentFile = join(DEPLOYMENTS_DIR, 'l1-deployment.json')

  const deployment = {
    network: 'testnet',
    l1ChainId: 11155111,
    deployedAt: new Date().toISOString(),
    contracts: addresses,
  }

  writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2))
  console.log(`✅ Saved deployment: ${deploymentFile}`)
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║  the network - L1 Contract Deployment                               ║
║  Network: Sepolia (11155111) → Network Testnet (420690)                 ║
╚══════════════════════════════════════════════════════════════════════╝
`)

  const prereqsOk = await checkPrerequisites()
  if (!prereqsOk) {
    console.log('\n❌ Prerequisites not met. Fix the issues above and retry.')
    process.exit(1)
  }

  const addresses = await deployWithOpDeployer()

  console.log('\n✅ L1 Contracts Deployed:')
  console.log(
    '┌────────────────────────────────┬────────────────────────────────────────────┐',
  )
  console.log(
    '│ Contract                       │ Address                                    │',
  )
  console.log(
    '├────────────────────────────────┼────────────────────────────────────────────┤',
  )

  for (const [name, address] of Object.entries(addresses)) {
    if (address) {
      console.log(`│ ${name.padEnd(30)} │ ${address} │`)
    }
  }

  console.log(
    '└────────────────────────────────┴────────────────────────────────────────────┘',
  )

  await updateChainConfig(addresses)
  await saveDeployment(addresses)

  console.log(`
═══════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════

1. Generate L2 genesis:
   NETWORK=testnet bun run packages/deployment/scripts/l2-genesis.ts

2. Deploy DWS contracts and apps (permissionless):
   NETWORK=testnet bun run packages/deployment/scripts/deploy/dws-bootstrap.ts

3. Verify chain is producing blocks:
   curl -X POST https://testnet-rpc.jejunetwork.org -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'

═══════════════════════════════════════════════════════════════════════
`)
}

main()
