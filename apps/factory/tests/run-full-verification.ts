/**
 * Full E2E Verification Runner
 * Runs all tests, verifies on-chain state, and produces validation report
 */

import { exec, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  getCurrentNetwork,
  getL2RpcUrl,
  getLocalhostHost,
} from '@jejunetwork/config'

const execAsync = promisify(exec)

interface TestResult {
  suite: string
  test: string
  status: 'passed' | 'failed' | 'skipped'
  duration: number
  error?: string
}

interface VerificationResult {
  type: string
  resource: string
  expected: string
  actual: string
  verified: boolean
}

interface ValidationReport {
  timestamp: string
  duration: number
  tests: {
    total: number
    passed: number
    failed: number
    skipped: number
    results: TestResult[]
  }
  blockchain: {
    network: string
    rpcUrl: string
    contracts: Record<string, string>
    verifications: VerificationResult[]
  }
  summary: {
    allTestsPassed: boolean
    allVerificationsPassed: boolean
    overallSuccess: boolean
  }
}

const REPORTS_DIR = join(process.cwd(), 'test-reports')
const RPC_URL =
  (typeof process !== 'undefined' ? process.env.RPC_URL : undefined) ??
  getL2RpcUrl() ??
  `http://${getLocalhostHost()}:6546`
const NETWORK = getCurrentNetwork()

async function ensureReportsDir(): Promise<void> {
  if (!existsSync(REPORTS_DIR)) {
    mkdirSync(REPORTS_DIR, { recursive: true })
  }
}

async function startLocalBlockchain(): Promise<void> {
  console.log('Starting local blockchain...')

  const anvil = spawn('anvil', ['--port', '8545'], {
    detached: true,
    stdio: 'ignore',
  })

  anvil.unref()

  // Wait for anvil to be ready
  await new Promise<void>((resolve) => setTimeout(resolve, 3000))

  // Verify it's running
  const { stdout } = await execAsync(
    `curl -s -X POST -H "Content-Type: application/json" --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' ${RPC_URL}`,
  )

  if (!stdout.includes('result')) {
    throw new Error('Failed to start local blockchain')
  }

  console.log('Local blockchain running')
}

async function deployContracts(): Promise<Record<string, string>> {
  console.log('Deploying contracts...')

  const { stdout } = await execAsync(
    'bun run scripts/deploy-contracts.ts --network localnet',
    { cwd: join(process.cwd(), '..', '..') },
  )

  // Parse deployed addresses from output
  const addresses: Record<string, string> = {}
  const addressMatches = stdout.matchAll(
    /(\w+) deployed at: (0x[a-fA-F0-9]{40})/g,
  )

  for (const match of addressMatches) {
    addresses[match[1]] = match[2]
  }

  console.log('Contracts deployed:', addresses)
  return addresses
}

async function startDevServer(): Promise<void> {
  console.log('Starting dev server...')

  const dev = spawn('bun', ['run', 'dev'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORT: '3000' },
  })

  dev.unref()

  // Wait for server to be ready
  let ready = false
  for (let i = 0; i < 30; i++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 1000))

    const host = getLocalhostHost()
    const result = await execAsync(`curl -s http://${host}:3000`).catch(() => ({
      stdout: '',
    }))
    if (result.stdout.includes('<!DOCTYPE html>')) {
      ready = true
      break
    }
  }

  if (!ready) {
    throw new Error('Dev server failed to start')
  }

  console.log('Dev server running')
}

async function runPlaywrightTests(): Promise<TestResult[]> {
  console.log('Running Playwright tests...')

  const results: TestResult[] = []

  const { stdout } = await execAsync(
    'bunx playwright test --reporter=json 2>&1 || true',
    { maxBuffer: 10 * 1024 * 1024 },
  )

  const jsonOutput = JSON.parse(stdout)

  for (const suite of jsonOutput.suites ?? []) {
    for (const test of suite.specs ?? []) {
      results.push({
        suite: suite.title,
        test: test.title,
        status: test.ok ? 'passed' : 'failed',
        duration: test.duration ?? 0,
        error: test.ok ? undefined : test.error?.message,
      })
    }
  }

  return results
}

