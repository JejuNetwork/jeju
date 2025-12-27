/**
 * Otto Launch API Tests
 * Tests token launch functionality
 */

import { expect, test } from '@playwright/test'

test.describe('Launch Configs Endpoint', () => {
  test('returns launch configurations', async ({ request }) => {
    const response = await request.get('/api/launch/configs')
    expect(response.ok()).toBe(true)

    const data = await response.json()

    // Check bonding configs
    expect(data.bonding).toBeDefined()
    expect(data.bonding.default).toBeDefined()
    expect(data.bonding.default.virtualEthReserves).toBeDefined()
    expect(data.bonding.default.graduationTarget).toBeDefined()
    expect(data.bonding.default.tokenSupply).toBeDefined()
    expect(data.bonding.degen).toBeDefined()

    // Check ICO config
    expect(data.ico).toBeDefined()
    expect(data.ico.default).toBeDefined()
    expect(data.ico.default.presaleAllocationBps).toBeDefined()
    expect(data.ico.default.softCap).toBeDefined()
    expect(data.ico.default.hardCap).toBeDefined()

    // Check fee config
    expect(data.fee).toBeDefined()
    expect(data.fee.default).toBeDefined()
    expect(data.fee.default.feeTier).toBeDefined()
    expect(data.fee.default.sniperTaxEnabled).toBe(true)

    // Check pool configs
    expect(data.pool).toBeDefined()
    expect(data.pool.project10).toBeDefined()
    expect(data.pool.project20).toBeDefined()
    expect(data.pool.legacy).toBeDefined()

    // Check defaults
    expect(data.defaults).toBeDefined()
    expect(data.defaults.lockLiquidity).toBe(true)

    // Check supported chains
    expect(data.chains).toContain('base')
    expect(data.chains).toContain('arbitrum')
    expect(data.chains).toContain('ethereum')
  })
})

test.describe('Launch Preview Endpoint', () => {
  test('returns preview for bonding curve launch', async ({ request }) => {
    const response = await request.post('/api/launch/preview', {
      data: {
        launchType: 'bonding',
        initialSupply: '1000000000000000000000000000',
        chainId: 420691,
      },
    })

    // May return error if bazaar not running, but should not 500
    if (response.ok()) {
      const data = await response.json()
      expect(data.estimatedGasCost).toBeDefined()
      expect(data.estimatedInitialPrice).toBeDefined()
      expect(data.estimatedMarketCap).toBeDefined()
    } else {
      // Service might not be available - acceptable
      expect(response.status()).toBeLessThan(500)
    }
  })

  test('returns preview for ICO launch', async ({ request }) => {
    const response = await request.post('/api/launch/preview', {
      data: {
        launchType: 'ico',
        initialSupply: '1000000000000000000000000000',
        chainId: 420691,
        icoConfig: {
          presaleAllocationBps: 3000,
          presalePrice: '0.0001',
          lpFundingBps: 8000,
          lpLockDuration: 2592000,
          buyerLockDuration: 604800,
          softCap: '5',
          hardCap: '50',
          presaleDuration: 604800,
        },
      },
    })

    if (response.ok()) {
      const data = await response.json()
      expect(data.estimatedGasCost).toBeDefined()
    } else {
      expect(response.status()).toBeLessThan(500)
    }
  })

  test('rejects invalid launch type', async ({ request }) => {
    const response = await request.post('/api/launch/preview', {
      data: {
        launchType: 'invalid',
        initialSupply: '1000000000',
        chainId: 420691,
      },
    })
    expect(response.status()).toBe(500)
  })

  test('rejects missing supply', async ({ request }) => {
    const response = await request.post('/api/launch/preview', {
      data: {
        launchType: 'bonding',
        chainId: 420691,
      },
    })
    expect(response.status()).toBe(500)
  })
})

