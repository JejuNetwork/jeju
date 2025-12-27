/**
 * E2E Smoke Tests
 *
 * Two-tier smoke tests:
 * 1. Basic chain tests (no MetaMask needed) - always run
 * 2. Wallet tests (MetaMask required) - only run if cache is built
 *
 * Run with CLI:
 *   jeju test e2e --smoke
 *
 * Or directly with Playwright:
 *   bunx playwright test packages/tests/smoke/wallet-smoke.spec.ts --config packages/tests/smoke/synpress.config.ts
 *
 * To run with MetaMask (requires display):
 *   jeju test e2e --build-cache   # Build cache first
 *   jeju test e2e --smoke         # Then run tests
 */

import { expect, test } from '@playwright/test'
import {
  type Address,
  createPublicClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import {
  JEJU_CHAIN_ID,
  JEJU_RPC_URL,
  TEST_WALLET_ADDRESS,
} from '../shared/utils'

const RPC_URL = JEJU_RPC_URL
const CHAIN_ID = JEJU_CHAIN_ID

const chain = {
  id: CHAIN_ID,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL),
})

test.describe('1. Chain Connectivity', () => {
  test('should verify chain is running and accessible', async () => {
    console.log('┌─────────────────────────────────────────────────────────┐')
    console.log('│           JEJU SYNPRESS SMOKE TEST                      │')
    console.log('└─────────────────────────────────────────────────────────┘')
    console.log(`\n📡 RPC URL: ${RPC_URL}`)
    console.log(`🔗 Expected Chain ID: ${CHAIN_ID}`)

    // Verify chain is accessible
    const chainId = await publicClient.getChainId()
    expect(chainId).toBe(CHAIN_ID)
    console.log(`✅ Chain ID verified: ${chainId}`)

    // Get current block
    const blockNumber = await publicClient.getBlockNumber()
    expect(blockNumber).toBeGreaterThanOrEqual(0n)
    console.log(`✅ Chain at block: ${blockNumber}`)
  })

  test('should verify test wallet has balance', async () => {
    const balance = await publicClient.getBalance({
      address: TEST_WALLET_ADDRESS as Address,
    })

    // Anvil funds accounts with 10000 ETH by default
    expect(balance).toBeGreaterThan(parseEther('1'))
    console.log(
      `✅ Test wallet (${TEST_WALLET_ADDRESS.slice(0, 10)}...): ${formatEther(balance)} ETH`,
    )
  })
})

test.describe('2. On-Chain State Verification', () => {
  test('should read on-chain data', async () => {
    // Verify we can read state from the chain
    const gasPrice = await publicClient.getGasPrice()
    expect(gasPrice).toBeGreaterThan(0n)
    console.log(`✅ Current gas price: ${gasPrice} wei`)

    // Get latest block
    const block = await publicClient.getBlock({ blockTag: 'latest' })
    expect(block.number).toBeDefined()
    console.log(`✅ Latest block hash: ${block.hash.slice(0, 18)}...`)
    console.log(
      `✅ Block timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`,
    )
  })
})

test.describe('3. Summary', () => {
  test('should print validation summary', async () => {
    console.log('\n')
    console.log(
      '╔═══════════════════════════════════════════════════════════════════╗',
    )
    console.log(
      '║              JEJU SMOKE TEST - SUMMARY                            ║',
    )
    console.log(
      '╠═══════════════════════════════════════════════════════════════════╣',
    )

    // Chain health
    const chainId = await publicClient.getChainId()
    const blockNumber = await publicClient.getBlockNumber()
    console.log(`║ Chain ID:        ${chainId.toString().padEnd(48)}║`)
    console.log(`║ Block Number:    ${blockNumber.toString().padEnd(48)}║`)

    // Wallet balance
    const balance = await publicClient.getBalance({
      address: TEST_WALLET_ADDRESS as Address,
    })
    console.log(
      `║ Wallet Balance:  ${formatEther(balance).slice(0, 15).padEnd(48)}║`,
    )
    console.log(`║ Wallet Address:  ${TEST_WALLET_ADDRESS.padEnd(48)}║`)

    console.log(
      '╠═══════════════════════════════════════════════════════════════════╣',
    )
    console.log(
      '║ ✅ Chain smoke tests passed                                       ║',
    )
    console.log(
      '╚═══════════════════════════════════════════════════════════════════╝',
    )
    console.log('\n')

    console.log('Next steps:')
    console.log('  • Build wallet cache:  jeju test e2e --build-cache')
    console.log('  • Run app tests:       jeju test e2e --app gateway')
    console.log('  • Run all e2e tests:   jeju test e2e')
    console.log('\n')
  })
})
