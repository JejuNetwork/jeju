/**
 * @module A2AFundingAgent
 * @description A2A agent for deep funding operations
 *
 * Provides A2A-compatible skills for:
 * - Querying funding pools and epochs
 * - Managing contributors and dependencies
 * - Processing payment requests
 * - Deliberation voting
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getDeepFundingService } from './deep-funding-service';
import { getContributorService } from './contributor-service';
import { getPaymentRequestService } from './payment-request-service';
import { getDependencyScanner } from './dependency-scanner';
import type { Address } from 'viem';

// ============ Types ============

interface A2AAgentCard {
  name: string;
  description: string;
  version: string;
  skills: A2ASkill[];
  authentication?: {
    type: string;
    instructions?: string;
  };
}

interface A2ASkill {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

interface A2ATaskRequest {
  taskId: string;
  skillId: string;
  input: Record<string, unknown>;
}

interface A2ATaskResponse {
  taskId: string;
  status: 'completed' | 'failed' | 'pending';
  output?: Record<string, unknown>;
  error?: string;
}

// ============ Agent Card ============

const AGENT_CARD: A2AAgentCard = {
  name: 'Jeju Deep Funding Agent',
  description: 'Agent for managing deep funding distribution across DAOs, contributors, and dependencies',
  version: '1.0.0',
  skills: [
    {
      id: 'get_funding_pool',
      name: 'Get Funding Pool',
      description: 'Get the current funding pool status for a DAO',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string', description: 'The DAO identifier' },
        },
        required: ['daoId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string' },
          totalAccumulated: { type: 'string' },
          contributorPool: { type: 'string' },
          dependencyPool: { type: 'string' },
          reservePool: { type: 'string' },
        },
      },
    },
    {
      id: 'get_current_epoch',
      name: 'Get Current Epoch',
      description: 'Get the current funding epoch details',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string', description: 'The DAO identifier' },
        },
        required: ['daoId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          epochId: { type: 'number' },
          startTime: { type: 'number' },
          endTime: { type: 'number' },
          totalDistributed: { type: 'string' },
          finalized: { type: 'boolean' },
        },
      },
    },
    {
      id: 'scan_dependencies',
      name: 'Scan Repository Dependencies',
      description: 'Scan a GitHub repository for dependencies and calculate funding weights',
      inputSchema: {
        type: 'object',
        properties: {
          owner: { type: 'string', description: 'GitHub repository owner' },
          repo: { type: 'string', description: 'GitHub repository name' },
        },
        required: ['owner', 'repo'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          totalDependencies: { type: 'number' },
          directDependencies: { type: 'number' },
          transitiveDependencies: { type: 'number' },
          registeredDependencies: { type: 'number' },
          dependencies: { type: 'array' },
        },
      },
    },
    {
      id: 'get_contributor_recommendations',
      name: 'Get Contributor Recommendations',
      description: 'Get funding weight recommendations for contributors based on activity',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string', description: 'The DAO identifier' },
        },
        required: ['daoId'],
      },
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            contributorId: { type: 'string' },
            suggestedWeight: { type: 'number' },
            reason: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'get_dependency_recommendations',
      name: 'Get Dependency Recommendations',
      description: 'Get funding weight recommendations for dependencies from repo scan',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string', description: 'The DAO identifier' },
          owner: { type: 'string', description: 'GitHub repository owner' },
          repo: { type: 'string', description: 'GitHub repository name' },
        },
        required: ['daoId', 'owner', 'repo'],
      },
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            packageName: { type: 'string' },
            suggestedWeight: { type: 'number' },
            depth: { type: 'number' },
            isRegistered: { type: 'boolean' },
          },
        },
      },
    },
    {
      id: 'vote_weight',
      name: 'Vote on Weight Adjustment',
      description: 'Cast a vote to adjust contributor or dependency weight',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string' },
          targetId: { type: 'string' },
          adjustment: { type: 'number' },
          reason: { type: 'string' },
          reputation: { type: 'number' },
        },
        required: ['daoId', 'targetId', 'adjustment', 'reason', 'reputation'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          transactionHash: { type: 'string' },
        },
      },
    },
    {
      id: 'get_pending_payment_requests',
      name: 'Get Pending Payment Requests',
      description: 'Get payment requests pending review for a DAO',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string', description: 'The DAO identifier' },
        },
        required: ['daoId'],
      },
      outputSchema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            category: { type: 'string' },
            title: { type: 'string' },
            requestedAmount: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
    },
    {
      id: 'review_payment_request',
      name: 'Review Payment Request',
      description: 'Submit a review vote for a payment request',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          vote: { type: 'string', enum: ['APPROVE', 'REJECT', 'ABSTAIN'] },
          reason: { type: 'string' },
        },
        required: ['requestId', 'vote', 'reason'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          transactionHash: { type: 'string' },
        },
      },
    },
    {
      id: 'get_contributor_profile',
      name: 'Get Contributor Profile',
      description: 'Get full contributor profile with verifications',
      inputSchema: {
        type: 'object',
        properties: {
          contributorId: { type: 'string' },
        },
        required: ['contributorId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          profile: { type: 'object' },
          socialLinks: { type: 'array' },
          repoClaims: { type: 'array' },
          depClaims: { type: 'array' },
        },
      },
    },
    {
      id: 'get_pending_rewards',
      name: 'Get Pending Rewards',
      description: 'Get pending rewards for a contributor in a DAO',
      inputSchema: {
        type: 'object',
        properties: {
          daoId: { type: 'string' },
          contributorId: { type: 'string' },
        },
        required: ['daoId', 'contributorId'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          pendingRewards: { type: 'string' },
        },
      },
    },
  ],
};

// ============ Skill Handlers ============

async function handleSkill(
  skillId: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const fundingService = getDeepFundingService();
  const contributorService = getContributorService();
  const paymentService = getPaymentRequestService();

  switch (skillId) {
    case 'get_funding_pool': {
      const pool = await fundingService.getDAOPool(input.daoId as string);
      return pool
        ? {
            daoId: pool.daoId,
            totalAccumulated: pool.totalAccumulated.toString(),
            contributorPool: pool.contributorPool.toString(),
            dependencyPool: pool.dependencyPool.toString(),
            reservePool: pool.reservePool.toString(),
          }
        : { error: 'Pool not found' };
    }

    case 'get_current_epoch': {
      const epoch = await fundingService.getCurrentEpoch(input.daoId as string);
      return epoch
        ? {
            epochId: epoch.epochId,
            startTime: epoch.startTime,
            endTime: epoch.endTime,
            totalDistributed: epoch.totalDistributed.toString(),
            finalized: epoch.finalized,
          }
        : { error: 'No active epoch' };
    }

    case 'scan_dependencies': {
      const scanner = getDependencyScanner();
      const result = await scanner.scanRepository(input.owner as string, input.repo as string);
      return {
        totalDependencies: result.totalDependencies,
        directDependencies: result.directDependencies,
        transitiveDependencies: result.transitiveDependencies,
        registeredDependencies: result.registeredDependencies,
        dependencies: result.dependencies.slice(0, 20), // Limit to top 20
      };
    }

    case 'get_contributor_recommendations': {
      const recs = await fundingService.generateContributorRecommendations(input.daoId as string);
      return recs.map((r) => ({
        contributorId: r.contributorId,
        suggestedWeight: r.suggestedWeight,
        reason: r.reason,
        contributions: r.contributions,
      }));
    }

    case 'get_dependency_recommendations': {
      const recs = await fundingService.generateDependencyRecommendations(
        input.daoId as string,
        input.owner as string,
        input.repo as string
      );
      return recs.map((r) => ({
        packageName: r.packageName,
        registryType: r.registryType,
        suggestedWeight: r.suggestedWeight,
        depth: r.depth,
        usageCount: r.usageCount,
        isRegistered: r.isRegistered,
      }));
    }

    case 'vote_weight': {
      const hash = await fundingService.voteOnWeight(
        input.daoId as string,
        input.targetId as string,
        input.adjustment as number,
        input.reason as string,
        input.reputation as number
      );
      return { transactionHash: hash };
    }

    case 'get_pending_payment_requests': {
      const requests = await paymentService.getPendingRequests(input.daoId as string);
      return requests.map((r) => ({
        requestId: r.requestId,
        category: r.category,
        title: r.title,
        requestedAmount: r.requestedAmount.toString(),
        status: r.status,
        isRetroactive: r.isRetroactive,
      }));
    }

    case 'review_payment_request': {
      const hash = await paymentService.councilVote(
        input.requestId as string,
        input.vote as 'APPROVE' | 'REJECT' | 'ABSTAIN',
        input.reason as string
      );
      return { transactionHash: hash };
    }

    case 'get_contributor_profile': {
      const profile = await contributorService.getContributor(input.contributorId as string);
      const socialLinks = await contributorService.getSocialLinks(input.contributorId as string);
      const repoClaims = await contributorService.getRepositoryClaims(input.contributorId as string);
      const depClaims = await contributorService.getDependencyClaims(input.contributorId as string);
      return { profile, socialLinks, repoClaims, depClaims };
    }

    case 'get_pending_rewards': {
      const rewards = await fundingService.getPendingContributorRewards(
        input.daoId as string,
        input.contributorId as string
      );
      return { pendingRewards: rewards.toString() };
    }

    default:
      throw new Error(`Unknown skill: ${skillId}`);
  }
}

// ============ HTTP Server ============

export function createA2AFundingServer(): Hono {
  const app = new Hono();

  app.use('*', cors());

  // A2A Agent Card endpoint
  app.get('/.well-known/agent.json', (c) => {
    return c.json(AGENT_CARD);
  });

  // A2A Tasks endpoint
  app.post('/tasks', async (c) => {
    const request = await c.req.json<A2ATaskRequest>();

    const response: A2ATaskResponse = {
      taskId: request.taskId,
      status: 'pending',
    };

    try {
      const output = await handleSkill(request.skillId, request.input);
      response.status = 'completed';
      response.output = output;
    } catch (error) {
      response.status = 'failed';
      response.error = error instanceof Error ? error.message : 'Unknown error';
    }

    return c.json(response);
  });

  // Health check
  app.get('/health', (c) => {
    return c.json({ status: 'healthy', agent: 'jeju-deep-funding', version: '1.0.0' });
  });

  return app;
}

// Start server if run directly
if (import.meta.main) {
  const app = createA2AFundingServer();
  const port = parseInt(process.env.A2A_PORT || '3100');

  console.log(`A2A Funding Agent starting on port ${port}`);

  Bun.serve({
    fetch: app.fetch,
    port,
  });
}

