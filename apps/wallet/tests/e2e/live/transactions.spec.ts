/**
 * Live E2E Tests - Transactions
 *
 * Verifies real transaction signing and sending on the network localnet.
 * Tests actual blockchain state changes.
 */

import { expect, test } from '@playwright/test'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { assertInfrastructureRunning, TEST_CONFIG } from '../setup'

// Define network localnet chain
const jejuLocalnet = {
  id: TEST_CONFIG.chainId,
  name: 'Jeju Localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [TEST_CONFIG.rpcUrl] } },
}

test.describe('Transactions (Live)', () => {
  test.beforeAll(async () => {
    await assertInfrastructureRunning()
  })

  test('should send real ETH transaction', async () => {
    const account = privateKeyToAccount(TEST_CONFIG.testAccount.privateKey)

    const publicClient = createPublicClient({
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    // Get recipient (second well-known test account)
    const recipient = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const

    // Get balance before
    const balanceBefore = await publicClient.getBalance({ address: recipient })

    // Send 1 ETH
    const hash = await walletClient.sendTransaction({
      to: recipient,
      value: parseEther('1'),
    })

    expect(hash).toBeTruthy()
    expect(hash.startsWith('0x')).toBe(true)

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    expect(receipt.status).toBe('success')
    expect(receipt.transactionHash).toBe(hash)

    // Verify balance changed
    const balanceAfter = await publicClient.getBalance({ address: recipient })
    const diff = balanceAfter - balanceBefore

    expect(diff).toBe(parseEther('1'))
  })

  test('should estimate gas correctly', async () => {
    const publicClient = createPublicClient({
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    const gasEstimate = await publicClient.estimateGas({
      account: TEST_CONFIG.testAccount.address,
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      value: parseEther('0.1'),
    })

    // Simple ETH transfer should be ~21000 gas
    expect(gasEstimate).toBeGreaterThanOrEqual(21000n)
    expect(gasEstimate).toBeLessThan(50000n)
  })

  test('should sign message', async () => {
    const account = privateKeyToAccount(TEST_CONFIG.testAccount.privateKey)

    const walletClient = createWalletClient({
      account,
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    const message = 'Hello Network Wallet'
    const signature = await walletClient.signMessage({ message })

    expect(signature).toBeTruthy()
    expect(signature.startsWith('0x')).toBe(true)
    expect(signature.length).toBe(132) // 65 bytes = 130 chars + 0x
  })

  test('should track transaction receipt', async () => {
    const account = privateKeyToAccount(TEST_CONFIG.testAccount.privateKey)

    const publicClient = createPublicClient({
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    // Send transaction
    const hash = await walletClient.sendTransaction({
      to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
      value: parseEther('0.01'),
    })

    // Get receipt
    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    expect(receipt.blockNumber).toBeGreaterThan(0n)
    expect(receipt.from.toLowerCase()).toBe(
      TEST_CONFIG.testAccount.address.toLowerCase(),
    )
    expect(receipt.to?.toLowerCase()).toBe(
      '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase(),
    )
    expect(receipt.status).toBe('success')
    expect(receipt.gasUsed).toBeGreaterThan(0n)
  })

  test('should handle failed transactions gracefully', async () => {
    const account = privateKeyToAccount(TEST_CONFIG.testAccount.privateKey)

    const walletClient = createWalletClient({
      account,
      chain: jejuLocalnet,
      transport: http(TEST_CONFIG.rpcUrl),
    })

    // Try to send more ETH than available (should fail)
    await expect(
      walletClient.sendTransaction({
        to: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
        value: parseEther('1000000'),
      }),
    ).rejects.toThrow()
  })
})
