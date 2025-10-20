/**
 * A2A Server for Crucible Security Platform
 * Enables agents to interact with security testing infrastructure
 */

import { Router, Request, Response } from 'express';
import { createPaymentRequirement, checkPayment, PAYMENT_TIERS } from '../lib/x402.js';
import { Address } from 'viem';
import type { CrucibleManager } from '../index.js';

const PAYMENT_RECIPIENT = (process.env.CRUCIBLE_PAYMENT_RECIPIENT || 
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

export function createA2ARouter(manager: CrucibleManager): Router {
  const router = Router();
  
  // Skill registry for agent-advertised services
  const skillRegistry = new Map<string, {
    agentId: string;
    agentName: string;
    agentType: string;
    skillId: string;
    skillName: string;
    description: string;
    price?: bigint;
    tags: string[];
    registeredAt: number;
  }>();

  // Register a skill
  router.post('/api/skills/register', async (req: Request, res: Response) => {
    const { agentId, skillId, skillName, description, price, tags } = req.body;
    
    if (!agentId || !skillId || !skillName) {
      return res.status(400).json({ error: 'agentId, skillId, and skillName required' });
    }
    
    const agent = manager.getAgents().find(a => a.id === agentId);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    const registryKey = `${agentId}_${skillId}`;
    
    skillRegistry.set(registryKey, {
      agentId,
      agentName: agent.name,
      agentType: agent.type,
      skillId,
      skillName,
      description: description || '',
      price: price ? BigInt(price) : undefined,
      tags: tags || [],
      registeredAt: Date.now()
    });
    
    res.json({
      success: true,
      message: `Skill ${skillId} registered for agent ${agent.name}`,
      registryKey
    });
  });
  
  // Discover all skills
  router.get('/api/skills', (req: Request, res: Response) => {
    const skills = Array.from(skillRegistry.values());
    
    // Optional filtering
    const agentType = req.query.agentType as string | undefined;
    const tag = req.query.tag as string | undefined;
    
    let filtered = skills;
    
    if (agentType) {
      filtered = filtered.filter(s => s.agentType === agentType);
    }
    
    if (tag) {
      filtered = filtered.filter(s => s.tags.includes(tag));
    }
    
    res.json({
      skills: filtered.map(s => ({
        agentId: s.agentId,
        agentName: s.agentName,
        agentType: s.agentType,
        skillId: s.skillId,
        skillName: s.skillName,
        description: s.description,
        price: s.price?.toString(),
        tags: s.tags
      })),
      total: filtered.length
    });
  });
  
  // Discover skills by agent
  router.get('/api/skills/:agentId', (req: Request, res: Response) => {
    const agentId = req.params.agentId;
    const skills = Array.from(skillRegistry.values()).filter(s => s.agentId === agentId);
    
    res.json({
      agentId,
      skills: skills.map(s => ({
        skillId: s.skillId,
        skillName: s.skillName,
        description: s.description,
        price: s.price?.toString(),
        tags: s.tags
      })),
      total: skills.length
    });
  });

  // Serve Agent Card
  router.get('/.well-known/agent-card.json', (_req, res) => {
    res.json({
      protocolVersion: '0.3.0',
      name: 'Crucible Security Testing Platform',
      description: 'Multi-agent security testing platform for smart contracts and decentralized systems. Run security tests, get vulnerability reports, and monitor network health.',
      url: 'http://localhost:7777/api/a2a',
      preferredTransport: 'http',
      provider: {
        organization: 'Jeju Network',
        url: 'https://jeju.network'
      },
      version: '1.0.0',
      capabilities: {
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: false
      },
      defaultInputModes: ['text', 'data'],
      defaultOutputModes: ['text', 'data'],
      skills: [
        {
          id: 'list-active-agents',
          name: 'List Active Agents',
          description: 'Get list of all running security testing agents',
          tags: ['query', 'agents'],
          examples: ['Show active agents', 'List security testers', 'Which agents are running?']
        },
        {
          id: 'get-agent-reputation',
          name: 'Get Agent Reputation',
          description: 'Get ERC-8004 reputation score for an agent',
          tags: ['query', 'reputation', 'erc-8004'],
          examples: ['Agent reputation', 'Get reputation score', 'Check agent trustworthiness']
        },
        {
          id: 'get-test-results',
          name: 'Get Test Results',
          description: 'Retrieve security test results and findings (FREE tier: last 10, PAID: unlimited)',
          tags: ['query', 'security', 'testing'],
          examples: ['Show test results', 'Latest security findings', 'What vulnerabilities were found?']
        },
        {
          id: 'get-vulnerability-report',
          name: 'Get Vulnerability Report',
          description: 'Get detailed vulnerability report with proof-of-concept (PAID)',
          tags: ['query', 'security', 'premium'],
          examples: ['Detailed vulnerability report', 'Get exploit proof', 'Show vulnerability details']
        },
        {
          id: 'trigger-security-test',
          name: 'Trigger Security Test',
          description: 'Initiate a custom security test on a contract (PAID)',
          tags: ['action', 'security', 'testing', 'premium'],
          examples: ['Test this contract', 'Run security audit', 'Check for vulnerabilities']
        },
        {
          id: 'get-stats',
          name: 'Get Platform Stats',
          description: 'Get Crucible platform statistics',
          tags: ['query', 'stats'],
          examples: ['Platform statistics', 'How many tests run?', 'Crucible stats']
        },
        {
          id: 'subscribe-monitoring',
          name: 'Subscribe to Continuous Monitoring',
          description: 'Subscribe to continuous security monitoring for a contract (PAID)',
          tags: ['action', 'security', 'subscription', 'premium'],
          examples: ['Monitor this contract', 'Subscribe to alerts', 'Continuous monitoring']
        },
        {
          id: 'request-penetration-test',
          name: 'Request Penetration Test',
          description: 'Request full penetration test and audit (PAID)',
          tags: ['action', 'security', 'audit', 'premium'],
          examples: ['Full penetration test', 'Comprehensive audit', 'Complete security review']
        }
      ]
    });
  });

  // A2A JSON-RPC endpoint
  router.post('/api/a2a', async (req: Request, res: Response) => {
    const body: A2ARequest = req.body;
    const paymentHeader = req.headers['x-payment'] as string | undefined;

    if (body.method !== 'message/send') {
      return res.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' }
      });
    }

    const message = body.params?.message;
    if (!message || !message.parts) {
      return res.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'Invalid params' }
      });
    }

    const dataPart = message.parts.find((p) => p.kind === 'data');
    if (!dataPart || !dataPart.data) {
      return res.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No data part found' }
      });
    }

    const skillId = dataPart.data.skillId as string;
    const params = (dataPart.data.params as Record<string, unknown>) || {};

    try {
      const result = await executeSkill(skillId, params, paymentHeader || null, manager);

      if (result.requiresPayment) {
        return res.status(402).json({
          jsonrpc: '2.0',
          id: body.id,
          error: {
            code: 402,
            message: 'Payment Required',
            data: result.requiresPayment,
          },
        });
      }

      res.json({
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
    } catch (error) {
      res.json({
        jsonrpc: '2.0',
        id: body.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
      });
    }
  });

  return router;
}

