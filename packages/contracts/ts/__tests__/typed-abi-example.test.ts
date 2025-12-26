/**
 * @fileoverview Demonstrates typed ABI usage with viem
 *
 * Shows how generated typed ABIs provide full type inference.
 */

import { describe, expect, test } from 'bun:test'
import { type Address, createPublicClient, getContract, http } from 'viem'
import { mainnet } from 'viem/chains'
import { identityRegistryAbi } from '../generated'

describe('Typed ABI', () => {
  const mockAddress: Address = '0x1234567890123456789012345678901234567890'

  test('typed ABI has correct structure', () => {
    // The typed ABI is a readonly array with const assertion
    expect(Array.isArray(identityRegistryAbi)).toBe(true)
    expect(identityRegistryAbi.length).toBeGreaterThan(0)

    // Find a function in the ABI
    const registerFn = identityRegistryAbi.find(
      (item) => item.type === 'function' && item.name === 'register',
    )
    expect(registerFn).toBeDefined()
  })

  test('demonstrates type inference with getContract', () => {
    // Create a mock client for type checking purposes
    const client = createPublicClient({
      chain: mainnet,
      transport: http(),
    })

    // With typed ABI: Full autocomplete and type inference
    const typedContract = getContract({
      address: mockAddress,
      abi: identityRegistryAbi,
      client,
    })

    // TypeScript knows all the methods:
    // - typedContract.read.isRegistered  -> (args: [address]) => Promise<boolean>
    // - typedContract.read.getIdentity   -> (args: [address]) => Promise<...>
    expect(typedContract.read).toBeDefined()
  })
})

/**
 * Type-level demonstration
 *
 * With typed ABI:
 * ```typescript
 * const result = await client.readContract({
 *   address: '0x...',
 *   abi: identityRegistryAbi,
 *   functionName: 'isRegistered',  // ✓ Autocomplete works
 *   args: ['0x...'],                // ✓ Type checked as [Address]
 * })
 * // result is typed as boolean
 * ```
 */
