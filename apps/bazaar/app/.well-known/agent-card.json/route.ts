/**
 * Agent Card endpoint for Bazaar
 * ERC-8004 / A2A service discovery
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const serverUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4006';

  const agentCard = {
    protocolVersion: '0.3.0',
    name: 'Bazaar - Jeju DeFi + NFT Marketplace',
    description: 'Unified token launchpad, Uniswap V4 swaps, liquidity pools, and NFT marketplace on Jeju L3',
    url: `${serverUrl}/api/a2a`,
    preferredTransport: 'http',
    provider: {
      organization: 'Jeju Network',
      url: 'https://jeju.network',
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'list-tokens',
        name: 'List Tokens',
        description: 'Get all ERC20 tokens listed on Bazaar',
        tags: ['query', 'tokens', 'defi'],
        examples: ['Show me tokens', 'List all tokens', 'What tokens are available?'],
      },
      {
        id: 'get-latest-blocks',
        name: 'Get Latest Blocks',
        description: 'Get recent blockchain blocks from Jeju',
        tags: ['query', 'blockchain'],
        examples: ['Show latest blocks', 'Recent blockchain activity'],
      },
      {
        id: 'list-nfts',
        name: 'List NFTs',
        description: 'Browse NFTs in the marketplace',
        tags: ['query', 'nft', 'marketplace'],
        examples: ['Show NFTs', 'List NFTs', 'Browse marketplace'],
      },
      {
        id: 'get-pool-info',
        name: 'Get Pool Information',
        description: 'Get Uniswap V4 pool statistics and liquidity info',
        tags: ['query', 'defi', 'liquidity'],
        examples: ['Show liquidity pools', 'Pool stats', 'Get pool info'],
      },
    ],
  };

  return NextResponse.json(agentCard);
}


