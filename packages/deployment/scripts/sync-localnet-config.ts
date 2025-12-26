#!/usr/bin/env bun
/**
 * Sync Localnet Deployment to Config
 *
 * Reads localnet-complete.json and updates contracts.json with the addresses.
 * Run after bootstrap: bun run scripts/sync-localnet-config.ts
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isValidAddress } from '@jejunetwork/types'

const ROOT = process.cwd()
const DEPLOYMENT_FILE = join(
  ROOT,
  'packages/contracts/deployments/localnet-complete.json',
)
const CONFIG_FILE = join(ROOT, 'packages/config/contracts.json')

interface BootstrapResult {
  contracts: {
    // Tokens
    jeju?: string
    usdc?: string
    weth?: string
    // Services
    creditManager?: string
    universalPaymaster?: string
    serviceRegistry?: string
    priceOracle?: string
    // Paymaster System
    tokenRegistry?: string
    paymasterFactory?: string
    entryPoint?: string
    // Registry System
    identityRegistry?: string
    reputationRegistry?: string
    validationRegistry?: string
    // Node Staking
    nodeStakingManager?: string
    nodePerformanceOracle?: string
    // DeFi / Uniswap V4
    poolManager?: string
    swapRouter?: string
    positionManager?: string
    quoterV4?: string
    stateView?: string
    // Governance
    futarchyGovernor?: string
    // Storage
    fileStorageManager?: string
    storageManager?: string
    // Moderation
    banManager?: string
    reputationLabelManager?: string
    // Compute
    computeRegistry?: string
    ledgerManager?: string
    inferenceServing?: string
    computeStaking?: string
    workerRegistry?: string
    // Liquidity
    riskSleeve?: string
    liquidityRouter?: string
    multiServiceStakeManager?: string
    liquidityVault?: string
    // Bazaar
    nftMarketplace?: string
    simpleCollectible?: string
    // JNS
    jnsRegistry?: string
    jnsResolver?: string
    // CDN
    cdnRegistry?: string
    // Security
    securityBountyRegistry?: string
    // OAuth3
    oauth3TeeVerifier?: string
    oauth3IdentityRegistry?: string
    oauth3AppRegistry?: string
  }
}

function main() {
  if (!existsSync(DEPLOYMENT_FILE)) {
    console.error('No deployment file found. Run bootstrap first: jeju dev')
    process.exit(1)
  }

  const deployment: BootstrapResult = JSON.parse(
    readFileSync(DEPLOYMENT_FILE, 'utf-8'),
  )
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))

  console.log('Syncing localnet addresses to contracts.json...')

  // Update tokens
  if (isValidAddress(deployment.contracts.jeju)) {
    config.localnet.tokens.jeju = deployment.contracts.jeju
    console.log(`  tokens.jeju: ${deployment.contracts.jeju}`)
  }
  if (isValidAddress(deployment.contracts.usdc)) {
    config.localnet.tokens.usdc = deployment.contracts.usdc
    console.log(`  tokens.usdc: ${deployment.contracts.usdc}`)
  }

  // Update registry
  if (isValidAddress(deployment.contracts.identityRegistry)) {
    config.localnet.registry.identity = deployment.contracts.identityRegistry
    console.log(`  registry.identity: ${deployment.contracts.identityRegistry}`)
  }
  if (isValidAddress(deployment.contracts.reputationRegistry)) {
    config.localnet.registry.reputation =
      deployment.contracts.reputationRegistry
    console.log(
      `  registry.reputation: ${deployment.contracts.reputationRegistry}`,
    )
  }
  if (isValidAddress(deployment.contracts.validationRegistry)) {
    config.localnet.registry.validation =
      deployment.contracts.validationRegistry
    console.log(
      `  registry.validation: ${deployment.contracts.validationRegistry}`,
    )
  }

  // Update moderation
  if (isValidAddress(deployment.contracts.banManager)) {
    config.localnet.moderation.banManager = deployment.contracts.banManager
    console.log(`  moderation.banManager: ${deployment.contracts.banManager}`)
  }
  if (isValidAddress(deployment.contracts.reputationLabelManager)) {
    config.localnet.moderation.reputationLabelManager =
      deployment.contracts.reputationLabelManager
    console.log(
      `  moderation.reputationLabelManager: ${deployment.contracts.reputationLabelManager}`,
    )
  }

  // Update nodeStaking
  if (isValidAddress(deployment.contracts.nodeStakingManager)) {
    config.localnet.nodeStaking.manager =
      deployment.contracts.nodeStakingManager
    console.log(
      `  nodeStaking.manager: ${deployment.contracts.nodeStakingManager}`,
    )
  }
  if (isValidAddress(deployment.contracts.nodePerformanceOracle)) {
    config.localnet.nodeStaking.performanceOracle =
      deployment.contracts.nodePerformanceOracle
    console.log(
      `  nodeStaking.performanceOracle: ${deployment.contracts.nodePerformanceOracle}`,
    )
  }

  // Update payments
  if (isValidAddress(deployment.contracts.tokenRegistry)) {
    config.localnet.payments.tokenRegistry = deployment.contracts.tokenRegistry
    console.log(
      `  payments.tokenRegistry: ${deployment.contracts.tokenRegistry}`,
    )
  }
  if (isValidAddress(deployment.contracts.paymasterFactory)) {
    config.localnet.payments.paymasterFactory =
      deployment.contracts.paymasterFactory
    console.log(
      `  payments.paymasterFactory: ${deployment.contracts.paymasterFactory}`,
    )
  }
  if (isValidAddress(deployment.contracts.priceOracle)) {
    config.localnet.payments.priceOracle = deployment.contracts.priceOracle
    console.log(`  payments.priceOracle: ${deployment.contracts.priceOracle}`)
  }
  if (isValidAddress(deployment.contracts.universalPaymaster)) {
    config.localnet.payments.multiTokenPaymaster =
      deployment.contracts.universalPaymaster
    console.log(
      `  payments.multiTokenPaymaster: ${deployment.contracts.universalPaymaster}`,
    )
  }
  if (isValidAddress(deployment.contracts.creditManager)) {
    config.localnet.payments.creditManager = deployment.contracts.creditManager
    console.log(
      `  payments.creditManager: ${deployment.contracts.creditManager}`,
    )
  }
  if (isValidAddress(deployment.contracts.serviceRegistry)) {
    config.localnet.payments.serviceRegistry =
      deployment.contracts.serviceRegistry
    console.log(
      `  payments.serviceRegistry: ${deployment.contracts.serviceRegistry}`,
    )
  }

  // Update defi
  if (isValidAddress(deployment.contracts.poolManager)) {
    config.localnet.defi.poolManager = deployment.contracts.poolManager
    console.log(`  defi.poolManager: ${deployment.contracts.poolManager}`)
  }
  if (isValidAddress(deployment.contracts.swapRouter)) {
    config.localnet.defi.swapRouter = deployment.contracts.swapRouter
    console.log(`  defi.swapRouter: ${deployment.contracts.swapRouter}`)
  }
  if (isValidAddress(deployment.contracts.positionManager)) {
    config.localnet.defi.positionManager = deployment.contracts.positionManager
    console.log(
      `  defi.positionManager: ${deployment.contracts.positionManager}`,
    )
  }
  if (isValidAddress(deployment.contracts.quoterV4)) {
    config.localnet.defi.quoterV4 = deployment.contracts.quoterV4
    console.log(`  defi.quoterV4: ${deployment.contracts.quoterV4}`)
  }
  if (isValidAddress(deployment.contracts.stateView)) {
    config.localnet.defi.stateView = deployment.contracts.stateView
    console.log(`  defi.stateView: ${deployment.contracts.stateView}`)
  }

  // Update compute
  if (isValidAddress(deployment.contracts.computeRegistry)) {
    config.localnet.compute.registry = deployment.contracts.computeRegistry
    console.log(`  compute.registry: ${deployment.contracts.computeRegistry}`)
  }
  if (isValidAddress(deployment.contracts.ledgerManager)) {
    config.localnet.compute.ledgerManager = deployment.contracts.ledgerManager
    console.log(
      `  compute.ledgerManager: ${deployment.contracts.ledgerManager}`,
    )
  }
  if (isValidAddress(deployment.contracts.inferenceServing)) {
    config.localnet.compute.inferenceServing =
      deployment.contracts.inferenceServing
    console.log(
      `  compute.inferenceServing: ${deployment.contracts.inferenceServing}`,
    )
  }
  if (isValidAddress(deployment.contracts.computeStaking)) {
    config.localnet.compute.staking = deployment.contracts.computeStaking
    console.log(`  compute.staking: ${deployment.contracts.computeStaking}`)
  }

  // Update liquidity
  if (isValidAddress(deployment.contracts.riskSleeve)) {
    config.localnet.liquidity.riskSleeve = deployment.contracts.riskSleeve
    console.log(`  liquidity.riskSleeve: ${deployment.contracts.riskSleeve}`)
  }
  if (isValidAddress(deployment.contracts.liquidityRouter)) {
    config.localnet.liquidity.liquidityRouter =
      deployment.contracts.liquidityRouter
    console.log(
      `  liquidity.liquidityRouter: ${deployment.contracts.liquidityRouter}`,
    )
  }
  if (isValidAddress(deployment.contracts.multiServiceStakeManager)) {
    config.localnet.liquidity.multiServiceStakeManager =
      deployment.contracts.multiServiceStakeManager
    console.log(
      `  liquidity.multiServiceStakeManager: ${deployment.contracts.multiServiceStakeManager}`,
    )
  }
  if (isValidAddress(deployment.contracts.liquidityVault)) {
    config.localnet.liquidity.liquidityVault =
      deployment.contracts.liquidityVault
    console.log(
      `  liquidity.liquidityVault: ${deployment.contracts.liquidityVault}`,
    )
  }

  // Update bazaar
  if (isValidAddress(deployment.contracts.nftMarketplace)) {
    config.localnet.bazaar.marketplace = deployment.contracts.nftMarketplace
    console.log(`  bazaar.marketplace: ${deployment.contracts.nftMarketplace}`)
  }
  if (isValidAddress(deployment.contracts.simpleCollectible)) {
    config.localnet.bazaar.simpleCollectible =
      deployment.contracts.simpleCollectible
    console.log(
      `  bazaar.simpleCollectible: ${deployment.contracts.simpleCollectible}`,
    )
  }

  // Update security
  if (isValidAddress(deployment.contracts.securityBountyRegistry)) {
    config.localnet.security.bountyRegistry =
      deployment.contracts.securityBountyRegistry
    console.log(
      `  security.bountyRegistry: ${deployment.contracts.securityBountyRegistry}`,
    )
  }

  // Update JNS
  if (isValidAddress(deployment.contracts.jnsRegistry)) {
    config.localnet.jns.registry = deployment.contracts.jnsRegistry
    console.log(`  jns.registry: ${deployment.contracts.jnsRegistry}`)
  }
  if (isValidAddress(deployment.contracts.jnsResolver)) {
    config.localnet.jns.resolver = deployment.contracts.jnsResolver
    console.log(`  jns.resolver: ${deployment.contracts.jnsResolver}`)
  }

  // Update CDN
  if (!config.localnet.cdn) {
    config.localnet.cdn = {}
  }
  if (isValidAddress(deployment.contracts.cdnRegistry)) {
    config.localnet.cdn.registry = deployment.contracts.cdnRegistry
    console.log(`  cdn.registry: ${deployment.contracts.cdnRegistry}`)
  }

  // Update DWS (Decentralized Web Services)
  if (!config.localnet.dws) {
    config.localnet.dws = {}
  }
  if (isValidAddress(deployment.contracts.storageManager)) {
    config.localnet.dws.storageManager = deployment.contracts.storageManager
    console.log(`  dws.storageManager: ${deployment.contracts.storageManager}`)
  }
  if (isValidAddress(deployment.contracts.workerRegistry)) {
    config.localnet.dws.workerRegistry = deployment.contracts.workerRegistry
    console.log(`  dws.workerRegistry: ${deployment.contracts.workerRegistry}`)
  }

  // Update OAuth3
  if (!config.localnet.oauth3) {
    config.localnet.oauth3 = {}
  }
  if (isValidAddress(deployment.contracts.oauth3TeeVerifier)) {
    config.localnet.oauth3.teeVerifier = deployment.contracts.oauth3TeeVerifier
    console.log(
      `  oauth3.teeVerifier: ${deployment.contracts.oauth3TeeVerifier}`,
    )
  }
  if (isValidAddress(deployment.contracts.oauth3IdentityRegistry)) {
    config.localnet.oauth3.identityRegistry =
      deployment.contracts.oauth3IdentityRegistry
    console.log(
      `  oauth3.identityRegistry: ${deployment.contracts.oauth3IdentityRegistry}`,
    )
  }
  if (isValidAddress(deployment.contracts.oauth3AppRegistry)) {
    config.localnet.oauth3.appRegistry = deployment.contracts.oauth3AppRegistry
    console.log(
      `  oauth3.appRegistry: ${deployment.contracts.oauth3AppRegistry}`,
    )
  }

  // Save updated config
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`)
  console.log('\nConfig updated: packages/config/contracts.json')
}

main()
