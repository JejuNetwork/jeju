import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { A2ARequest as A2ARequestType } from '@/schemas/api';
import { expect } from '@/lib/validation';
import { NETWORK_NAME } from '@/config';

// Client-safe A2A helpers (avoiding @jejunetwork/shared which uses fs)
function getServiceName(service: string): string {
  return `${NETWORK_NAME} ${service}`;
}

function createAgentCard(options: {
  name: string;
  description: string;
  url?: string;
  version?: string;
  skills?: Array<{ id: string; name: string; description: string; tags?: string[] }>;
}) {
  return {
    protocolVersion: '0.3.0',
    name: `${NETWORK_NAME} ${options.name}`,
    description: options.description,
    url: options.url || '/api/a2a',
    preferredTransport: 'http',
    provider: {
      organization: NETWORK_NAME,
      url: 'https://jejunetwork.org',
    },
    version: options.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: options.skills || [],
  };
}

// Using A2ARequestType from schemas instead of local interface

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
}

const BAZAAR_SKILLS = [
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
    
    // TFMM / Smart Pool Skills
    { id: 'list-tfmm-pools', name: 'List Smart Pools', description: 'Get all TFMM auto-rebalancing pools', tags: ['query', 'tfmm', 'pools'] },
    { id: 'get-tfmm-pool', name: 'Get Smart Pool Details', description: 'Get details of a specific TFMM pool', tags: ['query', 'tfmm'] },
    { id: 'get-tfmm-strategies', name: 'Get TFMM Strategies', description: 'Get available rebalancing strategies', tags: ['query', 'tfmm', 'strategies'] },
    { id: 'get-tfmm-oracles', name: 'Get Oracle Status', description: 'Get status of price oracles (Pyth, Chainlink, TWAP)', tags: ['query', 'tfmm', 'oracles'] },
    { id: 'prepare-tfmm-deposit', name: 'Prepare Smart Pool Deposit', description: 'Prepare transaction to deposit into a TFMM pool', tags: ['action', 'tfmm', 'deposit'] },
    { id: 'prepare-tfmm-withdraw', name: 'Prepare Smart Pool Withdraw', description: 'Prepare transaction to withdraw from a TFMM pool', tags: ['action', 'tfmm', 'withdraw'] },
    { id: 'get-tfmm-performance', name: 'Get Pool Performance', description: 'Get historical performance metrics for a TFMM pool', tags: ['query', 'tfmm', 'performance'] },
    
    // Perpetuals Skills
    { id: 'list-perp-markets', name: 'List Perp Markets', description: 'Get all perpetual futures markets', tags: ['query', 'perps'] },
    { id: 'get-perp-market', name: 'Get Perp Market', description: 'Get details of a perpetual market', tags: ['query', 'perps'] },
    { id: 'get-perp-position', name: 'Get Position', description: 'Get details of a perpetual position', tags: ['query', 'perps', 'position'] },
    { id: 'prepare-perp-open', name: 'Prepare Open Position', description: 'Prepare transaction to open a perpetual position', tags: ['action', 'perps'] },
    { id: 'prepare-perp-close', name: 'Prepare Close Position', description: 'Prepare transaction to close a perpetual position', tags: ['action', 'perps'] },
    { id: 'get-perp-funding', name: 'Get Funding Rate', description: 'Get current funding rate for a market', tags: ['query', 'perps', 'funding'] },
    
    // Charts & Analytics
    { id: 'get-token-chart', name: 'Get Token Chart', description: 'Get price chart data for a token', tags: ['query', 'charts'] },
    { id: 'get-top-tokens', name: 'Get Top Tokens', description: 'Get top tokens by volume or market cap', tags: ['query', 'analytics'] },
];

