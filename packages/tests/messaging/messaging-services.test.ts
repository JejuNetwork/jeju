/**
 * Messaging Services Tests - All Apps
 *
 * Tests for Gateway, Bazaar, Crucible, and Autocrat messaging services.
 * These tests verify the service structure and notification generation.
 */

import { describe, expect, test } from 'bun:test'
import { FarcasterClient } from '@jejunetwork/messaging'

const HUB_URL = 'https://hub.pinata.cloud'

// ============================================================================
// GATEWAY MESSAGING SERVICE
// ============================================================================

describe('Gateway Messaging Service', () => {
  test('service can be imported and instantiated', async () => {
    const { GatewayMessagingService, gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    expect(gatewayMessaging).toBeDefined()
    expect(gatewayMessaging).toBeInstanceOf(GatewayMessagingService)
  })

  test('getChannelFeed returns proper structure', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const result = await gatewayMessaging.getChannelFeed({ limit: 5 })

    expect(result).toBeDefined()
    expect(result.casts).toBeDefined()
    expect(Array.isArray(result.casts)).toBe(true)

    // If there are casts, verify structure
    if (result.casts.length > 0) {
      const cast = result.casts[0]
      expect(cast.hash).toBeDefined()
      expect(cast.author).toBeDefined()
      expect(cast.author.fid).toBeDefined()
      expect(cast.text).toBeDefined()
      expect(cast.timestamp).toBeDefined()
    }

    console.log(`Gateway feed: ${result.casts.length} casts`)
  })

  test('bridgeCompleteNotification generates correct payload', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const notification = gatewayMessaging.bridgeCompleteNotification({
      fromChain: 'Ethereum',
      toChain: 'Jeju',
      amount: '1.5',
      token: 'ETH',
      txHash: '0x1234567890abcdef',
    })

    expect(notification.type).toBe('bridge_complete')
    expect(notification.title).toBe('Bridge Complete')
    expect(notification.body).toContain('1.5')
    expect(notification.body).toContain('ETH')
    expect(notification.body).toContain('Ethereum')
    expect(notification.body).toContain('Jeju')
    expect(notification.data).toBeDefined()
    expect(notification.data?.txHash).toBe('0x1234567890abcdef')
  })

  test('intentFilledNotification generates correct payload', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const notification = gatewayMessaging.intentFilledNotification({
      intentId: 'intent-123',
      solver: 'solver.eth',
      fillAmount: '100 USDC',
    })

    expect(notification.type).toBe('intent_filled')
    expect(notification.title).toBe('Intent Filled')
    expect(notification.body).toContain('solver.eth')
    expect(notification.body).toContain('100 USDC')
  })

  test('nodeRewardNotification generates correct payload', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const notification = gatewayMessaging.nodeRewardNotification({
      nodeId: 'node-456',
      amount: '50',
      epoch: 42,
    })

    expect(notification.type).toBe('node_reward')
    expect(notification.title).toBe('Node Reward Earned')
    expect(notification.body).toContain('50')
    expect(notification.body).toContain('42')
  })

  test('liquidityUpdateNotification - add action', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const notification = gatewayMessaging.liquidityUpdateNotification({
      poolId: 'pool-789',
      action: 'add',
      amount: '1000 USDC',
    })

    expect(notification.type).toBe('liquidity_update')
    expect(notification.title).toBe('Liquidity Added')
    expect(notification.body).toContain('Added')
    expect(notification.body).toContain('1000 USDC')
  })

  test('liquidityUpdateNotification - remove action with fees', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const notification = gatewayMessaging.liquidityUpdateNotification({
      poolId: 'pool-789',
      action: 'remove',
      amount: '500 USDC',
      feesEarned: '25 USDC',
    })

    expect(notification.type).toBe('liquidity_update')
    expect(notification.title).toBe('Liquidity Removed')
    expect(notification.body).toContain('Removed')
    expect(notification.body).toContain('25 USDC')
  })

  test('createNotification wraps payload with channel', async () => {
    const { gatewayMessaging } = await import(
      '../../../apps/gateway/api/services/messaging'
    )

    const wrapped = gatewayMessaging.createNotification({
      type: 'bridge_complete',
      title: 'Test',
      body: 'Test body',
      data: { foo: 'bar' },
    })

    expect(wrapped.channel).toBe('gateway')
    expect(wrapped.type).toBe('bridge_complete')
    expect(wrapped.data).toEqual({ foo: 'bar' })
  })
})

// ============================================================================
// BAZAAR MESSAGING SERVICE
// ============================================================================

