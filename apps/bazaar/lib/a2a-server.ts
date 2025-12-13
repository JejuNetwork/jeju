/**
 * Bazaar A2A Server
 * 
 * Agent-to-agent interface for the Jeju Bazaar marketplace.
 * Supports token launches, ICO participation, and marketplace operations.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

// ============================================================================
// Types
// ============================================================================

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{ kind: string; text?: string; data?: Record<string, unknown> }>;
    };
  };
  id: number | string;
}

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

// ============================================================================
// Agent Card
// ============================================================================

export const BAZAAR_AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju Bazaar',
  description: 'Decentralized marketplace for token launches, ICOs, and NFT trading',
  url: '/api/a2a',
  preferredTransport: 'http',
  provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
  version: '1.0.0',
  capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
  defaultInputModes: ['text', 'data'],
  defaultOutputModes: ['text', 'data'],
  skills: [
    // Token Launch Skills
    { id: 'list-launches', name: 'List Token Launches', description: 'Get all active and upcoming token launches', tags: ['query', 'launches'] },
    { id: 'get-launch', name: 'Get Launch Details', description: 'Get details of a specific token launch', tags: ['query', 'launch'] },
    { id: 'get-launch-stats', name: 'Get Launch Statistics', description: 'Get participation statistics for a launch', tags: ['query', 'stats'] },
    { id: 'prepare-participate', name: 'Prepare Participation', description: 'Prepare transaction for participating in a launch', tags: ['action', 'participate'] },
    { id: 'check-eligibility', name: 'Check Eligibility', description: 'Check if an address is eligible to participate', tags: ['query', 'eligibility'] },
    
    // ICO Skills
    { id: 'get-ico-tiers', name: 'Get ICO Tiers', description: 'Get available ICO participation tiers', tags: ['query', 'ico'] },
    { id: 'get-ico-allocation', name: 'Get ICO Allocation', description: 'Get allocation for an address in an ICO', tags: ['query', 'allocation'] },
    { id: 'prepare-ico-commit', name: 'Prepare ICO Commit', description: 'Prepare transaction to commit to an ICO tier', tags: ['action', 'ico'] },
    { id: 'prepare-ico-claim', name: 'Prepare ICO Claim', description: 'Prepare transaction to claim ICO tokens', tags: ['action', 'claim'] },
    
    // NFT Marketplace Skills
    { id: 'list-collections', name: 'List NFT Collections', description: 'Get all NFT collections on the marketplace', tags: ['query', 'nft'] },
    { id: 'get-collection', name: 'Get Collection Details', description: 'Get details of an NFT collection', tags: ['query', 'collection'] },
    { id: 'list-nfts', name: 'List NFTs', description: 'List NFTs in a collection or by owner', tags: ['query', 'nft'] },
    { id: 'get-nft', name: 'Get NFT Details', description: 'Get details of a specific NFT', tags: ['query', 'nft'] },
    { id: 'prepare-list-nft', name: 'Prepare NFT Listing', description: 'Prepare transaction to list an NFT for sale', tags: ['action', 'list'] },
    { id: 'prepare-buy-nft', name: 'Prepare NFT Purchase', description: 'Prepare transaction to buy an NFT', tags: ['action', 'buy'] },
    
    // Token Swap Skills
    { id: 'get-swap-quote', name: 'Get Swap Quote', description: 'Get quote for token swap', tags: ['query', 'swap'] },
    { id: 'prepare-swap', name: 'Prepare Swap', description: 'Prepare transaction for token swap', tags: ['action', 'swap'] },
    
    // Portfolio Skills
    { id: 'get-portfolio', name: 'Get Portfolio', description: 'Get portfolio holdings for an address', tags: ['query', 'portfolio'] },
    { id: 'get-activity', name: 'Get Activity', description: 'Get transaction activity for an address', tags: ['query', 'activity'] },
    
    // Analytics Skills
    { id: 'get-market-stats', name: 'Get Market Stats', description: 'Get overall marketplace statistics', tags: ['query', 'stats'] },
    { id: 'get-trending', name: 'Get Trending', description: 'Get trending tokens and collections', tags: ['query', 'trending'] },
  ],
};

// ============================================================================
// Skill Execution
// ============================================================================

async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
  switch (skillId) {
    // Token Launch Skills
    case 'list-launches': {
      return {
        message: 'Active token launches available',
        data: {
          launches: [
            {
              id: 'jeju-main',
              name: 'JEJU Token',
              symbol: 'JEJU',
              status: 'active',
              raised: '2500000',
              target: '5000000',
              participants: 1250,
              endsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            },
          ],
        },
      };
    }

    case 'get-launch': {
      const launchId = params.launchId as string;
      if (!launchId) {
        return { message: 'Launch ID required', data: { error: 'Missing launchId' } };
      }
      return {
        message: `Launch details for ${launchId}`,
        data: {
          id: launchId,
          name: 'JEJU Token',
          symbol: 'JEJU',
          description: 'Governance and utility token for the Jeju Network',
          totalSupply: '100000000',
          price: '0.05',
          currency: 'USDC',
          minContribution: '10',
          maxContribution: '10000',
          vestingPeriod: '12 months',
          cliffPeriod: '3 months',
        },
      };
    }

    case 'get-launch-stats': {
      const launchId = params.launchId as string;
      return {
        message: `Statistics for launch ${launchId}`,
        data: {
          totalRaised: '2500000',
          participants: 1250,
          averageContribution: '2000',
          largestContribution: '10000',
          timeRemaining: 604800,
          percentComplete: 50,
        },
      };
    }

    case 'prepare-participate': {
      const { launchId, amount, address } = params as { launchId: string; amount: string; address: string };
      if (!launchId || !amount || !address) {
        return { message: 'Missing parameters', data: { error: 'launchId, amount, and address required' } };
      }
      return {
        message: `Prepare participation in ${launchId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: process.env.NEXT_PUBLIC_LAUNCH_CONTRACT,
            data: `0x...`, // Would be actual calldata
            value: '0',
          },
          approvalRequired: true,
          approvalToken: process.env.NEXT_PUBLIC_USDC_ADDRESS,
          approvalAmount: amount,
        },
      };
    }

    case 'check-eligibility': {
      const address = params.address as string;
      return {
        message: `Eligibility for ${address}`,
        data: {
          eligible: true,
          tier: 'standard',
          maxAllocation: '10000',
          kycRequired: false,
          reasons: [],
        },
      };
    }

    // ICO Skills
    case 'get-ico-tiers': {
      return {
        message: 'Available ICO tiers',
        data: {
          tiers: [
            { name: 'Community', minCommit: '10', maxCommit: '1000', discount: 0, vestingMonths: 12 },
            { name: 'Supporter', minCommit: '1000', maxCommit: '5000', discount: 5, vestingMonths: 12 },
            { name: 'Backer', minCommit: '5000', maxCommit: '25000', discount: 10, vestingMonths: 12 },
            { name: 'Builder', minCommit: '25000', maxCommit: '100000', discount: 15, vestingMonths: 12 },
          ],
        },
      };
    }

    case 'get-ico-allocation': {
      const address = params.address as string;
      return {
        message: `Allocation for ${address}`,
        data: {
          committed: '5000',
          tier: 'Supporter',
          tokens: '105000',
          claimable: '0',
          claimed: '0',
          nextVestingDate: null,
        },
      };
    }

    // NFT Skills
    case 'list-collections': {
      return {
        message: 'NFT collections on Bazaar',
        data: {
          collections: [
            { id: 'jeju-genesis', name: 'Jeju Genesis', items: 10000, floorPrice: '0.1' },
            { id: 'jeju-agents', name: 'Jeju Agents', items: 5000, floorPrice: '0.5' },
          ],
        },
      };
    }

    case 'get-collection': {
      const collectionId = params.collectionId as string;
      return {
        message: `Collection ${collectionId} details`,
        data: {
          id: collectionId,
          name: 'Jeju Genesis',
          description: 'Genesis NFT collection for early supporters',
          totalItems: 10000,
          owners: 3500,
          floorPrice: '0.1',
          volume24h: '150',
          volumeTotal: '5000',
        },
      };
    }

    case 'list-nfts': {
      const { collectionId, owner, limit } = params as { collectionId?: string; owner?: string; limit?: number };
      return {
        message: 'NFT listings',
        data: {
          nfts: [
            { id: '1', name: 'Genesis #1', price: '0.15', owner: '0x...', listed: true },
            { id: '2', name: 'Genesis #2', price: '0.12', owner: '0x...', listed: true },
          ],
          total: 500,
          hasMore: true,
        },
      };
    }

    case 'prepare-buy-nft': {
      const { nftId, price } = params as { nftId: string; price: string };
      return {
        message: `Prepare purchase of NFT ${nftId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT,
            data: `0x...`,
            value: price,
          },
        },
      };
    }

    // Swap Skills
    case 'get-swap-quote': {
      const { tokenIn, tokenOut, amountIn } = params as { tokenIn: string; tokenOut: string; amountIn: string };
      return {
        message: `Swap quote: ${amountIn} ${tokenIn} to ${tokenOut}`,
        data: {
          amountIn,
          amountOut: '100.5',
          priceImpact: 0.5,
          route: ['JEJU', 'WETH', tokenOut],
          estimatedGas: '150000',
        },
      };
    }

    case 'prepare-swap': {
      const { tokenIn, tokenOut, amountIn, slippage } = params as { tokenIn: string; tokenOut: string; amountIn: string; slippage?: number };
      return {
        message: 'Prepare swap transaction',
        data: {
          action: 'sign-and-send',
          transaction: {
            to: process.env.NEXT_PUBLIC_ROUTER_CONTRACT,
            data: `0x...`,
            value: tokenIn === 'ETH' ? amountIn : '0',
          },
          approvalRequired: tokenIn !== 'ETH',
        },
      };
    }

    // Portfolio Skills
    case 'get-portfolio': {
      const address = params.address as string;
      return {
        message: `Portfolio for ${address}`,
        data: {
          tokens: [
            { symbol: 'JEJU', balance: '10000', value: '500' },
            { symbol: 'ETH', balance: '2.5', value: '5000' },
          ],
          nfts: [
            { collection: 'Jeju Genesis', count: 3, floorValue: '0.3' },
          ],
          totalValue: '5500',
        },
      };
    }

    case 'get-activity': {
      const address = params.address as string;
      return {
        message: `Activity for ${address}`,
        data: {
          transactions: [
            { type: 'swap', token: 'JEJU', amount: '1000', timestamp: new Date().toISOString() },
            { type: 'buy_nft', collection: 'Genesis', id: '42', price: '0.1', timestamp: new Date().toISOString() },
          ],
        },
      };
    }

    // Analytics Skills
    case 'get-market-stats': {
      return {
        message: 'Market statistics',
        data: {
          totalVolume24h: '1500000',
          totalVolume7d: '8500000',
          activeUsers24h: 2500,
          launches: { active: 3, completed: 15, upcoming: 5 },
          nftVolume24h: '150000',
        },
      };
    }

    case 'get-trending': {
      return {
        message: 'Trending on Bazaar',
        data: {
          tokens: [
            { symbol: 'JEJU', change24h: 15.5 },
            { symbol: 'CLANKER', change24h: 8.2 },
          ],
          collections: [
            { name: 'Jeju Agents', volumeChange: 250 },
          ],
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found', availableSkills: BAZAAR_AGENT_CARD.skills.map(s => s.id) },
      };
  }
}

// ============================================================================
// Request Handlers
// ============================================================================

export async function handleA2ARequest(request: NextRequest): Promise<NextResponse> {
  const body = await request.json() as A2ARequest;

  if (body.method !== 'message/send') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    });
  }

  const message = body.params?.message;
  if (!message?.parts) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' },
    });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart?.data) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    });
  }

  const skillId = dataPart.data.skillId as string;
  const result = await executeSkill(skillId, dataPart.data);

  return NextResponse.json({
    jsonrpc: '2.0',
    id: body.id,
    result: {
      role: 'agent',
      parts: [
        { kind: 'text', text: result.message },
        { kind: 'data', data: result.data },
      ],
      messageId: message.messageId,
      kind: 'message',
    },
  });
}

export function handleAgentCard(): NextResponse {
  return NextResponse.json(BAZAAR_AGENT_CARD);
}