export const BAZAAR_AGENT_CARD = createAgentCard({
  name: 'Bazaar',
  description: 'Decentralized marketplace for token launches, ICOs, and NFT trading',
  skills: BAZAAR_SKILLS,
});

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
      const launchId = expect(params.launchId as string | undefined, 'Launch ID required');
      return {
        message: `Launch details for ${launchId}`,
        data: {
          id: launchId,
          name: 'JEJU Token',
          symbol: 'JEJU',
          description: 'Governance and utility token for the Network',
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
      expect(launchId, 'launchId is required');
      expect(amount, 'amount is required');
      expect(address, 'address is required');
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
            { collection: 'Genesis', count: 3, floorValue: '0.3' },
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

    // TFMM / Smart Pool Skills
    case 'list-tfmm-pools': {
      return {
        message: 'Available TFMM Smart Pools',
        data: {
          pools: [
            {
              address: '0x1234...5678',
              name: 'Momentum ETH/BTC',
              strategy: 'momentum',
              tokens: ['ETH', 'BTC'],
              tvl: '2400000',
              apy: 12.5,
              volume24h: '890000',
            },
            {
              address: '0x2345...6789',
              name: 'Mean Reversion Stables',
              strategy: 'mean_reversion',
              tokens: ['USDC', 'USDT', 'DAI'],
              tvl: '1200000',
              apy: 8.2,
              volume24h: '450000',
            },
          ],
          totalTvl: '4180000',
          totalPools: 3,
        },
      };
    }

    case 'get-tfmm-pool': {
      const poolAddress = params.poolAddress as string;
      return {
        message: `Smart Pool details for ${poolAddress}`,
        data: {
          address: poolAddress,
          name: 'Momentum ETH/BTC',
          strategy: 'momentum',
          tokens: [
            { symbol: 'ETH', weight: 60, targetWeight: 65 },
            { symbol: 'BTC', weight: 40, targetWeight: 35 },
          ],
          tvl: '2400000',
          apy: 12.5,
          volume24h: '890000',
          performance: {
            return7d: 3.2,
            return30d: 8.5,
            sharpe: 1.8,
            maxDrawdown: -12.3,
          },
        },
      };
    }

    case 'get-tfmm-strategies': {
      return {
        message: 'Available TFMM strategies',
        data: {
          strategies: [
            {
              type: 'momentum',
              name: 'Momentum',
              description: 'Allocates more to assets with positive price momentum',
              performance: { return30d: 8.5, sharpe: 1.8 },
            },
            {
              type: 'mean_reversion',
              name: 'Mean Reversion',
              description: 'Rebalances when assets deviate from historical averages',
              performance: { return30d: 5.2, sharpe: 2.1 },
            },
            {
              type: 'trend_following',
              name: 'Trend Following',
              description: 'Follows medium-term price trends using moving averages',
              performance: { return30d: 12.1, sharpe: 1.5 },
            },
          ],
        },
      };
    }

    case 'get-tfmm-oracles': {
      return {
        message: 'Oracle status (Pyth > Chainlink > TWAP)',
        data: {
          priority: ['pyth', 'chainlink', 'twap'],
          tokens: {
            ETH: { source: 'pyth', price: '3450.00', lastUpdate: Date.now() - 5000, healthy: true },
            BTC: { source: 'pyth', price: '97500.00', lastUpdate: Date.now() - 3000, healthy: true },
            USDC: { source: 'chainlink', price: '1.00', lastUpdate: Date.now() - 10000, healthy: true },
          },
        },
      };
    }

    case 'prepare-tfmm-deposit': {
      const { poolAddress, amounts } = params as { poolAddress: string; amounts: Record<string, string> };
      return {
        message: `Prepare deposit to Smart Pool ${poolAddress}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: poolAddress,
            data: '0x...',
            value: '0',
          },
          approvalRequired: true,
          estimatedShares: '1000.00',
        },
      };
    }

    case 'prepare-tfmm-withdraw': {
      const { poolAddress, shares } = params as { poolAddress: string; shares: string };
      return {
        message: `Prepare withdrawal from Smart Pool ${poolAddress}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: poolAddress,
            data: '0x...',
            value: '0',
          },
          estimatedAmounts: { ETH: '0.5', BTC: '0.008' },
        },
      };
    }

    case 'get-tfmm-performance': {
      const poolAddress = params.poolAddress as string;
      return {
        message: `Performance metrics for ${poolAddress}`,
        data: {
          returns: {
            '1d': 0.5,
            '7d': 3.2,
            '30d': 8.5,
            '90d': 22.1,
          },
          risk: {
            sharpe: 1.8,
            sortino: 2.1,
            maxDrawdown: -12.3,
            volatility: 15.2,
          },
          rebalances: {
            count30d: 12,
            avgGas: '0.002',
            lastRebalance: Date.now() - 86400000,
          },
        },
      };
    }

    // Perpetuals Skills
    case 'list-perp-markets': {
      return {
        message: 'Available perpetual markets',
        data: {
          markets: [
            {
              marketId: 'BTC-PERP',
              symbol: 'BTC-PERP',
              markPrice: '97500.00',
              fundingRate: 0.01,
              openInterest: '25400000',
              maxLeverage: 50,
            },
            {
              marketId: 'ETH-PERP',
              symbol: 'ETH-PERP',
              markPrice: '3450.00',
              fundingRate: 0.0085,
              openInterest: '12300000',
              maxLeverage: 50,
            },
          ],
        },
      };
    }

    case 'get-perp-market': {
      const marketId = params.marketId as string;
      return {
        message: `Market details for ${marketId}`,
        data: {
          marketId,
          symbol: marketId,
          markPrice: '97500.00',
          indexPrice: '97480.00',
          fundingRate: 0.01,
          nextFunding: Date.now() + 1800000,
          openInterest: { long: '15000000', short: '10400000' },
          volume24h: '125000000',
          takerFee: 0.0005,
          makerFee: 0.0002,
        },
      };
    }

    case 'get-perp-position': {
      const { positionId, address } = params as { positionId?: string; address?: string };
      return {
        message: 'Position details',
        data: {
          positionId: positionId || '0x...',
          market: 'BTC-PERP',
          side: 'long',
          size: '0.5',
          entryPrice: '96500.00',
          markPrice: '97500.00',
          margin: '1000.00',
          leverage: 48.25,
          unrealizedPnl: '500.00',
          liquidationPrice: '94520.00',
        },
      };
    }

    case 'prepare-perp-open': {
      const { marketId, side, size, leverage, margin } = params as { marketId: string; side: string; size: string; leverage: number; margin: string };
      return {
        message: `Prepare ${side} position on ${marketId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: process.env.NEXT_PUBLIC_PERP_MARKET,
            data: '0x...',
            value: '0',
          },
          approvalRequired: true,
          estimatedEntry: '97500.00',
          estimatedLiquidation: side === 'long' ? '95000.00' : '100000.00',
        },
      };
    }

    case 'prepare-perp-close': {
      const positionId = params.positionId as string;
      return {
        message: `Prepare close position ${positionId}`,
        data: {
          action: 'sign-and-send',
          transaction: {
            to: process.env.NEXT_PUBLIC_PERP_MARKET,
            data: '0x...',
            value: '0',
          },
          estimatedPnl: '500.00',
          estimatedFee: '24.38',
        },
      };
    }

    case 'get-perp-funding': {
      const marketId = params.marketId as string;
      return {
        message: `Funding rate for ${marketId}`,
        data: {
          marketId,
          currentRate: 0.01,
          predictedRate: 0.012,
          nextFundingTime: Date.now() + 1800000,
          history: [
            { time: Date.now() - 3600000, rate: 0.008 },
            { time: Date.now() - 7200000, rate: 0.009 },
            { time: Date.now() - 10800000, rate: 0.007 },
          ],
        },
      };
    }

    // Charts & Analytics
    case 'get-token-chart': {
      const { tokenAddress, interval } = params as { tokenAddress: string; interval: string };
      return {
        message: `Chart data for ${tokenAddress}`,
        data: {
          token: tokenAddress,
          interval: interval || '1h',
          candles: [
            { time: Date.now() - 3600000, open: 100, high: 105, low: 98, close: 103, volume: '50000' },
            { time: Date.now() - 7200000, open: 98, high: 102, low: 96, close: 100, volume: '45000' },
          ],
          currentPrice: 103,
          change24h: 5.2,
        },
      };
    }

    case 'get-top-tokens': {
      const { sortBy, limit } = params as { sortBy?: string; limit?: number };
      return {
        message: 'Top tokens',
        data: {
          tokens: [
            { symbol: 'ETH', price: '3450.00', volume24h: '5000000000', change24h: 2.5 },
            { symbol: 'BTC', price: '97500.00', volume24h: '15000000000', change24h: 1.8 },
            { symbol: 'JEJU', price: '0.05', volume24h: '2500000', change24h: 15.5 },
          ],
          sortedBy: sortBy || 'volume',
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

export async function handleA2ARequest(request: NextRequest, validatedBody: A2ARequestType): Promise<NextResponse> {
  if (validatedBody.method !== 'message/send') {
    throw new Error(`Method not found: ${validatedBody.method}`);
  }

  const message = expect(validatedBody.params?.message, 'Message is required');
  const parts = expect(message.parts, 'Message parts are required');

  const dataPart = expect(
    parts.find((p) => p.kind === 'data'),
    'Data part is required'
  );
  const dataPartData = expect(dataPart.data, 'Data part data is required');

  const skillId = expect(dataPartData.skillId as string | undefined, 'skillId is required');
  const result = await executeSkill(skillId, dataPartData);

  return NextResponse.json({
    jsonrpc: '2.0',
    id: validatedBody.id,
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