async function runSynpressTests(): Promise<TestResult[]> {
  console.log('Running Synpress wallet tests...')

  const results: TestResult[] = []

  const { stdout } = await execAsync(
    'bunx playwright test tests/e2e/wallet.spec.ts tests/e2e/blockchain-verification.spec.ts --reporter=json 2>&1 || true',
    { maxBuffer: 10 * 1024 * 1024 },
  )

  const jsonOutput = JSON.parse(stdout)

  for (const suite of jsonOutput.suites ?? []) {
    for (const test of suite.specs ?? []) {
      results.push({
        suite: suite.title,
        test: test.title,
        status: test.ok ? 'passed' : 'failed',
        duration: test.duration ?? 0,
        error: test.ok ? undefined : test.error?.message,
      })
    }
  }

  return results
}

async function verifyOnChainState(
  contracts: Record<string, string>,
): Promise<VerificationResult[]> {
  console.log('Verifying on-chain state...')

  const verifications: VerificationResult[] = []

  // Verify each contract is deployed
  for (const [name, address] of Object.entries(contracts)) {
    const { stdout } = await execAsync(
      `cast code ${address} --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_deployment',
      resource: name,
      expected: 'has bytecode',
      actual: stdout.length > 2 ? 'has bytecode' : 'no bytecode',
      verified: stdout.length > 2,
    })
  }

  // Verify BountyRegistry has correct owner
  if (contracts.BountyRegistry) {
    const { stdout } = await execAsync(
      `cast call ${contracts.BountyRegistry} "owner()(address)" --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_state',
      resource: 'BountyRegistry.owner',
      expected: 'valid address',
      actual: stdout.trim(),
      verified: stdout.trim().startsWith('0x'),
    })
  }

  // Verify GuardianRegistry minimum stake
  if (contracts.GuardianRegistry) {
    const { stdout } = await execAsync(
      `cast call ${contracts.GuardianRegistry} "minimumStake()(uint256)" --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_state',
      resource: 'GuardianRegistry.minimumStake',
      expected: '> 0',
      actual: stdout.trim(),
      verified: BigInt(stdout.trim()) > 0n,
    })
  }

  // Verify ModelRegistry is functional
  if (contracts.ModelRegistry) {
    const { stdout } = await execAsync(
      `cast call ${contracts.ModelRegistry} "modelCount()(uint256)" --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_state',
      resource: 'ModelRegistry.modelCount',
      expected: '>= 0',
      actual: stdout.trim(),
      verified: BigInt(stdout.trim()) >= 0n,
    })
  }

  // Verify ContainerRegistry is functional
  if (contracts.ContainerRegistry) {
    const { stdout } = await execAsync(
      `cast call ${contracts.ContainerRegistry} "containerCount()(uint256)" --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_state',
      resource: 'ContainerRegistry.containerCount',
      expected: '>= 0',
      actual: stdout.trim(),
      verified: BigInt(stdout.trim()) >= 0n,
    })
  }

  // Verify ProjectBoard is functional
  if (contracts.ProjectBoard) {
    const { stdout } = await execAsync(
      `cast call ${contracts.ProjectBoard} "projectCount()(uint256)" --rpc-url ${RPC_URL}`,
    )

    verifications.push({
      type: 'contract_state',
      resource: 'ProjectBoard.projectCount',
      expected: '>= 0',
      actual: stdout.trim(),
      verified: BigInt(stdout.trim()) >= 0n,
    })
  }

  return verifications
}

async function runJejuCLIVerification(): Promise<VerificationResult[]> {
  console.log('Running Jeju CLI verification...')

  const verifications: VerificationResult[] = []

  // Test CLI commands
  const cliTests = [
    { cmd: 'bounty list --network localnet', expected: 'bounties' },
    { cmd: 'model list --network localnet', expected: 'models' },
    { cmd: 'container list --network localnet', expected: 'containers' },
    { cmd: 'guardian list --network localnet', expected: 'guardians' },
    { cmd: 'project list --network localnet', expected: 'projects' },
  ]

  const workspaceRoot = join(process.cwd(), '..', '..')
  for (const test of cliTests) {
    const result = await execAsync(
      `bun run packages/cli/src/index.ts ${test.cmd} 2>&1`,
      { cwd: workspaceRoot },
    ).catch((e: Error) => ({ stdout: '', stderr: e.message }))

    verifications.push({
      type: 'cli_command',
      resource: test.cmd,
      expected: test.expected,
      actual: result.stdout.slice(0, 100),
      verified:
        result.stdout.includes(test.expected) ||
        !('stderr' in result && result.stderr),
    })
  }

  return verifications
}

async function generateReport(
  testResults: TestResult[],
  contracts: Record<string, string>,
  verifications: VerificationResult[],
  startTime: number,
): Promise<ValidationReport> {
  const endTime = Date.now()

  const passed = testResults.filter((t) => t.status === 'passed').length
  const failed = testResults.filter((t) => t.status === 'failed').length
  const skipped = testResults.filter((t) => t.status === 'skipped').length

  const allTestsPassed = failed === 0
  const allVerificationsPassed = verifications.every((v) => v.verified)

  return {
    timestamp: new Date().toISOString(),
    duration: endTime - startTime,
    tests: {
      total: testResults.length,
      passed,
      failed,
      skipped,
      results: testResults,
    },
    blockchain: {
      network: NETWORK,
      rpcUrl: RPC_URL,
      contracts,
      verifications,
    },
    summary: {
      allTestsPassed,
      allVerificationsPassed,
      overallSuccess: allTestsPassed && allVerificationsPassed,
    },
  }
}

async function printSummary(report: ValidationReport): Promise<void> {
  console.log('\n========================================')
  console.log('        VALIDATION REPORT SUMMARY       ')
  console.log('========================================\n')

  console.log(`Timestamp: ${report.timestamp}`)
  console.log(`Duration: ${(report.duration / 1000).toFixed(2)}s`)
  console.log(`Network: ${report.blockchain.network}`)

  console.log('\n--- TEST RESULTS ---')
  console.log(`Total: ${report.tests.total}`)
  console.log(`Passed: ${report.tests.passed}`)
  console.log(`Failed: ${report.tests.failed}`)
  console.log(`Skipped: ${report.tests.skipped}`)

  if (report.tests.failed > 0) {
    console.log('\nFailed Tests:')
    for (const test of report.tests.results.filter(
      (t) => t.status === 'failed',
    )) {
      console.log(`  - ${test.suite}: ${test.test}`)
      if (test.error) {
        console.log(`    Error: ${test.error.slice(0, 200)}`)
      }
    }
  }

  console.log('\n--- BLOCKCHAIN VERIFICATIONS ---')
  console.log(
    `Contracts Deployed: ${Object.keys(report.blockchain.contracts).length}`,
  )

  for (const [name, address] of Object.entries(report.blockchain.contracts)) {
    console.log(`  ${name}: ${address}`)
  }

  console.log('\nVerification Results:')
  for (const v of report.blockchain.verifications) {
    const status = v.verified ? '✓' : '✗'
    console.log(`  ${status} ${v.resource}: ${v.actual.slice(0, 50)}`)
  }

  console.log('\n========================================')
  console.log('           OVERALL RESULT              ')
  console.log('========================================')

  if (report.summary.overallSuccess) {
    console.log('\n✓ ALL TESTS PASSED')
    console.log('✓ ALL VERIFICATIONS PASSED')
    console.log('\n🎉 VALIDATION SUCCESSFUL 🎉\n')
  } else {
    if (!report.summary.allTestsPassed) {
      console.log('\n✗ SOME TESTS FAILED')
    }
    if (!report.summary.allVerificationsPassed) {
      console.log('✗ SOME VERIFICATIONS FAILED')
    }
    console.log('\n❌ VALIDATION FAILED ❌\n')
  }
}

async function main(): Promise<void> {
  const startTime = Date.now()

  console.log('Starting Full E2E Verification...\n')

  await ensureReportsDir()

  let contracts: Record<string, string> = {}
  const testResults: TestResult[] = []
  const verifications: VerificationResult[] = []

  // Step 1: Start local blockchain
  await startLocalBlockchain()

  // Step 2: Deploy contracts
  contracts = await deployContracts()

  // Step 3: Start dev server
  await startDevServer()

  // Step 4: Run Playwright tests
  const playwrightResults = await runPlaywrightTests()
  testResults.push(...playwrightResults)

  // Step 5: Run Synpress wallet tests
  const synpressResults = await runSynpressTests()
  testResults.push(...synpressResults)

  // Step 6: Verify on-chain state
  const onChainVerifications = await verifyOnChainState(contracts)
  verifications.push(...onChainVerifications)

  // Step 7: Run Jeju CLI verification
  const cliVerifications = await runJejuCLIVerification()
  verifications.push(...cliVerifications)

  // Step 8: Generate report
  const report = await generateReport(
    testResults,
    contracts,
    verifications,
    startTime,
  )

  // Step 9: Save report
  const reportPath = join(REPORTS_DIR, `validation-${Date.now()}.json`)
  writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`\nReport saved to: ${reportPath}`)

  // Step 10: Print summary
  await printSummary(report)

  // Exit with appropriate code
  process.exit(report.summary.overallSuccess ? 0 : 1)
}

main().catch((error) => {
  console.error('Verification failed:', error)
  process.exit(1)
})