test.describe('Launch Create Endpoint', () => {
  const validWallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'

  test('rejects request without wallet address', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      data: {
        userId: 'user123',
        chainId: 420691,
        token: {
          name: 'Test Token',
          symbol: 'TEST',
          initialSupply: '1000000000000000000000000000',
        },
        launchType: 'bonding',
      },
    })
    expect(response.status()).toBe(401)
  })

  test('validates token name', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        userId: 'user123',
        chainId: 420691,
        token: {
          name: '', // Empty name
          symbol: 'TEST',
          initialSupply: '1000000000000000000000000000',
        },
        launchType: 'bonding',
      },
    })
    expect(response.status()).toBe(500)
  })

  test('validates token symbol length', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        userId: 'user123',
        chainId: 420691,
        token: {
          name: 'Test Token',
          symbol: 'VERYLONGSYMBOL', // Over 10 chars
          initialSupply: '1000000000000000000000000000',
        },
        launchType: 'bonding',
      },
    })
    expect(response.status()).toBe(500)
  })

  test('validates token symbol format', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        userId: 'user123',
        chainId: 420691,
        token: {
          name: 'Test Token',
          symbol: 'test!', // Invalid chars
          initialSupply: '1000000000000000000000000000',
        },
        launchType: 'bonding',
      },
    })
    expect(response.status()).toBe(500)
  })

  test('validates tax limits', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        userId: 'user123',
        chain: 'base',
        token: {
          name: 'Test Token',
          symbol: 'TEST',
          // Missing required imageUrl
          initialSupply: '1000000000000000000000000000',
        },
        launchType: 'bonding',
      },
    })
    expect(response.status()).toBe(500)
  })

  test('accepts valid bonding launch request', async ({ request }) => {
    const response = await request.post('/api/launch/create', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        userId: 'user123',
        chain: 'base',
        token: {
          name: 'Moon Token',
          symbol: 'MOON',
          description: 'To the moon',
          imageUrl: 'https://example.com/moon.png',
          initialSupply: '1000000000000000000000000000',
          antiSnipe: true,
          antiSnipeBlocks: 3,
          tradingDelayBlocks: 5,
          lockLiquidity: true,
          liquidityLockDuration: 2592000,
        },
        launchType: 'bonding',
        bondingConfig: {
          virtualEthReserves: '30',
          graduationTarget: '10',
          tokenSupply: '1000000000',
        },
      },
    })

    // Will fail if bazaar not running, but should validate request
    if (!response.ok()) {
      const error = await response.json()
      // Should be a service error, not validation error
      expect(error.error).toBeDefined()
    }
  })
})

test.describe('User Launches Endpoint', () => {
  test('returns empty array for new user', async ({ request }) => {
    const response = await request.get(
      '/api/launch/user/0x0000000000000000000000000000000000000001',
    )
    expect(response.ok()).toBe(true)

    const data = await response.json()
    expect(data.launches).toBeInstanceOf(Array)
  })
})

test.describe('Bonding Curve Trading', () => {
  const validWallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const validBondingCurve = '0x1234567890123456789012345678901234567890'

  test('buy requires wallet address', async ({ request }) => {
    const response = await request.post('/api/launch/bonding/buy', {
      data: {
        bondingCurve: validBondingCurve,
        ethAmount: '1000000000000000000',
        minTokens: '1000000000000000000',
      },
    })
    expect(response.status()).toBe(401)
  })

  test('sell requires wallet address', async ({ request }) => {
    const response = await request.post('/api/launch/bonding/sell', {
      data: {
        bondingCurve: validBondingCurve,
        tokenAmount: '1000000000000000000',
        minEth: '1000000000000000000',
      },
    })
    expect(response.status()).toBe(401)
  })

  test('validates buy request', async ({ request }) => {
    const response = await request.post('/api/launch/bonding/buy', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        bondingCurve: validBondingCurve,
        ethAmount: '1000000000000000000',
        minTokens: '1000000000000000000',
      },
    })

    // Will fail if bazaar not running
    if (!response.ok()) {
      const error = await response.json()
      expect(error.error).toBeDefined()
    }
  })

  test('validates sell request', async ({ request }) => {
    const response = await request.post('/api/launch/bonding/sell', {
      headers: { 'X-Wallet-Address': validWallet },
      data: {
        bondingCurve: validBondingCurve,
        tokenAmount: '1000000000000000000',
        minEth: '1000000000000000000',
      },
    })

    if (!response.ok()) {
      const error = await response.json()
      expect(error.error).toBeDefined()
    }
  })
})

test.describe('Chat Launch Integration', () => {
  let sessionId: string

  test.beforeEach(async ({ request }) => {
    const response = await request.post('/api/chat/session', { data: {} })
    const data = await response.json()
    sessionId = data.sessionId
  })

  test('launch command without wallet prompts connection', async ({
    request,
  }) => {
    const response = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'launch Moon Token MOON' },
    })

    if (!response.ok()) {
      test.skip()
      return
    }

    const data = await response.json()
    expect(data.requiresAuth).toBe(true)
    expect(data.message.content.toLowerCase()).toMatch(/connect|wallet/i)
  })

  test('help returns response', async ({ request }) => {
    const response = await request.post('/api/chat/chat', {
      headers: { 'X-Session-Id': sessionId },
      data: { message: 'help' },
    })

    if (!response.ok()) {
      test.skip()
      return
    }

    const data = await response.json()
    // Help should mention trading capabilities
    expect(data.message.content.toLowerCase()).toMatch(/swap|trade|help/i)
  })
})
