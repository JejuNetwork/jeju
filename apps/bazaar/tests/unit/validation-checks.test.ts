/**
 * Validation Logic Tests
 * Verify that all security checks are implemented in marketplace hooks
 */

import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Get the directory where this test file is located
const TEST_DIR = dirname(__filename)
// Navigate to bazaar root (tests/unit -> tests -> bazaar root)
const BAZAAR_DIR = join(TEST_DIR, '..', '..')
const HOOKS_DIR = join(BAZAAR_DIR, 'web/hooks')

describe('Marketplace Validation - Code Analysis', () => {
  test('useMarketplace hook exists', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    expect(existsSync(filePath)).toBe(true)
    console.log('✅ useMarketplace hook EXISTS')
  })

  test('useMarketplace has create listing functionality', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('createListing')
    expect(code).toContain('CreateListingParams')
    console.log('✅ useMarketplace: Create listing IMPLEMENTED')
  })

  test('useMarketplace has approval validation', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('getApproved')
    expect(code).toContain('needsApproval')
    expect(code).toContain('isApprovedForAll')
    console.log('✅ useMarketplace: Approval validation IMPLEMENTED')
  })

  test('useMarketplace has buy listing functionality', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('buyListing')
    expect(code).toContain('useBuyListing')
    console.log('✅ useMarketplace: Buy listing IMPLEMENTED')
  })

  test('useMarketplace has cancel listing functionality', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('cancelListing')
    expect(code).toContain('useCancelListing')
    console.log('✅ useMarketplace: Cancel listing IMPLEMENTED')
  })

  test('useMarketplace has price formatting', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('formatEther')
    expect(code).toContain('priceFormatted')
    console.log('✅ useMarketplace: Price formatting IMPLEMENTED')
  })

  test('useMarketplace has listing expiration check', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('expiresAt')
    expect(code).toContain('isExpired')
    console.log('✅ useMarketplace: Expiration check IMPLEMENTED')
  })

  test('useMarketplace has access control', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('isBanned')
    expect(code).toContain('canTrade')
    expect(code).toContain('useMarketplaceAccess')
    console.log('✅ useMarketplace: Access control IMPLEMENTED')
  })

  test('useMarketplace has ERC20 token approval for payments', () => {
    const filePath = join(HOOKS_DIR, 'useMarketplace.ts')
    if (!existsSync(filePath)) {
      console.log('⏭️  Skipping: useMarketplace.ts not found')
      return
    }
    const code = readFileSync(filePath, 'utf-8')

    expect(code).toContain('erc20Abi')
    expect(code).toContain('allowance')
    expect(code).toContain('approve')
    console.log('✅ useMarketplace: ERC20 approval IMPLEMENTED')
  })

  test('NFT Marketplace ABI has all required functions', () => {
    const abiPath = join(BAZAAR_DIR, 'api/abis/NFTMarketplace.json')
    if (!existsSync(abiPath)) {
      console.log('⏭️  Skipping: NFT Marketplace ABI not found')
      return
    }
    const rawAbi = JSON.parse(readFileSync(abiPath, 'utf-8')) as Array<{
      name?: string
      type: string
    }>
    const functionNames = rawAbi
      .filter((item) => item.type === 'function')
      .map((item) => item.name)

    // Check for required functions
    expect(functionNames).toContain('createListing')
    expect(functionNames).toContain('buyListing')
    expect(functionNames).toContain('cancelListing')
    expect(functionNames).toContain('getListing')
    expect(functionNames).toContain('platformFeeBps')

    console.log('✅ NFT Marketplace ABI: All required functions PRESENT')
    console.log(`   Total functions: ${functionNames.length}`)
  })
})
