#!/usr/bin/env bun

/**
 * @internal Used by CI/CD and deployment scripts
 *
 * Pre-Deployment Security Checks
 *
 * Validates all security requirements before deployment:
 * - No test keys in production configs
 * - Required contracts deployed
 * - TEE properly configured
 * - Verification keys are production-ready
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Critical security issue found
 *   2 - Warning (non-blocking for testnet)
 *
 * Usage:
 *   bun run scripts/verify/security-checks.ts <network>
 *   bun run scripts/verify/security-checks.ts mainnet
 *   bun run scripts/verify/security-checks.ts testnet
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BridgeConfigSchema,
  expectJson,
  ZKBridgeDeploymentSchema,
} from '../../schemas'

const ROOT = process.cwd()

// Well-known test keys that must NEVER be used on mainnet/testnet
const FORBIDDEN_KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil #0
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Anvil #1
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Anvil #2
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // Anvil #3
]

interface CheckResult {
  name: string
  severity: 'critical' | 'warning' | 'info' | 'pass'
  message: string
}

const results: CheckResult[] = []

function check(
  name: string,
  severity: CheckResult['severity'],
  message: string,
) {
  results.push({ name, severity, message })
}

function checkPrivateKeys(network: string): void {
  // Check environment variable
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY

  if (!deployerKey && network !== 'localnet') {
    check(
      'DEPLOYER_PRIVATE_KEY',
      'critical',
      'Not set - required for deployment',
    )
    return
  }

  if (deployerKey && FORBIDDEN_KEYS.includes(deployerKey.toLowerCase())) {
    check(
      'DEPLOYER_PRIVATE_KEY',
      'critical',
      'SECURITY VIOLATION: Using well-known test key. Generate new key: cast wallet new',
    )
    return
  }

  check('DEPLOYER_PRIVATE_KEY', 'pass', 'Unique key configured')
}

function checkTEEConfig(network: string): void {
  const configPath = join(ROOT, `packages/bridge/config/${network}.json`)

  if (!existsSync(configPath)) {
    check('TEE Config', 'warning', `Config not found: ${network}.json`)
    return
  }

  const config = expectJson(
    readFileSync(configPath, 'utf-8'),
    BridgeConfigSchema,
    'bridge config',
  )

  if (network === 'mainnet') {
    if (config.tee?.requireRealTEE !== true) {
      check(
        'TEE Config',
        'critical',
        'SECURITY: requireRealTEE must be true for mainnet',
      )
    } else {
      check('TEE Config', 'pass', 'requireRealTEE=true')
    }

    if (config.prover?.useMockProofs === true) {
      check(
        'Mock Proofs',
        'critical',
        'SECURITY: useMockProofs must be false for mainnet',
      )
    } else {
      check('Mock Proofs', 'pass', 'Disabled')
    }
  } else {
    check('TEE Config', 'info', 'Testnet allows mock TEE')
  }
}

function checkVerificationKeys(network: string): void {
  if (network !== 'mainnet') {
    check('Verification Keys', 'info', 'Test keys acceptable for non-mainnet')
    return
  }

  const vkPath = join(
    ROOT,
    'packages/solana/programs/evm-light-client/src/verification_key.rs',
  )

  if (!existsSync(vkPath)) {
    check('Verification Keys', 'warning', 'File not found')
    return
  }

  const content = readFileSync(vkPath, 'utf-8')

  // Check for our test key marker
  if (content.includes('TEST_KEY_MARKER')) {
    const markerMatch = content.match(/TEST_KEY_MARKER.*=.*\[(.*?)\]/)
    if (markerMatch) {
      check(
        'Verification Keys',
        'critical',
        'SECURITY: Test verification keys detected. Generate production keys before mainnet.',
      )
      return
    }
  }

  check('Verification Keys', 'pass', 'Production keys in place')
}

function checkContractSecurity(): void {
  const zkBridgePath = join(
    ROOT,
    'packages/contracts/src/bridge/zk/ZKBridge.sol',
  )

  if (!existsSync(zkBridgePath)) {
    check('Contract Security', 'warning', 'ZKBridge.sol not found')
    return
  }

  const content = readFileSync(zkBridgePath, 'utf-8')

  // Check 2-step admin transfer
  if (!content.includes('acceptAdmin') || !content.includes('pendingAdmin')) {
    check(
      '2-Step Admin Transfer',
      'critical',
      'ZKBridge missing 2-step admin transfer pattern',
    )
  } else {
    check('2-Step Admin Transfer', 'pass', 'Implemented')
  }

  // Check proper proof verification
  if (content.includes('groth16Verifier.verifyProof')) {
    check('Proof Verification', 'pass', 'Delegates to Groth16 verifier')
  } else if (content.includes('proof[0] == 0 && proof[1] == 0')) {
    check(
      'Proof Verification',
      'critical',
      'SECURITY: Proof verification is bypassed - any proof would be accepted!',
    )
  }

  // Check call() instead of transfer()
  if (content.includes('.transfer(') && !content.includes('.call{value:')) {
    check(
      'ETH Transfer',
      'warning',
      'Using transfer() - consider call() for gas forward compatibility',
    )
  } else {
    check('ETH Transfer', 'pass', 'Using call() for ETH transfers')
  }
}

function checkZKVerifierDeployed(network: string): void {
  if (network === 'localnet') {
    check('Groth16 Verifier', 'info', 'Not required for localnet')
    return
  }

  const deploymentPath = join(
    ROOT,
    `packages/contracts/deployments/${network}/zk-bridge.json`,
  )

  if (!existsSync(deploymentPath)) {
    if (network === 'mainnet') {
      check(
        'Groth16 Verifier',
        'critical',
        'ZK bridge not deployed - deploy verifier first',
      )
    } else {
      check('Groth16 Verifier', 'warning', 'ZK bridge deployment not found')
    }
    return
  }

  const deployment = expectJson(
    readFileSync(deploymentPath, 'utf-8'),
    ZKBridgeDeploymentSchema,
    'ZK bridge deployment',
  )
  const verifier = deployment.groth16Verifier ?? deployment.verifier

  if (!verifier || verifier === '0x0000000000000000000000000000000000000000') {
    check(
      'Groth16 Verifier',
      'critical',
      'SECURITY: Verifier contract not deployed - ZK proofs will fail!',
    )
  } else {
    check('Groth16 Verifier', 'pass', `Deployed: ${verifier.slice(0, 10)}...`)
  }
}

function checkMultisigConfig(network: string): void {
  if (network !== 'mainnet') {
    check('Multisig', 'info', 'Optional for non-mainnet')
    return
  }

  const configPath = join(ROOT, 'packages/bridge/config/mainnet.json')

  if (!existsSync(configPath)) {
    check('Multisig', 'warning', 'Mainnet config not found')
    return
  }

  const multisigConfig = expectJson(
    readFileSync(configPath, 'utf-8'),
    BridgeConfigSchema,
    'mainnet bridge config',
  )

  if (multisigConfig.security?.multisigRequired === true) {
    check('Multisig', 'pass', 'Required for admin operations')
  } else {
    check('Multisig', 'warning', 'Consider requiring multisig for mainnet')
  }
}

function printResults(network: string): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║              Security Pre-Deployment Check - ${network.toUpperCase().padEnd(10)}              ║
╚══════════════════════════════════════════════════════════════════════╝
`)

  let criticalCount = 0
  let warningCount = 0

  for (const result of results) {
    let icon = ''
    let color = '\x1b[0m'

    switch (result.severity) {
      case 'critical':
        icon = '🚨'
        color = '\x1b[31m'
        criticalCount++
        break
      case 'warning':
        icon = '⚠️ '
        color = '\x1b[33m'
        warningCount++
        break
      case 'info':
        icon = 'ℹ️ '
        color = '\x1b[36m'
        break
      case 'pass':
        icon = '✅'
        color = '\x1b[32m'
        break
    }

    console.log(
      `${icon} ${result.name.padEnd(25)} ${color}${result.message}\x1b[0m`,
    )
  }

  console.log(`
═══════════════════════════════════════════════════════════════════════
`)

  if (criticalCount > 0) {
    console.log(
      `\x1b[31m🚨 ${criticalCount} CRITICAL security issue(s) found!\x1b[0m`,
    )
    console.log('   Deployment BLOCKED. Fix these issues before proceeding.\n')
    process.exit(1)
  } else if (warningCount > 0 && network === 'mainnet') {
    console.log(`\x1b[33m⚠️  ${warningCount} warning(s) found.\x1b[0m`)
    console.log('   Review warnings before mainnet deployment.\n')
    process.exit(2)
  } else {
    console.log('\x1b[32m✅ All security checks passed!\x1b[0m')
    console.log(`   Safe to proceed with ${network} deployment.\n`)
    process.exit(0)
  }
}

async function main(): Promise<void> {
  const network = process.argv[2] ?? 'testnet'

  if (!['localnet', 'testnet', 'mainnet'].includes(network)) {
    console.error(
      `Invalid network: ${network}. Use 'localnet', 'testnet', or 'mainnet'.`,
    )
    process.exit(1)
  }

  console.log(`Running security checks for ${network}...\n`)

  // Run all security checks
  checkPrivateKeys(network)
  checkTEEConfig(network)
  checkVerificationKeys(network)
  checkContractSecurity()
  checkZKVerifierDeployed(network)
  checkMultisigConfig(network)

  printResults(network)
}

main()
