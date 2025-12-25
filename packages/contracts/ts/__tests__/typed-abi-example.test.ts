/**
 * @fileoverview Demonstrates typed ABI usage with viem
 *
 * This test file shows the difference between:
 * 1. Legacy ABIs (cast to `Abi`) - no type inference
 * 2. Generated typed ABIs - full type inference
 */

import { describe, expect, test } from 'bun:test'
import { type Address, createPublicClient, getContract, http } from 'viem'
import { mainnet } from 'viem/chains'
// Import legacy ABI (cast to Abi, no type inference)
import { IdentityRegistryAbi } from '../abis'
// Import typed ABI (generated with `as const`)
import { identityRegistryAbi } from '../generated'

describe('Typed ABI vs Legacy ABI', () => {
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

  test('legacy ABI loses type information', () => {
    // Legacy ABI is also an array but typed as generic Abi
    expect(Array.isArray(IdentityRegistryAbi)).toBe(true)

    // Both contain valid ABI entries (may differ in length due to different sources)
    expect(IdentityRegistryAbi.length).toBeGreaterThan(0)
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

    // With legacy ABI: No autocomplete, generic types
    const legacyContract = getContract({
      address: mockAddress,
      abi: IdentityRegistryAbi,
      client,
    })

    // This works at runtime but TypeScript doesn't know the method signatures
    expect(legacyContract.read).toBeDefined()
  })
})

/**
 * Type-level demonstration of the difference
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
 *
 * With legacy ABI:
 * ```typescript
 * const result = await client.readContract({
 *   address: '0x...',
 *   abi: IdentityRegistryAbi,
 *   functionName: 'isRegistered',  // ✗ No autocomplete
 *   args: ['0x...'],                // ✗ No type checking
 * })
 * // result is typed as unknown
 * ```
 */
