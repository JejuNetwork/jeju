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

import { getNumber, getOptionalString, getString } from '@jejunetwork/types'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  type CallToolRequest,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  type ReadResourceRequest,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { isAddress } from 'viem'
import { fundingApi } from './funding-api'

const FUNDING_TOOLS = [
  {
    name: 'get_dao_pool',
    description:
      'Get the current funding pool status for a DAO including accumulated fees and distribution pools',
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
    description:
      'Get the current funding epoch for a DAO with distribution status',
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
        contributorId: {
          type: 'string',
          description: 'The contributor ID (optional if wallet provided)',
        },
        wallet: {
          type: 'string',
          description:
            'The wallet address (optional if contributorId provided)',
        },
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
    description:
      'Scan a GitHub repository for dependencies and calculate funding weights',
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
    description:
      'Get funding weight recommendations for contributors based on activity',
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
    description:
      'Vote to adjust a contributor or dependency weight during deliberation',
    inputSchema: {
      type: 'object' as const,
      properties: {
        daoId: { type: 'string', description: 'The DAO identifier' },
        targetId: {
          type: 'string',
          description: 'Contributor or dependency ID',
        },
        adjustment: {
          type: 'number',
          description: 'Weight adjustment (positive or negative)',
        },
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
        modifiedAmount: {
          type: 'number',
          description: 'Modified amount (for CEO only)',
        },
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
]
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
]
export class MCPFundingServer {
  private server: Server

  constructor() {
    this.server = new Server(
      { name: 'jeju-deep-funding', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } },
    )

    this.setupHandlers()
  }

  private setupHandlers(): void {
    // List tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: FUNDING_TOOLS,
    }))

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: FUNDING_RESOURCES,
    }))

    // Call tool
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request: CallToolRequest) => {
        const { name, arguments: args } = request.params
        return this.handleToolCall(name, args as Record<string, unknown>)
      },
    )

    // Read resource
    this.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request: ReadResourceRequest) => {
        const { uri } = request.params
        return this.handleResourceRead(uri)
      },
    )
  }

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: string; text: string }> }> {
    const jsonResponse = (data: unknown) => ({
      content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    })

    switch (name) {
      case 'get_dao_pool': {
        const daoId = getString(args, 'daoId')
        const result = await fundingApi.getDAOPool(daoId)
        return jsonResponse(result.data ?? result.error)
      }

      case 'get_current_epoch': {
        const daoId = getString(args, 'daoId')
        const result = await fundingApi.getCurrentEpoch(daoId)
        return jsonResponse(result.data ?? result.error)
      }

      case 'get_contributor_profile': {
        const contributorId = getOptionalString(args, 'contributorId')
        const walletStr = getOptionalString(args, 'wallet')
        if (contributorId) {
          const result = await fundingApi.getContributor(contributorId)
          return jsonResponse(result.data ?? result.error)
        } else if (walletStr && isAddress(walletStr)) {
          const result = await fundingApi.getContributorByWallet(walletStr)
          return jsonResponse(result.data ?? result.error)
        }
        return jsonResponse('Provide contributorId or valid wallet address')
      }

      case 'get_contributor_rewards': {
        const daoId = getString(args, 'daoId')
        const contributorId = getString(args, 'contributorId')
        const result = await fundingApi.getPendingContributorRewards(
          daoId,
          contributorId,
        )
        return jsonResponse({ pendingRewards: result.data?.toString() })
      }

      case 'scan_repository_dependencies': {
        const owner = getString(args, 'owner')
        const repo = getString(args, 'repo')
        const result = await fundingApi.scanRepository(owner, repo)
        return jsonResponse(result.data ?? result.error)
      }

      case 'get_dependency_recommendations': {
        const daoId = getString(args, 'daoId')
        const owner = getString(args, 'owner')
        const repo = getString(args, 'repo')
        const result = await fundingApi.generateDependencyRecommendations(
          daoId,
          owner,
          repo,
        )
        return jsonResponse(result.data ?? result.error)
      }

      case 'get_contributor_recommendations': {
        const daoId = getString(args, 'daoId')
        const result =
          await fundingApi.generateContributorRecommendations(daoId)
        return jsonResponse(result.data ?? result.error)
      }

      case 'vote_on_weight': {
        const daoId = getString(args, 'daoId')
        const targetId = getString(args, 'targetId')
        const adjustment = getNumber(args, 'adjustment')
        const reason = getString(args, 'reason')
        const reputation = getNumber(args, 'reputation')
        const result = await fundingApi.voteOnWeight(
          daoId,
          targetId,
          adjustment,
          reason,
          reputation,
        )
        if (!result.success) {
          return jsonResponse({ error: result.error })
        }
        return jsonResponse({ transactionHash: result.data })
      }

      case 'get_payment_requests': {
        const daoId = getString(args, 'daoId')
        const result = await fundingApi.getPendingPaymentRequests(daoId)
        return jsonResponse(result.data ?? result.error)
      }

      case 'review_payment_request': {
        const requestId = getString(args, 'requestId')
        const action = getString(args, 'action')
        const reason = getString(args, 'reason')
        const voteType = action.toUpperCase() as
          | 'APPROVE'
          | 'REJECT'
          | 'ABSTAIN'

        if (!['APPROVE', 'REJECT', 'ABSTAIN'].includes(voteType)) {
          return jsonResponse({ error: `Unknown action: ${action}` })
        }

        const result = await fundingApi.councilVote(requestId, voteType, reason)
        if (!result.success) {
          return jsonResponse({ error: result.error })
        }
        return jsonResponse({ transactionHash: result.data })
      }

      case 'get_epoch_votes': {
        const daoId = getString(args, 'daoId')
        const epochId = getNumber(args, 'epochId')
        const result = await fundingApi.getEpochVotes(daoId, epochId)
        return jsonResponse(result.data ?? result.error)
      }

      case 'get_fee_distribution_config': {
        const daoId = getString(args, 'daoId')
        const result = await fundingApi.getDAOFundingConfig(daoId)
        return jsonResponse(result.data ?? result.error)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }

  private async handleResourceRead(uri: string): Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>
  }> {
    // Parse URI
    const parts = uri.replace('funding://', '').split('/')

    if (parts[0] === 'daos' && parts.length >= 3) {
      const daoId = parts[1]
      const resource = parts[2]

      switch (resource) {
        case 'pool': {
          const result = await fundingApi.getDAOPool(daoId)
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(result.data ?? result.error, null, 2),
              },
            ],
          }
        }

        case 'epoch': {
          const result = await fundingApi.getCurrentEpoch(daoId)
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(result.data ?? result.error, null, 2),
              },
            ],
          }
        }

        case 'contributors': {
          const result = await fundingApi.getAllContributors()
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify({ contributors: result.data }, null, 2),
              },
            ],
          }
        }

        case 'payment-requests': {
          const result = await fundingApi.getPendingPaymentRequests(daoId)
          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(result.data ?? result.error, null, 2),
              },
            ],
          }
        }
      }
    }

    if (parts[0] === 'contributors' && parts.length >= 2) {
      const contributorId = parts[1]
      const result = await fundingApi.getContributorProfile(contributorId)
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(result.data, null, 2),
          },
        ],
      }
    }

    throw new Error(`Unknown resource: ${uri}`)
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport()
    await this.server.connect(transport)
  }
}

// Start server if run directly
if (import.meta.main) {
  const server = new MCPFundingServer()
  server.start()
}