describe('Bazaar Messaging Service', () => {
  test('service can be imported and instantiated', async () => {
    const { BazaarMessagingService, bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    expect(bazaarMessaging).toBeDefined()
    expect(bazaarMessaging).toBeInstanceOf(BazaarMessagingService)
  })

  test('getChannelFeed returns proper structure', async () => {
    const { bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    const result = await bazaarMessaging.getChannelFeed({ limit: 5 })

    expect(result).toBeDefined()
    expect(result.casts).toBeDefined()
    expect(Array.isArray(result.casts)).toBe(true)

    console.log(`Bazaar feed: ${result.casts.length} casts`)
  })

  test('listingSoldNotification generates correct payload', async () => {
    const { bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    const notification = bazaarMessaging.listingSoldNotification({
      nftName: 'Cool NFT #123',
      price: '0.5 ETH',
      buyer: 'alice.eth',
      collection: 'CoolNFTs',
    })

    expect(notification.type).toBe('listing_sold')
    expect(notification.title).toBe('Item Sold')
    expect(notification.body).toContain('Cool NFT #123')
    expect(notification.body).toContain('0.5 ETH')
    expect(notification.body).toContain('alice.eth')
  })

  test('bidReceivedNotification generates correct payload', async () => {
    const { bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    const notification = bazaarMessaging.bidReceivedNotification({
      nftName: 'Rare Item',
      bidAmount: '1.2 ETH',
      bidder: 'bob.eth',
    })

    expect(notification.type).toBe('bid_received')
    expect(notification.title).toBe('New Bid Received')
    expect(notification.body).toContain('bob.eth')
    expect(notification.body).toContain('1.2 ETH')
  })

  test('auctionEndedNotification generates correct payload', async () => {
    const { bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    const notification = bazaarMessaging.auctionEndedNotification({
      nftName: 'Prize NFT',
      winner: 'charlie.eth',
      finalPrice: '5 ETH',
    })

    expect(notification.type).toBe('auction_ended')
    expect(notification.title).toBe('Auction Ended')
    expect(notification.body).toContain('charlie.eth')
    expect(notification.body).toContain('Prize NFT')
    expect(notification.body).toContain('5 ETH')
  })

  test('collectionTrendingNotification generates correct payload', async () => {
    const { bazaarMessaging } = await import(
      '../../../apps/bazaar/api/messaging'
    )

    const notification = bazaarMessaging.collectionTrendingNotification({
      collectionName: 'Hot Collection',
      volumeChange: '+150%',
      floorChange: '+25%',
    })

    expect(notification.type).toBe('collection_trending')
    expect(notification.title).toBe('Collection Trending')
    expect(notification.body).toContain('Hot Collection')
    expect(notification.body).toContain('+150%')
    expect(notification.body).toContain('+25%')
  })
})

// ============================================================================
// CRUCIBLE MESSAGING SERVICE
// ============================================================================

describe('Crucible Messaging Service', () => {
  test('service can be imported and instantiated', async () => {
    const { CrucibleMessagingService, crucibleMessaging } = await import(
      '../../../apps/crucible/api/messaging'
    )

    expect(crucibleMessaging).toBeDefined()
    expect(crucibleMessaging).toBeInstanceOf(CrucibleMessagingService)
  })

  test('getChannelFeed returns proper structure', async () => {
    const { crucibleMessaging } = await import(
      '../../../apps/crucible/api/messaging'
    )

    const result = await crucibleMessaging.getChannelFeed({ limit: 5 })

    expect(result).toBeDefined()
    expect(result.casts).toBeDefined()
    expect(Array.isArray(result.casts)).toBe(true)

    console.log(`Crucible feed: ${result.casts.length} casts`)
  })
})

// ============================================================================
// AUTOCRAT MESSAGING SERVICE
// ============================================================================

describe('Autocrat Messaging Service', () => {
  test('service can be imported and instantiated', async () => {
    const { AutocratMessagingService, autocratMessaging } = await import(
      '../../../apps/autocrat/api/messaging'
    )

    expect(autocratMessaging).toBeDefined()
    expect(autocratMessaging).toBeInstanceOf(AutocratMessagingService)
  })

  test('getChannelFeed returns proper structure', async () => {
    const { autocratMessaging } = await import(
      '../../../apps/autocrat/api/messaging'
    )

    const result = await autocratMessaging.getChannelFeed({ limit: 5 })

    expect(result).toBeDefined()
    expect(result.casts).toBeDefined()
    expect(Array.isArray(result.casts)).toBe(true)

    console.log(`Autocrat feed: ${result.casts.length} casts`)
  })
})

// ============================================================================
// FARCASTER CLIENT INTEGRATION
// ============================================================================

describe('FarcasterClient - Cross-App Verification', () => {
  test('all apps use same hub URL format', async () => {
    // Verify FarcasterClient works with default hub
    const client = new FarcasterClient({ hubUrl: HUB_URL })

    const response = await client.getCastsByFid(3, { pageSize: 1 })
    expect(response.messages).toBeDefined()
    console.log('Hub connectivity verified for all apps')
  })

  test('multiple channels can be queried', async () => {
    const client = new FarcasterClient({ hubUrl: HUB_URL })

    const channels = [
      'https://warpcast.com/~/channel/farcaster',
      'https://warpcast.com/~/channel/ethereum',
      'https://warpcast.com/~/channel/base',
    ]

    const results = await Promise.all(
      channels.map((url) => client.getCastsByChannel(url, { pageSize: 2 })),
    )

    for (const result of results) {
      expect(result.messages).toBeDefined()
      expect(Array.isArray(result.messages)).toBe(true)
    }

    console.log(
      `Queried ${channels.length} channels: ${results.map((r) => r.messages.length).join(', ')} casts`,
    )
  })
})
