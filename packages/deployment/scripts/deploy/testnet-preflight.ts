#!/usr/bin/env bun
/**
 * Testnet Pre-Flight Check (Decentralized Deployment)
 *
 * Validates all prerequisites before running testnet deployment:
 * - Required tools (bun, forge, ipfs)
 * - Deployer wallet balance
 * - API keys for services
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

interface CheckResult {
  name: string
  status: 'pass' | 'fail' | 'warn'
  message: string
  fix?: string
}

const results: CheckResult[] = []

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
║   🔍 TESTNET PRE-FLIGHT CHECK (Decentralized)                            ║
║                                                                          ║
║   Validates prerequisites for permissionless deployment                  ║
║   - No AWS, Terraform, or Kubernetes required                            ║
║   - Deploy via on-chain contracts + DWS                                  ║
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

  // Check IPFS (optional but recommended)
  check('IPFS CLI', () => {
    const version = execSync('ipfs --version 2>/dev/null || echo "not found"', {
      encoding: 'utf-8',
    }).trim()
    if (version === 'not found') {
      return {
        status: 'warn',
        message: 'Not installed (will use DWS storage endpoint)',
        fix: 'brew install ipfs',
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

  // Check jq (for JSON parsing)
  check('jq', () => {
    const version = execSync('jq --version 2>/dev/null || echo "not found"', {
      encoding: 'utf-8',
    }).trim()
    if (version === 'not found') {
      return {
        status: 'warn',
        message: 'Not installed (optional, for JSON parsing)',
        fix: 'brew install jq',
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

  // Check IPFS API URL (optional)
  check('IPFS_API_URL', () => {
    const url = process.env.IPFS_API_URL
    if (!url) {
      return {
        status: 'pass',
        message:
          'Not set (will use default: https://ipfs-api.testnet.jejunetwork.org)',
      }
    }
    return { status: 'pass', message: url }
  })

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Wallet Balances')
  console.log(`${'═'.repeat(70)}\n`)

  if (deployerKey) {
    const account = privateKeyToAccount(deployerKey as `0x${string}`)
    console.log(`Deployer Address: ${account.address}\n`)

    // Check Sepolia balance (for L1 bridge if needed)
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
          status: 'warn',
          message: `${balanceEth.toFixed(4)} ETH (need 0.1+ for L1 bridge)`,
          fix: 'Get Sepolia ETH from: https://sepoliafaucet.com',
        }
      }
      return { status: 'pass', message: `${balanceEth.toFixed(4)} ETH` }
    })

    // Check Jeju testnet balance
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
    console.log('⚠️  Skipping balance checks (no deployer key)')
  }

  console.log(`\n${'═'.repeat(70)}`)
  console.log('📋 Project Structure')
  console.log(`${'═'.repeat(70)}\n`)

  // Check contracts package
  check('Contracts Package', () => {
    const foundryToml = join(ROOT, 'packages/contracts/foundry.toml')
    if (existsSync(foundryToml)) {
      return { status: 'pass', message: 'Found' }
    }
    return { status: 'fail', message: 'foundry.toml not found' }
  })

  // Check DWS bootstrap script
  check('DWS Bootstrap Script', () => {
    const script = join(
      ROOT,
      'packages/deployment/scripts/deploy/dws-bootstrap.ts',
    )
    if (existsSync(script)) {
      return { status: 'pass', message: 'Found' }
    }
    return { status: 'fail', message: 'dws-bootstrap.ts not found' }
  })

  // Check apps directory
  check('Apps Directory', () => {
    const appsDir = join(ROOT, 'apps')
    if (existsSync(appsDir)) {
      return { status: 'pass', message: 'Found' }
    }
    return { status: 'fail', message: 'apps/ not found' }
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
║  All prerequisites are met. Deploy with:                                 ║
║                                                                          ║
║  NETWORK=testnet DEPLOYER_PRIVATE_KEY=0x... \\                            ║
║    bun run packages/deployment/scripts/deploy/dws-bootstrap.ts           ║
╚══════════════════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('❌ Pre-flight check failed:', error.message)
  process.exit(1)
})
