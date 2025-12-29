#!/usr/bin/env bun
/**
 * Testnet Pre-Flight Check
 *
 * Validates all prerequisites before running testnet deployment:
 * - AWS credentials and permissions
 * - Terraform state
 * - Required API keys
 * - Deployer wallet balance
 * - Required tools
 *
 * Usage:
 *   bun run scripts/deploy/testnet-preflight.ts
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const ROOT = join(import.meta.dir, '../../../..')
const DEPLOYMENT_DIR = join(ROOT, 'packages/deployment')

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  fix?: string
}

const results: CheckResult[] = []

function log(
  message: string,
  level: 'info' | 'success' | 'error' | 'warn' = 'info',
): void {
  const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️' }
  console.log(`${icons[level]}  ${message}`)
}

function check(
  name: string,
  test: () => {
    status: 'pass' | 'fail' | 'warn'
    message: string
    fix?: string
  },
): void {
  const result = test()
  results.push({ name, ...result })

  const icon =
    result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌'
  console.log(`${icon}  ${name}: ${result.message}`)

  if (result.fix && result.status !== 'pass') {
    console.log(`   Fix: ${result.fix}`)
  }
}

async function checkAsync(
  name: string,
  test: () => Promise<{
    status: 'pass' | 'fail' | 'warn'
    message: string
    fix?: string
  }>,
): Promise<void> {
  const result = await test()
  results.push({ name, ...result })

  const icon =
    result.status === 'pass' ? '✅' : result.status === 'warn' ? '⚠️' : '❌'
  console.log(`${icon}  ${name}: ${result.message}`)

  if (result.fix && result.status !== 'pass') {
    console.log(`   Fix: ${result.fix}`)
  }
}

async function main(): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║                                                                          ║
║   🔍 TESTNET PRE-FLIGHT CHECK                                            ║
║                                                                          ║
║   Validates all prerequisites before deployment                          ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
`)

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Required Tools')
  console.log(`${'═'.repeat(70)}\n`)

  // Check bun
  check('Bun', () => {
    const version = execSync('bun --version 2>/dev/null || echo "not found"', {
      encoding: 'utf-8',
    }).trim()
    if (version === 'not found') {
      return {
        status: 'fail',
        message: 'Not installed',
        fix: 'curl -fsSL https://bun.sh/install | bash',
      }
    }
    return { status: 'pass', message: `v${version}` }
  })

  // Check forge
  check('Foundry (forge)', () => {
    const version = execSync(
      'forge --version 2>/dev/null || echo "not found"',
      { encoding: 'utf-8' },
    ).trim()
    if (version === 'not found') {
      return {
        status: 'fail',
        message: 'Not installed',
        fix: 'curl -L https://foundry.paradigm.xyz | bash && foundryup',
      }
    }
    return { status: 'pass', message: version.split('\n')[0] }
  })

  // Check terraform
  check('Terraform', () => {
    const version = execSync(
      'terraform --version 2>/dev/null || echo "not found"',
      { encoding: 'utf-8' },
    ).trim()
    if (version === 'not found') {
      return {
        status: 'warn',
        message: 'Not installed (optional for contract-only deployment)',
        fix: 'brew install terraform',
      }
    }
    return { status: 'pass', message: version.split('\n')[0] }
  })

  // Check aws cli
  check('AWS CLI', () => {
    const version = execSync('aws --version 2>/dev/null || echo "not found"', {
      encoding: 'utf-8',
    }).trim()
    if (version === 'not found') {
      return {
        status: 'warn',
        message: 'Not installed (required for infrastructure)',
        fix: 'brew install awscli',
      }
    }
    return { status: 'pass', message: version.split(' ')[0] }
  })

  // Check kubectl
  check('kubectl', () => {
    const version = execSync(
      'kubectl version --client --short 2>/dev/null || kubectl version --client 2>/dev/null | head -1 || echo "not found"',
      { encoding: 'utf-8' },
    ).trim()
    if (version === 'not found') {
      return {
        status: 'warn',
        message: 'Not installed (required for K8s deployment)',
        fix: 'brew install kubectl',
      }
    }
    return { status: 'pass', message: version }
  })

  // Check curl
  check('curl', () => {
    const version = execSync(
      'curl --version 2>/dev/null | head -1 || echo "not found"',
      { encoding: 'utf-8' },
    ).trim()
    if (version === 'not found') {
      return {
        status: 'fail',
        message: 'Not installed',
        fix: 'Should be pre-installed on macOS',
      }
    }
    return { status: 'pass', message: version }
  })

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Environment Variables')
  console.log(`${'═'.repeat(70)}\n`)

  // Check deployer key
  const deployerKey =
    process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY
  check('DEPLOYER_PRIVATE_KEY', () => {
    if (!deployerKey) {
      return {
        status: 'fail',
        message: 'Not set',
        fix: 'export DEPLOYER_PRIVATE_KEY=0x...',
      }
    }
    if (!deployerKey.startsWith('0x') || deployerKey.length !== 66) {
      return {
        status: 'fail',
        message: 'Invalid format',
        fix: 'Must be 0x-prefixed 64-character hex string',
      }
    }
    return { status: 'pass', message: `Set (${deployerKey.slice(0, 10)}...)` }
  })

  // Check AWS credentials
  check('AWS Credentials', () => {
    const awsAccessKey = process.env.AWS_ACCESS_KEY_ID
    const awsProfile = process.env.AWS_PROFILE
    const awsRoleArn = process.env.AWS_ROLE_ARN

    if (awsRoleArn) {
      return {
        status: 'pass',
        message: `Using role ARN: ${awsRoleArn.slice(0, 30)}...`,
      }
    }
    if (awsProfile) {
      return { status: 'pass', message: `Using profile: ${awsProfile}` }
    }
    if (awsAccessKey) {
      return {
        status: 'pass',
        message: `Using access key: ${awsAccessKey.slice(0, 10)}...`,
      }
    }
    return {
      status: 'warn',
      message: 'Not configured (required for infrastructure)',
      fix: 'aws configure or export AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY',
    }
  })

  // Check API keys
  check('OPENAI_API_KEY', () => {
    const key = process.env.OPENAI_API_KEY
    if (!key) {
      return {
        status: 'warn',
        message: 'Not set (optional - for AI features)',
        fix: 'export OPENAI_API_KEY=sk-...',
      }
    }
    return { status: 'pass', message: `Set (${key.slice(0, 10)}...)` }
  })

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Wallet Balances')
  console.log(`${'═'.repeat(70)}\n`)

  if (deployerKey) {
    const account = privateKeyToAccount(deployerKey as `0x${string}`)
    console.log(`Deployer Address: ${account.address}\n`)

    // Check Sepolia balance
    await checkAsync('Sepolia ETH Balance', async () => {
      const client = createPublicClient({
        chain: sepolia,
        transport: http('https://ethereum-sepolia-rpc.publicnode.com'),
      })

      const balance = await client
        .getBalance({ address: account.address })
        .catch(() => 0n)
      const balanceEth = parseFloat(formatEther(balance))

      if (balanceEth < 0.1) {
        return {
          status: 'fail',
          message: `${balanceEth.toFixed(4)} ETH (need 0.1+ for L1 operations)`,
          fix: 'Get Sepolia ETH from: https://sepoliafaucet.com or https://faucet.alchemy.com/sepolia',
        }
      }
      if (balanceEth < 1) {
        return {
          status: 'warn',
          message: `${balanceEth.toFixed(4)} ETH (recommend 1+ ETH)`,
        }
      }
      return { status: 'pass', message: `${balanceEth.toFixed(4)} ETH` }
    })

    // Check Jeju testnet balance (if RPC is up)
    await checkAsync('Jeju Testnet ETH Balance', async () => {
      const client = createPublicClient({
        transport: http('https://testnet-rpc.jejunetwork.org'),
      })

      const balance = await client
        .getBalance({ address: account.address })
        .catch(() => null)

      if (balance === null) {
        return {
          status: 'warn',
          message: 'Testnet RPC not reachable (may not be deployed yet)',
        }
      }

      const balanceEth = parseFloat(formatEther(balance))
      if (balanceEth < 1) {
        return {
          status: 'fail',
          message: `${balanceEth.toFixed(4)} ETH (need 1+ for contract deployment)`,
          fix: 'Bridge ETH from Sepolia or use testnet faucet',
        }
      }
      return { status: 'pass', message: `${balanceEth.toFixed(4)} ETH` }
    })
  } else {
    log('Skipping balance checks (no deployer key)', 'warn')
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Infrastructure State')
  console.log(`${'═'.repeat(70)}\n`)

  // Check Terraform state
  check('Terraform State', () => {
    const tfStateFile = join(
      DEPLOYMENT_DIR,
      'terraform/environments/testnet/.terraform',
    )
    if (existsSync(tfStateFile)) {
      return { status: 'pass', message: 'Initialized' }
    }
    return {
      status: 'warn',
      message: 'Not initialized',
      fix: 'cd packages/deployment/terraform/environments/testnet && terraform init',
    }
  })

  // Check if Terraform vars exist
  check('Terraform Variables', () => {
    const tfVarsFile = join(
      DEPLOYMENT_DIR,
      'terraform/environments/testnet/terraform.tfvars',
    )
    if (existsSync(tfVarsFile)) {
      return { status: 'pass', message: 'terraform.tfvars exists' }
    }
    return {
      status: 'warn',
      message: 'terraform.tfvars not found',
      fix: 'cp terraform.tfvars.example terraform.tfvars and configure',
    }
  })

  // Check contracts package
  check('Contracts Package', () => {
    const foundryToml = join(ROOT, 'packages/contracts/foundry.toml')
    if (existsSync(foundryToml)) {
      return { status: 'pass', message: 'Found' }
    }
    return { status: 'fail', message: 'foundry.toml not found' }
  })

  // Check Babylon vendor
  check('Babylon Vendor', () => {
    const babylonManifest = join(ROOT, 'vendor/babylon/jeju-manifest.json')
    if (existsSync(babylonManifest)) {
      return { status: 'pass', message: 'Found' }
    }
    return {
      status: 'warn',
      message: 'Not found (Babylon features will be skipped)',
    }
  })

  // Summary
  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Summary')
  console.log(`${'═'.repeat(70)}\n`)

  const passed = results.filter((r) => r.status === 'pass').length
  const warned = results.filter((r) => r.status === 'warn').length
  const failed = results.filter((r) => r.status === 'fail').length

  console.log(`Total Checks: ${results.length}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`⚠️ Warnings: ${warned}`)
  console.log(`❌ Failed: ${failed}`)

  if (failed > 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ❌ PRE-FLIGHT CHECK FAILED                                              ║
║                                                                          ║
║  Please fix the failed checks above before proceeding with deployment.   ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
    process.exit(1)
  }

  if (warned > 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ⚠️  PRE-FLIGHT CHECK PASSED WITH WARNINGS                               ║
║                                                                          ║
║  Some optional components are missing. You can proceed but some          ║
║  features may not work. Review warnings above.                           ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
    process.exit(0)
  }

  console.log(`
╔══════════════════════════════════════════════════════════════════════════╗
║  ✅ PRE-FLIGHT CHECK PASSED                                              ║
║                                                                          ║
║  All prerequisites are met. You can proceed with deployment:             ║
║                                                                          ║
║  NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... \\                            ║
║    bun run packages/deployment/scripts/deploy/testnet-babylon-full.ts    ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('❌ Pre-flight check failed:', error.message)
  process.exit(1)
})
