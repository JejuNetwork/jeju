import { NextRequest, NextResponse } from 'next/server';
import { getJejuTokens, getLatestBlocks, getTokenTransfers, getTokenHolders, getContractDetails } from '@/lib/indexer-client';
import { 
  createPaymentRequirement, 
  checkPayment, 
  PAYMENT_TIERS,
  type PaymentRequirements 
} from '@/lib/x402';
import {
  checkBanStatus,
  getModeratorStats,
  getModerationCases,
  getModerationCase,
  getModerationStats,
  prepareStakeTransaction,
  prepareReportTransaction,
  prepareVoteTransaction,
  prepareChallengeTransaction,
} from '@/lib/moderation-api';
import { Address } from 'viem';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Payment',
};

const PAYMENT_RECIPIENT = (process.env.NEXT_PUBLIC_BAZAAR_PAYMENT_RECIPIENT || 
  '0x0000000000000000000000000000000000000000') as Address;

interface A2ARequest {
  jsonrpc: string;
  method: string;
  params?: {
    message?: {
      messageId: string;
      parts: Array<{
        kind: string;
        text?: string;
        data?: Record<string, unknown>;
      }>;
    };
  };
  id: number | string;
}

interface A2AResponse {
  jsonrpc: string;
  id: number | string;
  result?: {
    role: string;
    parts: Array<{
      kind: string;
      text?: string;
      data?: Record<string, unknown>;
    }>;
    messageId: string;
    kind: string;
  };
  error?: {
    code: number;
    message: string;
    data?: PaymentRequirements;
  };
}

