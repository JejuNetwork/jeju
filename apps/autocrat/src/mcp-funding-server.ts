/**
 * @module MCPFundingServer
 * @description MCP server for deep funding data and operations
 *
 * Provides tools and resources for AI agents to:
 * - Query contributor and dependency data
 * - Submit and review payment requests
 * - Participate in weight deliberation
 * - Claim rewards
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getDeepFundingService } from './deep-funding-service';
import { getContributorService } from './contributor-service';
import { getPaymentRequestService } from './payment-request-service';
import { getDependencyScanner } from './dependency-scanner';
import type { Address } from 'viem';

// ============ Tool Definitions ============

const FUNDING_TOOLS = [
  {
    name: 'get_dao_pool',
    description: 'Get the current funding pool status for a DAO including accumulated fees and distribution pools',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
      },
      required: ['daoId'],
    },
  },
  {
    name: 'get_current_epoch',
    description: 'Get the current funding epoch for a DAO with distribution status',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
      },
      required: ['daoId'],
    },
  },
  {
    name: 'get_contributor_profile',
    description: 'Get a contributor profile by ID or wallet address',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contributorId: { type: 'string', description: 'The contributor ID (optional if wallet provided)' },
        wallet: { type: 'string', description: 'The wallet address (optional if contributorId provided)' },
      },
    },
  },
  {
    name: 'get_contributor_rewards',
    description: 'Get pending rewards for a contributor in a DAO',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        contributorId: { type: 'string', description: 'The contributor ID' },
      },
      required: ['daoId', 'contributorId'],
    },
  },
  {
    name: 'scan_repository_dependencies',
    description: 'Scan a GitHub repository for dependencies and calculate funding weights',
    inputSchema: {
      type: 'object' as const,
      properties: {
        owner: { type: 'string', description: 'GitHub repository owner' },
        repo: { type: 'string', description: 'GitHub repository name' },
      },
      required: ['owner', 'repo'],
    },
  },
  {
    name: 'get_dependency_recommendations',
    description: 'Get funding weight recommendations for dependencies',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        owner: { type: 'string', description: 'GitHub repository owner' },
        repo: { type: 'string', description: 'GitHub repository name' },
      },
      required: ['daoId', 'owner', 'repo'],
    },
  },
  {
    name: 'get_contributor_recommendations',
    description: 'Get funding weight recommendations for contributors based on activity',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
      },
      required: ['daoId'],
    },
  },
  {
    name: 'vote_on_weight',
    description: 'Vote to adjust a contributor or dependency weight during deliberation',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        targetId: { type: 'string', description: 'Contributor or dependency ID' },
        adjustment: { type: 'number', description: 'Weight adjustment (positive or negative)' },
        reason: { type: 'string', description: 'Reason for the adjustment' },
        reputation: { type: 'number', description: 'Voter reputation weight' },
      },
      required: ['daoId', 'targetId', 'adjustment', 'reason', 'reputation'],
    },
  },
  {
    name: 'get_payment_requests',
    description: 'Get payment requests for a DAO',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        status: { type: 'string', description: 'Filter by status (optional)' },
      },
      required: ['daoId'],
    },
  },
  {
    name: 'review_payment_request',
    description: 'Review a payment request as council member or CEO',
    inputSchema: {
      type: 'object' as const,
      properties: {
        requestId: { type: 'string', description: 'The payment request ID' },
        action: {
          type: 'string',
          enum: ['approve', 'reject', 'abstain'],
          description: 'Review action',
        },
        reason: { type: 'string', description: 'Reason for the decision' },
        modifiedAmount: { type: 'number', description: 'Modified amount (for CEO only)' },
      },
      required: ['requestId', 'action', 'reason'],
    },
  },
  {
    name: 'get_epoch_votes',
    description: 'Get all deliberation votes for an epoch',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        epochId: { type: 'number', description: 'The epoch ID' },
      },
      required: ['daoId', 'epochId'],
    },
  },
  {
    name: 'get_fee_distribution_config',
    description: 'Get the fee distribution configuration for a DAO',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
      },
      required: ['daoId'],
    },
  },
];

// ============ Resource Definitions ============

const FUNDING_RESOURCES = [
  {
    uri: 'funding://daos/{daoId}/pool',
    name: 'DAO Funding Pool',
    description: 'Current funding pool status for a DAO',
    mimeType: 'application/json',
  },
  {
    uri: 'funding://daos/{daoId}/epoch',
    name: 'Current Epoch',
    description: 'Current funding epoch details',
    mimeType: 'application/json',
  },
  {
    uri: 'funding://daos/{daoId}/contributors',
    name: 'DAO Contributors',
    description: 'List of contributors with their shares',
    mimeType: 'application/json',
  },
  {
    uri: 'funding://daos/{daoId}/dependencies',
    name: 'DAO Dependencies',
    description: 'List of registered dependencies',
    mimeType: 'application/json',
  },
  {
    uri: 'funding://contributors/{contributorId}',
    name: 'Contributor Profile',
    description: 'Contributor profile and verification status',
    mimeType: 'application/json',
  },
  {
    uri: 'funding://daos/{daoId}/payment-requests',
    name: 'Payment Requests',
    description: 'Payment requests for a DAO',
    mimeType: 'application/json',
  },
];

// ============ Server Implementation ============

export class MCPFundingServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      { name: 'jeju-deep-funding', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: FUNDING_TOOLS,
    }));

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: FUNDING_RESOURCES,
    }));

    // Call tool
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      return this.handleToolCall(name, args as Record<string, unknown>);
    });

    // Read resource
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      return this.handleResourceRead(uri);
    });
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const fundingService = getDeepFundingService();
    const contributorService = getContributorService();
    const paymentService = getPaymentRequestService();

    switch (name) {
      case 'get_dao_pool': {
        const pool = await fundingService.getDAOPool(args.daoId as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(pool, null, 2) }],
        };
      }

      case 'get_current_epoch': {
        const epoch = await fundingService.getCurrentEpoch(args.daoId as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(epoch, null, 2) }],
        };
      }

      case 'get_contributor_profile': {
        let profile = null;
        if (args.contributorId) {
          profile = await contributorService.getContributor(args.contributorId as string);
        } else if (args.wallet) {
          profile = await contributorService.getContributorByWallet(args.wallet as Address);
        }
        return {
          content: [
            {
              type: 'text',
              text: profile ? JSON.stringify(profile, null, 2) : 'Contributor not found',
            },
          ],
        };
      }

      case 'get_contributor_rewards': {
        const rewards = await fundingService.getPendingContributorRewards(
          args.daoId as string,
          args.contributorId as string
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ pendingRewards: rewards.toString() }, null, 2),
            },
          ],
        };
      }

      case 'scan_repository_dependencies': {
        const scanner = getDependencyScanner();
        const result = await scanner.scanRepository(args.owner as string, args.repo as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      }

      case 'get_dependency_recommendations': {
        const recommendations = await fundingService.generateDependencyRecommendations(
          args.daoId as string,
          args.owner as string,
          args.repo as string
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(recommendations, null, 2) }],
        };
      }

      case 'get_contributor_recommendations': {
        const recommendations = await fundingService.generateContributorRecommendations(
          args.daoId as string
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(recommendations, null, 2) }],
        };
      }

      case 'vote_on_weight': {
        const hash = await fundingService.voteOnWeight(
          args.daoId as string,
          args.targetId as string,
          args.adjustment as number,
          args.reason as string,
          args.reputation as number
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ transactionHash: hash }, null, 2) }],
        };
      }

      case 'get_payment_requests': {
        const requests = await paymentService.getPendingRequests(args.daoId as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(requests, null, 2) }],
        };
      }

      case 'review_payment_request': {
        const action = args.action as string;
        let hash: string;

        if (action === 'approve' || action === 'reject' || action === 'abstain') {
          hash = await paymentService.councilVote(
            args.requestId as string,
            action.toUpperCase() as 'APPROVE' | 'REJECT' | 'ABSTAIN',
            args.reason as string
          );
        } else {
          throw new Error(`Unknown action: ${action}`);
        }

        return {
          content: [{ type: 'text', text: JSON.stringify({ transactionHash: hash }, null, 2) }],
        };
      }

      case 'get_epoch_votes': {
        const votes = await fundingService.getEpochVotes(
          args.daoId as string,
          args.epochId as number
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(votes, null, 2) }],
        };
      }

      case 'get_fee_distribution_config': {
        const config = await fundingService.getDAOConfig(args.daoId as string);
        return {
          content: [{ type: 'text', text: JSON.stringify(config, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private async handleResourceRead(
    uri: string
  ): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
    const fundingService = getDeepFundingService();
    const contributorService = getContributorService();
    const paymentService = getPaymentRequestService();

    // Parse URI
    const parts = uri.replace('funding://', '').split('/');

    if (parts[0] === 'daos' && parts.length >= 3) {
      const daoId = parts[1];
      const resource = parts[2];

      switch (resource) {
        case 'pool': {
          const pool = await fundingService.getDAOPool(daoId);
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(pool, null, 2) },
            ],
          };
        }

        case 'epoch': {
          const epoch = await fundingService.getCurrentEpoch(daoId);
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(epoch, null, 2) },
            ],
          };
        }

        case 'contributors': {
          const contributors = await contributorService.getAllContributors();
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ contributors }, null, 2),
              },
            ],
          };
        }

        case 'payment-requests': {
          const requests = await paymentService.getPendingRequests(daoId);
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(requests, null, 2) },
            ],
          };
        }
      }
    }

    if (parts[0] === 'contributors' && parts.length >= 2) {
      const contributorId = parts[1];
      const profile = await contributorService.getContributor(contributorId);
      const socialLinks = await contributorService.getSocialLinks(contributorId);
      const repoClaims = await contributorService.getRepositoryClaims(contributorId);
      const depClaims = await contributorService.getDependencyClaims(contributorId);

      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ profile, socialLinks, repoClaims, depClaims }, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('MCP Funding Server started');
  }
}

// Start server if run directly
if (import.meta.main) {
  const server = new MCPFundingServer();
  server.start();
}

