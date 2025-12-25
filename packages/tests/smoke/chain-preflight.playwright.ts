/**
 * Chain Preflight Smoke Tests
 *
 * These tests verify the basic chain infrastructure is working
 * before running any wallet/E2E tests. They do NOT require Synpress
 * and can run quickly to validate the test environment.
 *
 * Run these first to catch infrastructure issues early:
 *   bunx playwright test packages/tests/smoke/chain-preflight.spec.ts
 */

import { getChainId, getContract, getRpcUrl } from '@jejunetwork/config'
import { expect, test } from '@playwright/test'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { TEST_ACCOUNTS } from '../shared/utils'

const RPC_URL = getRpcUrl('localnet')
const CHAIN_ID = getChainId('localnet')
const ERC20_FACTORY_ADDRESS = getContract('tokens', 'factory', 'localnet') as
  | Address
  | undefined
const NFT_MARKETPLACE_ADDRESS = getContract('nft', 'marketplace', 'localnet') as
  | Address
  | undefined

// Use shared test accounts (Anvil defaults)
const TEST_PRIVATE_KEY = TEST_ACCOUNTS.deployer.privateKey
const TEST_ADDRESS = TEST_ACCOUNTS.deployer.address as Address

const chain = {
  id: CHAIN_ID,
  name: 'Network Local',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
}

const publicClient = createPublicClient({
  chain,
  transport: http(RPC_URL, { timeout: 10000 }),
})

test.describe('Chain Infrastructure', () => {
  test('RPC responds to eth_blockNumber', async () => {
    const blockNumber = await publicClient.getBlockNumber()
    expect(blockNumber).toBeGreaterThanOrEqual(0n)
    console.log(`Current block: ${blockNumber}`)
  })

  test('Chain ID matches expected', async () => {
    const actualChainId = await publicClient.getChainId()
    expect(actualChainId).toBe(CHAIN_ID)
    console.log(`Chain ID: ${actualChainId}`)
  })

  test('Test account has sufficient ETH', async () => {
    const balance = await publicClient.getBalance({ address: TEST_ADDRESS })
    expect(balance).toBeGreaterThan(parseEther('1'))
    console.log(`Balance: ${formatEther(balance)} ETH`)
  })

  test('Blocks are being produced', async () => {
    const block1 = await publicClient.getBlockNumber()
    await new Promise((r) => setTimeout(r, 2000))
    const block2 = await publicClient.getBlockNumber()

    // Blocks should at least not go backwards
    expect(block2).toBeGreaterThanOrEqual(block1)
    console.log(`Block progression: ${block1} -> ${block2}`)
  })
})

test.describe('Transaction Verification', () => {
  test('Can estimate gas for simple transfer', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)

    const gasEstimate = await publicClient.estimateGas({
      account: account.address,
      to: TEST_ADDRESS,
      value: parseEther('0.001'),
    })

    expect(gasEstimate).toBeGreaterThan(0n)
    console.log(`Gas estimate: ${gasEstimate}`)
  })

  test('Can send and confirm transaction', async () => {
    const account = privateKeyToAccount(TEST_PRIVATE_KEY)

    const walletClient = createWalletClient({
      chain,
      transport: http(RPC_URL, { timeout: 30000 }),
      account,
    })

    const balanceBefore = await publicClient.getBalance({
      address: account.address,
    })

    // Send a tiny amount to self
    const txHash = await walletClient.sendTransaction({
      to: account.address,
      value: parseEther('0.0001'),
    })

    console.log(`Transaction hash: ${txHash}`)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: 30000,
    })

    expect(receipt.status).toBe('success')
    expect(receipt.blockNumber).toBeGreaterThan(0n)

    const balanceAfter = await publicClient.getBalance({
      address: account.address,
    })
    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice

    console.log(`Block: ${receipt.blockNumber}`)
    console.log(`Gas used: ${formatEther(gasUsed)} ETH`)
    console.log(
      `Balance change: ${formatEther(balanceBefore - balanceAfter)} ETH`,
    )

    // Balance should have decreased by gas amount
    expect(balanceAfter).toBeLessThan(balanceBefore)
  })
})

test.describe('Contract Deployment Check', () => {
  test('Can verify ERC20 Factory deployment', async () => {
    const factoryAddress = ERC20_FACTORY_ADDRESS

    if (
      !factoryAddress ||
      factoryAddress === '0x0000000000000000000000000000000000000000'
    ) {
      test.skip()
      return
    }

    const code = await publicClient.getCode({ address: factoryAddress })
    expect(code).not.toBe('0x')
    console.log(`ERC20 Factory deployed at ${factoryAddress}`)
  })

  test('Can verify NFT Marketplace deployment', async () => {
    const marketplaceAddress = NFT_MARKETPLACE_ADDRESS

    if (
      !marketplaceAddress ||
      marketplaceAddress === '0x0000000000000000000000000000000000000000'
    ) {
      test.skip()
      return
    }

    const code = await publicClient.getCode({ address: marketplaceAddress })
    expect(code).not.toBe('0x')
    console.log(`NFT Marketplace deployed at ${marketplaceAddress}`)
  })
})

test.describe('RPC Health', () => {
  test('RPC responds within acceptable time', async () => {
    const start = Date.now()
    await publicClient.getBlockNumber()
    const duration = Date.now() - start

    expect(duration).toBeLessThan(5000)
    console.log(`RPC response time: ${duration}ms`)
  })

  test('Can fetch latest block details', async () => {
    const block = await publicClient.getBlock({ blockTag: 'latest' })

    expect(block.hash).toMatch(/^0x[a-fA-F0-9]{64}$/)
    expect(block.number).toBeGreaterThanOrEqual(0n)
    expect(block.timestamp).toBeGreaterThan(0n)

    console.log(`Latest block: ${block.number}`)
    console.log(
      `Timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`,
    )
  })
})