async function executeSkill(
  skillId: string,
  params: Record<string, unknown>,
  paymentHeader: string | null,
  manager: CrucibleManager
): Promise<{
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: any;
}> {
  switch (skillId) {
    // ============ FREE TIER SKILLS ============

    case 'list-active-agents': {
      const agents = manager.getAgents();
      return {
        message: `${agents.length} agents active`,
        data: {
          agents: agents.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            wallet: a.wallet,
          })),
        },
      };
    }

    case 'get-agent-reputation': {
      const agentId = params.agentId as number;
      
      // Find an agent with registry service
      const agents = manager.getAgents();
      const agentWithRegistry = agents.find(a => a.runtime.getService('registry_service'));
      
      if (!agentWithRegistry) {
        throw new Error('No agent with registry service available');
      }
      
      const registryService = agentWithRegistry.runtime.getService('registry_service') as any;
      const reputation = await registryService.getReputationScore(agentId);
      
      return {
        message: `Reputation for agent ${agentId}: Score ${reputation.score} from ${reputation.count} feedbacks`,
        data: {
          agentId,
          score: reputation.score,
          feedbackCount: reputation.count
        },
      };
    }

    case 'get-test-results': {
      const limit = (params.limit as number) || 10;
      
      if (limit > 10) {
        // Premium access required for more than 10 results
        const paymentCheck = await checkPayment(
          paymentHeader,
          PAYMENT_TIERS.PREMIUM_REPORT_DAILY / BigInt(10),
          PAYMENT_RECIPIENT
        );

        if (!paymentCheck.paid) {
          return {
            message: 'Payment required',
            data: {},
            requiresPayment: createPaymentRequirement(
              '/api/a2a',
              PAYMENT_TIERS.PREMIUM_REPORT_DAILY / BigInt(10),
              'Premium test results access',
              PAYMENT_RECIPIENT
            ),
          };
        }
      }

      // Query database for actual test results from agents
      const agents = manager.getAgents();
      const allResults: any[] = [];
      
      for (const agent of agents) {
        try {
          // Get recent attack/test memories
          const memories = await agent.runtime.getMemories({
            count: limit,
            tableName: 'messages'
          });
          
          const results = memories
            .filter(m => m.content?.action && 
              ['REENTRANCY_ATTACK', 'CREATE_FAKE_SERVICE', 'SUBMIT_REPORT'].includes(m.content.action))
            .map(m => ({
              agent: agent.name,
              action: m.content?.action,
              timestamp: m.createdAt,
              data: m.content?.data,
              summary: m.content?.text?.substring(0, 200)
            }));
          
          allResults.push(...results);
        } catch (error) {
          // Continue if agent fails
        }
      }
      
      // Sort by timestamp and limit
      const sortedResults = allResults
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, limit);
      
      return {
        message: `Last ${sortedResults.length} test results`,
        data: {
          results: sortedResults,
          count: sortedResults.length,
          limit
        },
      };
    }

    case 'get-stats': {
      const agents = manager.getAgents();
      const byType = agents.reduce((acc: Record<string, number>, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
      }, {});

      return {
        message: 'Crucible platform statistics',
        data: {
          totalAgents: agents.length,
          byType,
          vulnerabilitiesFound: 0,
          reportsSubmitted: 0,
          fundsRecovered: '0 ETH',
        },
      };
    }

    // ============ PAID TIER SKILLS ============

    case 'get-vulnerability-report': {
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.VULNERABILITY_REPORT,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.VULNERABILITY_REPORT,
            'Detailed vulnerability report',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const vulnId = params.vulnId as string;
      return {
        message: `Vulnerability report for ${vulnId}`,
        data: {
          vulnId,
          severity: 'CRITICAL',
          description: 'Detailed vulnerability information',
          proofOfConcept: 'Code and transaction proof',
          remediation: 'Fix recommendations',
          settlement: paymentCheck.settlement,
        },
      };
    }

    case 'trigger-security-test': {
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.SECURITY_TEST,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.SECURITY_TEST,
            'Custom security test execution',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const contractAddress = params.contractAddress as string;
      const testType = params.testType as string || 'comprehensive';

      // Find a hacker agent to execute the test
      const agents = manager.getAgents();
      const hackerAgent = agents.find(a => a.type === 'hacker');
      
      if (!hackerAgent) {
        throw new Error('No hacker agent available to execute security test');
      }
      
      // Trigger REENTRANCY_ATTACK action through the runtime
      const testMessage = {
        userId: hackerAgent.runtime.agentId,
        content: {
          text: `Execute ${testType} security test on contract ${contractAddress}`,
          data: {
            contractAddress,
            testType
          }
        },
        roomId: 'a2a-requests'
      };
      
      // Process the action through the agent's runtime
      await hackerAgent.runtime.processActions(
        testMessage as any,
        [],
        undefined,
        async (response) => {
          await hackerAgent.runtime.createMemory({
            userId: hackerAgent.runtime.agentId,
            content: response,
            roomId: 'a2a-requests'
          }, 'messages');
          return [];
        }
      );

      return {
        message: `Security test initiated for ${contractAddress} by agent ${hackerAgent.name}`,
        data: {
          contractAddress,
          testType,
          agent: hackerAgent.name,
          status: 'running',
          estimatedTime: '5-10 minutes',
          settlement: paymentCheck.settlement,
        },
      };
    }

    case 'subscribe-monitoring': {
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.CONTINUOUS_MONITORING_DAILY,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.CONTINUOUS_MONITORING_DAILY,
            'Daily continuous monitoring subscription',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const contractAddress = params.contractAddress as string;
      const expiresAt = Date.now() + 86400000; // 24 hours
      
      // Store subscription in database
      const agents = manager.getAgents();
      const citizenAgent = agents.find(a => a.type === 'citizen');
      
      if (citizenAgent) {
        await citizenAgent.runtime.createMemory({
          userId: citizenAgent.runtime.agentId,
          content: {
            text: `Monitoring subscription created for contract ${contractAddress}. Expires: ${new Date(expiresAt).toISOString()}`,
            action: 'MONITORING_SUBSCRIPTION',
            data: {
              contractAddress,
              expiresAt,
              subscriptionType: 'daily'
            }
          },
          roomId: 'monitoring-subscriptions'
        }, 'monitoring');
      }
      
      return {
        message: `Monitoring subscription activated for ${contractAddress}`,
        data: {
          contractAddress,
          subscriptionType: 'daily',
          expiresAt,
          settlement: paymentCheck.settlement,
        },
      };
    }

    case 'request-penetration-test': {
      const paymentCheck = await checkPayment(
        paymentHeader,
        PAYMENT_TIERS.PENETRATION_TEST,
        PAYMENT_RECIPIENT
      );

      if (!paymentCheck.paid) {
        return {
          message: 'Payment required',
          data: {},
          requiresPayment: createPaymentRequirement(
            '/api/a2a',
            PAYMENT_TIERS.PENETRATION_TEST,
            'Full penetration test and security audit',
            PAYMENT_RECIPIENT
          ),
        };
      }

      const contractAddress = params.contractAddress as string;
      const agents = manager.getAgents();
      const hackers = agents.filter(a => a.type === 'hacker');
      
      if (hackers.length === 0) {
        throw new Error('No hacker agents available for penetration test');
      }
      
      // Queue test for all hacker agents
      const testPromises = hackers.map(async (hacker) => {
        const testMessage = {
          userId: hacker.runtime.agentId,
          content: {
            text: `Execute full penetration test on contract ${contractAddress}`,
            data: { contractAddress, testType: 'full-audit' }
          },
          roomId: 'a2a-requests'
        };
        
        await hacker.runtime.createMemory({
          userId: hacker.runtime.agentId,
          content: testMessage.content,
          roomId: 'a2a-requests'
        }, 'messages');
      });
      
      await Promise.all(testPromises);
      
      return {
        message: `Penetration test scheduled for ${contractAddress}. ${hackers.length} hacker agents assigned.`,
        data: {
          contractAddress,
          testType: 'full-audit',
          hackerAgents: hackers.length,
          estimatedCompletion: '24-48 hours',
          deliverables: ['Vulnerability report', 'Proof-of-concept exploits', 'Remediation guide'],
          settlement: paymentCheck.settlement,
        },
      };
    }

    default:
      throw new Error('Unknown skill');
  }
}

export { executeSkill };