async function executeSkill(
  skillId: string, 
  params: Record<string, unknown>,
  paymentHeader: string | null
): Promise<{ 
  message: string; 
  data: Record<string, unknown>;
  requiresPayment?: PaymentRequirements;
}> {
  switch (skillId) {
    // ============ FREE TIER SKILLS ============
    
    case 'list-tokens': {
      const limit = (params.limit as number) || 50;
      const tokens = await getJejuTokens({ limit });
      return {
        message: `Found ${tokens.length} tokens on Jeju`,
        data: {
          tokens: tokens.map((t) => ({
            address: t.address,
            creator: t.creator.address,
            firstSeen: t.firstSeenAt,
            isERC20: t.isERC20,
          })),
        },
      };
    }

    case 'get-latest-blocks': {
      const limit = (params.limit as number) || 10;
      const blocks = await getLatestBlocks(limit);
      return {
        message: `Latest ${blocks.length} blocks`,
        data: {
          blocks: blocks.map((b) => ({
            number: b.number,
            hash: b.hash,
            timestamp: b.timestamp,
            txCount: b.transactionCount,
          })),
        },
      };
    }

    case 'list-games': {
      // Query ERC-8004 registry for registered games
      return {
        message: 'Game registry available',
        data: {
          games: [],
          note: 'Query IdentityRegistry for registered game agents',
        },
      };
    }

    // ============ PAID TIER SKILLS ============

    case 'get-token-details': {
      // Check payment
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.PREMIUM_API_DAILY / BigInt(100), // Small per-query fee
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.PREMIUM_API_DAILY / BigInt(100),
            'Token details query',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const address = params.address as string;
      if (!address) {
        throw new Error('Token address required');
      }

      const [details, holders, transfers] = await Promise.all([
        getContractDetails(address),
        getTokenHolders(address, 10),
        getTokenTransfers(address, 10),
      ]);

      return {
        message: `Details for token ${address}`,
        data: {
          contract: details,
          topHolders: holders.map(h => ({
            address: h.account.address,
            balance: h.balance,
          })),
          recentTransfers: transfers.map(t => ({
            from: t.from.address,
            to: t.to.address,
            amount: t.value,
            timestamp: t.timestamp,
            txHash: t.transaction.hash,
          })),
        },
      };
    }

    case 'create-token': {
      // Check payment for token deployment
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.TOKEN_DEPLOYMENT,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.TOKEN_DEPLOYMENT,
            'Token deployment fee',
            PAYMENT_RECIPIENT
          ),
        };
      }

      // Generate actual token deployment bytecode
      const tokenName = params.name as string || 'New Token';
      const tokenSymbol = params.symbol as string || 'TKN';
      const totalSupply = params.supply as string || '1000000';

      return {
        message: 'Token deployment transaction prepared',
        data: {
          action: 'deploy-contract',
          contractType: 'ERC20',
          parameters: {
            name: tokenName,
            symbol: tokenSymbol,
            initialSupply: totalSupply,
          },
          // In production: return actual bytecode for deployment
          bytecode: '0x...', // Would be actual ERC20 bytecode
          estimatedGas: '2000000',
          fee: PAYMENT_TIERS.TOKEN_DEPLOYMENT.toString(),
          instructions: 'Sign and broadcast this transaction to deploy your token',
        },
      };
    }

    case 'swap-tokens': {
      // Check swap fee payment
      const swapAmount = BigInt((params.amount as string) || '0');
      const swapFee = (swapAmount * BigInt(PAYMENT_TIERS.SWAP_FEE)) / BigInt(10000);
      
      const paymentCheck = await checkPayment(
        paymentHeader,
        swapFee,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            swapFee,
            'Token swap fee (0.3%)',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const fromToken = params.fromToken as string;
      const toToken = params.toToken as string;
      const amountIn = params.amount as string;

      // Import contracts config
      const { getV4Contracts } = await import('@/config/contracts');
      const { JEJU_CHAIN_ID } = await import('@/config/chains');
      
      const v4Contracts = getV4Contracts(JEJU_CHAIN_ID);

      return {
        message: 'Swap transaction prepared',
        data: {
          action: 'contract-call',
          contract: v4Contracts.swapRouter || v4Contracts.poolManager,
          function: 'swap',
          parameters: {
            tokenIn: fromToken,
            tokenOut: toToken,
            amountIn,
            amountOutMinimum: '0', // Would calculate from quoter
            recipient: params.recipient || '{{USER_ADDRESS}}',
            deadline: Math.floor(Date.now() / 1000) + 600, // 10 min deadline
          },
          fee: swapFee.toString(),
          estimatedGas: '300000',
          calldata: '0x...', // Would encode actual swap calldata
          instructions: 'Sign and execute this swap transaction',
        },
      };
    }

    case 'create-pool': {
      // Check pool creation payment
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.POOL_CREATION,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.POOL_CREATION,
            'Liquidity pool creation fee',
            PAYMENT_RECIPIENT
          ),
        };
      }

      return {
        message: 'Pool creation authorized',
        data: {
          token0: params.token0,
          token1: params.token1,
          fee: PAYMENT_TIERS.POOL_CREATION.toString(),
          instructions: 'Initialize pool via /pools page',
        },
      };
    }

    case 'add-liquidity': {
      // Check liquidity addition fee
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.LIQUIDITY_ADD,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.LIQUIDITY_ADD,
            'Liquidity addition fee',
            PAYMENT_RECIPIENT
          ),
        };
      }

      return {
        message: 'Liquidity addition prepared',
        data: {
          poolId: params.poolId,
          amount0: params.amount0,
          amount1: params.amount1,
          instructions: 'Add liquidity via /liquidity page',
        },
      };
    }

    case 'remove-liquidity': {
      // Free to remove liquidity
      return {
        message: 'Liquidity removal prepared',
        data: {
          poolId: params.poolId,
          instructions: 'Remove liquidity via /liquidity page',
        },
      };
    }

    case 'get-pool-info': {
      return {
        message: 'Pool information available',
        data: {
          pools: [],
          note: 'Query Uniswap V4 PoolManager for pool data',
          instructions: 'View pools at /pools',
        },
      };
    }

    case 'list-nfts': {
      return {
        message: 'NFT marketplace',
        data: {
          nfts: [],
          note: 'NFT indexing coming soon',
          instructions: 'Browse NFTs at /nfts',
        },
      };
    }

    case 'get-nft-details': {
      return {
        message: 'NFT details',
        data: {
          tokenId: params.tokenId,
          collection: params.collection,
          note: 'NFT metadata coming soon',
        },
      };
    }

    case 'list-nft': {
      // Check NFT listing fee
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.NFT_LISTING,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.NFT_LISTING,
            'NFT listing fee',
            PAYMENT_RECIPIENT
          ),
        };
      }

      return {
        message: 'NFT listing created',
        data: {
          tokenId: params.tokenId,
          price: params.price,
          fee: PAYMENT_TIERS.NFT_LISTING.toString(),
          instructions: 'List NFT via /my-nfts page',
        },
      };
    }

    case 'buy-nft': {
      // Calculate purchase fee (2.5% of price)
      const nftPrice = BigInt((params.price as string) || '0');
      const purchaseFee = (nftPrice * BigInt(PAYMENT_TIERS.NFT_PURCHASE_FEE)) / BigInt(10000);
      
      const paymentCheck = await checkPayment(
        paymentHeader,
        purchaseFee,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            purchaseFee,
            'NFT purchase fee (2.5%)',
            PAYMENT_RECIPIENT
          ),
        };
      }

      return {
        message: 'NFT purchase prepared',
        data: {
          tokenId: params.tokenId,
          price: params.price,
          fee: purchaseFee.toString(),
          instructions: 'Complete purchase via /nfts page',
        },
      };
    }

    case 'get-my-nfts': {
      const ownerAddress = params.address as string;
      return {
        message: `NFTs owned by ${ownerAddress}`,
        data: {
          nfts: [],
          note: 'NFT ownership data coming soon',
          instructions: 'View your NFTs at /my-nfts',
        },
      };
    }

    // ============ MODERATION MARKETPLACE SKILLS ============

    case 'check-ban-status': {
      const address = params.address as string;
      if (!address) throw new Error('Address required');
      
      const status = await checkBanStatus(address);
      return {
        message: status.isBanned 
          ? `Address ${address.slice(0, 10)}... is ${status.isOnNotice ? 'on notice' : 'banned'}`
          : `Address ${address.slice(0, 10)}... is not banned`,
        data: { ...status } as Record<string, unknown>,
      };
    }

    case 'get-moderator-stats': {
      const address = params.address as string;
      if (!address) throw new Error('Address required');
      
      const stats = await getModeratorStats(address);
      if (!stats) {
        return {
          message: `No moderator data for ${address.slice(0, 10)}...`,
          data: { address, isStaked: false },
        };
      }
      return {
        message: `${stats.tier} tier moderator with ${stats.winRate}% win rate`,
        data: stats as unknown as Record<string, unknown>,
      };
    }

    case 'get-moderation-cases': {
      const cases = await getModerationCases({
        activeOnly: params.activeOnly as boolean,
        resolvedOnly: params.resolvedOnly as boolean,
        limit: params.limit as number || 20,
      });
      return {
        message: `Found ${cases.length} moderation cases`,
        data: { cases, count: cases.length },
      };
    }

    case 'get-moderation-case': {
      const caseId = params.caseId as string;
      if (!caseId) throw new Error('Case ID required');
      
      const caseData = await getModerationCase(caseId);
      if (!caseData) throw new Error('Case not found');
      
      return {
        message: `Case ${caseData.status}: ${caseData.target.slice(0, 10)}... reported for ${caseData.reason.slice(0, 50)}`,
        data: caseData as unknown as Record<string, unknown>,
      };
    }

    case 'get-moderation-stats': {
      const stats = await getModerationStats();
      return {
        message: `${stats.totalCases} total cases, ${stats.totalStaked} ETH staked`,
        data: stats as unknown as Record<string, unknown>,
      };
    }

    case 'prepare-stake': {
      const amount = params.amount as string;
      if (!amount) throw new Error('Amount required');
      
      const tx = prepareStakeTransaction(amount);
      return {
        message: `Prepared transaction to stake ${amount} ETH`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          note: 'Wait 24h after staking before voting power activates',
        },
      };
    }

    case 'prepare-report': {
      const target = params.target as string;
      const reason = params.reason as string;
      const evidenceHash = params.evidenceHash as string;
      
      if (!target || !reason || !evidenceHash) {
        throw new Error('target, reason, and evidenceHash required');
      }
      
      const tx = prepareReportTransaction(target, reason, evidenceHash);
      return {
        message: `Prepared report against ${target.slice(0, 10)}...`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          warning: 'Your stake is at risk if the community votes to clear',
        },
      };
    }

    case 'prepare-vote': {
      const caseId = params.caseId as string;
      const voteYes = params.voteYes as boolean;
      
      if (!caseId || voteYes === undefined) {
        throw new Error('caseId and voteYes required');
      }
      
      const tx = prepareVoteTransaction(caseId, voteYes);
      return {
        message: `Prepared vote ${voteYes ? 'BAN' : 'CLEAR'} for case ${caseId.slice(0, 10)}...`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
        },
      };
    }

    case 'prepare-challenge': {
      const caseId = params.caseId as string;
      const stakeAmount = params.stakeAmount as string;
      
      if (!caseId || !stakeAmount) {
        throw new Error('caseId and stakeAmount required');
      }
      
      const tx = prepareChallengeTransaction(caseId, stakeAmount);
      return {
        message: `Prepared challenge for case ${caseId.slice(0, 10)}...`,
        data: {
          action: 'sign-and-send',
          transaction: tx,
          warning: 'Challenge stake at risk if ban upheld',
        },
      };
    }

    default:
      throw new Error('Unknown skill');
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { headers: CORS_HEADERS });
}

export async function POST(request: NextRequest): Promise<NextResponse<A2AResponse>> {
  const body: A2ARequest = await request.json();
  const paymentHeader = request.headers.get('X-Payment');

  if (body.method !== 'message/send') {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    }, { headers: CORS_HEADERS });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' },
    }, { headers: CORS_HEADERS });
  }

  const dataPart = message.parts.find((p) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    }, { headers: CORS_HEADERS });
  }

  const skillId = dataPart.data.skillId as string;
  const params = (dataPart.data.params as Record<string, unknown>) || {};

  if (!skillId) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    }, { headers: CORS_HEADERS });
  }

  try {
    const result = await executeSkill(skillId, params, paymentHeader);

    // Check if payment required
    if (result.requiresPayment) {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: 402,
          message: 'Payment Required',
          data: result.requiresPayment,
        },
      }, { 
        status: 402,
        headers: CORS_HEADERS 
      });
    }

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
    }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({
      jsonrpc: '2.0',
      id: body.id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : 'Internal error',
      },
    }, { headers: CORS_HEADERS });
  }
}
