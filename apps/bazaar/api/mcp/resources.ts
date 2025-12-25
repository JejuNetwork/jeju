/**
 * MCP Resources business logic
 * Shared between API routes and hooks
 */

import { expect } from '@jejunetwork/types'
import { getLatestBlocks, getNetworkTokens } from '../indexer-client'

export async function readMCPResource(uri: string): Promise<unknown | null> {
  expect(uri, 'URI is required')

  switch (uri) {
    case 'bazaar://tokens': {
      const tokens = await getNetworkTokens({ limit: 50 })
      return {
        tokens: tokens.map((t) => ({
          address: t.address,
          creator: t.creator.address,
          isERC20: t.isERC20,
        })),
      }
    }

    case 'bazaar://blocks': {
      const blocks = await getLatestBlocks(10)
      return {
        blocks: blocks.map((b) => ({
          number: b.number,
          hash: b.hash,
          timestamp: b.timestamp,
        })),
      }
    }

    case 'bazaar://pools':
      return { pools: [], note: 'Query Uniswap V4 for pool data' }

    case 'bazaar://nfts':
      return { nfts: [], note: 'Query indexer for NFT data' }

    default:
      return null
  }
}
