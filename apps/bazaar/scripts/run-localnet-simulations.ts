#!/usr/bin/env bun
/**
 * LOCALNET SIMULATION RUNNER
 * 
 * Runs comprehensive simulations against deployed contracts on localnet.
 * 
 * Prerequisites:
 *   1. Start localnet: bun run localnet:start
 *   2. Deploy contracts: bun run scripts/deploy-all-localnet-contracts.ts
 *   3. Run this script: bun run scripts/run-localnet-simulations.ts
 */

import { spawn } from 'bun'
import { rawDeployments, isValidAddress } from '@jejunetwork/contracts'

const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
}

async function checkPrerequisites(): Promise<boolean> {
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}Checking prerequisites...${COLORS.RESET}\n`)

  // Check if localnet is running
  const response = await fetch('http://localhost:9545', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
  }).catch(() => null)
  
  if (!response?.ok) {
    console.error(`${COLORS.RED}❌ Localnet not responding at http://localhost:9545${COLORS.RESET}`)
    console.log('   Run: bun run localnet:start')
    return false
  }
  
  console.log(`${COLORS.GREEN}✅ Localnet is running${COLORS.RESET}`)

  // Check for deployed contracts using @jejunetwork/contracts
  const requiredDeployments = [
    { name: 'uniswap-v4', deployment: rawDeployments.uniswapV4_1337, key: 'swapRouter' },
    { name: 'bazaar-marketplace', deployment: rawDeployments.bazaarMarketplace1337, key: 'marketplace' },
    { name: 'erc20-factory', deployment: rawDeployments.erc20Factory1337, key: 'at' },
  ] as const

  let allDeployed = true
  for (const { name, deployment, key } of requiredDeployments) {
    const address = (deployment as Record<string, string>)[key]
    if (isValidAddress(address)) {
      console.log(`${COLORS.GREEN}✅ ${name}: ${address}${COLORS.RESET}`)
    } else {
      console.error(`${COLORS.RED}❌ Missing: ${name}${COLORS.RESET}`)
      allDeployed = false
    }
  }

  if (!allDeployed) {
    console.log('\n   Run: bun run scripts/deploy-all-localnet-contracts.ts')
    return false
  }

  return true
}

async function runTests(): Promise<number> {
  console.log(`\n${COLORS.CYAN}${COLORS.BRIGHT}Running localnet simulations...${COLORS.RESET}\n`)

  const proc = spawn({
    cmd: ['bun', 'test', 'tests/integration/'],
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  })

  await proc.exited
  return proc.exitCode ?? 1
}

async function main() {
  console.log(`\n${COLORS.CYAN}${COLORS.BRIGHT}╔═══════════════════════════════════════════════════════════════════════╗${COLORS.RESET}`)
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║                                                                       ║${COLORS.RESET}`)
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║   🧪 BAZAAR LOCALNET SIMULATION SUITE                                 ║${COLORS.RESET}`)
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║                                                                       ║${COLORS.RESET}`)
  console.log(`${COLORS.CYAN}${COLORS.BRIGHT}╚═══════════════════════════════════════════════════════════════════════╝${COLORS.RESET}\n`)

  // Check prerequisites
  const ready = await checkPrerequisites()
  if (!ready) {
    console.log(`\n${COLORS.RED}Prerequisites not met. Please fix the issues above.${COLORS.RESET}`)
    process.exit(1)
  }

  // Run tests
  const exitCode = await runTests()

  if (exitCode === 0) {
    console.log(`\n${COLORS.GREEN}${COLORS.BRIGHT}✅ ALL SIMULATIONS PASSED!${COLORS.RESET}\n`)
  } else {
    console.log(`\n${COLORS.RED}${COLORS.BRIGHT}❌ SOME SIMULATIONS FAILED${COLORS.RESET}\n`)
  }

  process.exit(exitCode)
}

main()
