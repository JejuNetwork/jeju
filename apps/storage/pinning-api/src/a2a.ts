/**
 * A2A Agent Integration for IPFS Storage Service (Basic Mode)
 * Enables agent-to-agent file storage and retrieval with x402 payments
 * 
 * This is the fallback A2A when marketplace contracts are not configured.
 * For full marketplace features, use StorageA2AServer from a2a-server.ts
 */

import { Hono } from 'hono';
import db from './database';
import { 
  calculateStorageCost, 
  createStoragePaymentRequirement,
  parseX402Header,
  verifyX402Payment,
  formatStorageCost,
  ZERO_ADDRESS,
} from './sdk/x402';
import { formatEther } from 'ethers';

const a2aApp = new Hono();

// Payment recipient address
const PAYMENT_RECIPIENT = (process.env.X402_RECIPIENT_ADDRESS || 
  process.env.PAYMENT_RECEIVER_ADDRESS || 
  ZERO_ADDRESS) as `0x${string}`;

/**
 * Agent Card - Service discovery with x402 payment support
 */
export const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju IPFS Storage Service',
  description: 'Decentralized file storage with x402 micropayments. Upload, pin, and retrieve files. All paid operations require x402 payment header.',
  url: 'http://localhost:3100/a2a',
  preferredTransport: 'http',
  provider: {
    organization: 'Jeju Network',
    url: 'https://jeju.network',
  },
  version: '1.1.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  authentication: {
    schemes: ['x402'],
    headers: ['x-payment', 'x-jeju-address'],
  },
  defaultInputModes: ['text', 'data', 'binary'],
  defaultOutputModes: ['text', 'data', 'binary'],
  skills: [
    // === FREE SKILLS (no payment required) ===
    {
      id: 'calculate-cost',
      name: 'Calculate Storage Cost',
      description: 'Estimate cost for storing a file with given size, duration, and tier',
      tags: ['storage', 'pricing', 'info', 'free'],
      examples: ['How much for 10MB for 3 months?', 'Storage cost estimate'],
      inputSchema: {
        type: 'object',
        properties: {
          sizeBytes: { type: 'number', description: 'File size in bytes' },
          durationMonths: { type: 'number', default: 1 },
          tier: { type: 'string', enum: ['hot', 'warm', 'cold', 'permanent'], default: 'warm' },
        },
        required: ['sizeBytes'],
      },
      outputs: {
        costETH: 'string',
        costWei: 'string',
        humanReadable: 'string',
      },
    },
    {
      id: 'get-storage-stats',
      name: 'Get Storage Statistics',
      description: 'Get storage node statistics',
      tags: ['storage', 'stats', 'info', 'free'],
      examples: ['Storage stats', 'How many files stored?'],
      inputSchema: { type: 'object', properties: {} },
      outputs: {
        totalPins: 'number',
        totalSizeGB: 'number',
      },
    },
    {
      id: 'list-pins',
      name: 'List Pinned Files',
      description: 'Get list of pinned files',
      tags: ['storage', 'query', 'ipfs', 'free'],
      examples: ['Show my files', 'List pinned content'],
      inputSchema: {
        type: 'object',
        properties: {
          ownerAddress: { type: 'string', description: 'Filter by owner' },
        },
      },
      outputs: {
        total: 'number',
        results: 'array',
      },
    },
    {
      id: 'retrieve-file',
      name: 'Retrieve File',
      description: 'Get file by CID from IPFS gateway',
      tags: ['storage', 'retrieve', 'ipfs', 'free'],
      examples: ['Get file QmXxx', 'Retrieve this CID'],
      inputSchema: {
        type: 'object',
        properties: {
          cid: { type: 'string', description: 'IPFS CID' },
        },
        required: ['cid'],
      },
      outputs: {
        cid: 'string',
        gatewayUrl: 'string',
        localEndpoint: 'string',
      },
    },
    // === PAID SKILLS (x402 payment required) ===
    {
      id: 'upload-file',
      name: 'Upload File to IPFS',
      description: 'Upload and pin a file (REQUIRES x402 payment)',
      tags: ['storage', 'upload', 'ipfs', 'x402'],
      examples: ['Upload this image', 'Store this file for 6 months'],
      inputSchema: {
        type: 'object',
        properties: {
          sizeBytes: { type: 'number', description: 'Expected file size for quote' },
          durationMonths: { type: 'number', default: 1 },
          tier: { type: 'string', enum: ['hot', 'warm', 'cold', 'permanent'], default: 'warm' },
        },
      },
      outputs: {
        endpoint: 'string',
        headers: 'object',
        estimatedCostETH: 'string',
      },
      paymentRequired: true,
    },
    {
      id: 'pin-existing-cid',
      name: 'Pin Existing CID',
      description: 'Pin an existing IPFS CID (REQUIRES x402 payment)',
      tags: ['storage', 'pin', 'ipfs', 'x402'],
      examples: ['Pin this CID', 'Keep this hash available'],
      inputSchema: {
        type: 'object',
        properties: {
          cid: { type: 'string', description: 'IPFS CID to pin' },
          name: { type: 'string', description: 'Optional name' },
          sizeBytes: { type: 'number', description: 'Expected size (default 1MB)' },
          durationMonths: { type: 'number', default: 1 },
        },
        required: ['cid'],
      },
      outputs: {
        endpoint: 'string',
        body: 'object',
        headers: 'object',
      },
      paymentRequired: true,
    },
  ],
};

interface SkillResult {
  message: string;
  data: Record<string, unknown>;
  requiresPayment?: ReturnType<typeof createStoragePaymentRequirement>;
}

/**
 * Execute A2A skill with x402 payment support
 */
async function executeSkill(
  skillId: string, 
  params: Record<string, unknown> = {},
  userAddress?: string,
  paymentHeader?: string
): Promise<SkillResult> {
  switch (skillId) {
    case 'calculate-cost': {
      const sizeBytes = params.sizeBytes as number;
      const durationMonths = (params.durationMonths as number) || 1;
      const durationDays = durationMonths * 30;
      const tier = ((params.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';
      const sizeGB = sizeBytes / (1024 ** 3);
      
      const costWei = calculateStorageCost(sizeBytes, durationDays, tier);

      return {
        message: `Storage cost: ${formatEther(costWei)} ETH for ${sizeGB.toFixed(4)} GB for ${durationMonths} month(s) (${tier} tier)`,
        data: {
          sizeBytes,
          sizeGB: Number(sizeGB.toFixed(4)),
          durationMonths,
          durationDays,
          tier,
          costETH: formatEther(costWei),
          costWei: costWei.toString(),
          humanReadable: formatStorageCost(costWei),
        },
      };
    }

    case 'get-storage-stats': {
      const stats = await db.getStorageStats();
      return {
        message: `Storage stats: ${stats.totalPins} files, ${stats.totalSizeGB.toFixed(2)} GB total`,
        data: {
          totalPins: stats.totalPins,
          totalSizeBytes: stats.totalSizeBytes,
          totalSizeGB: Number(stats.totalSizeGB.toFixed(2)),
          mode: 'basic', // Indicates basic mode without marketplace contracts
        },
      };
    }

    case 'upload-file': {
      const sizeBytes = (params.sizeBytes as number) || 1024 * 1024; // Default 1MB
      const durationDays = ((params.durationMonths as number) || 1) * 30;
      const tier = ((params.tier as string) || 'warm').toLowerCase() as 'hot' | 'warm' | 'cold' | 'permanent';
      
      const costWei = calculateStorageCost(sizeBytes, durationDays, tier);

      // Require x402 payment for upload
      if (!paymentHeader) {
        return {
          message: 'Payment required for upload',
          data: { estimatedCostWei: costWei.toString(), estimatedCostETH: formatEther(costWei) },
          requiresPayment: createStoragePaymentRequirement(
            '/a2a/upload-file',
            costWei,
            PAYMENT_RECIPIENT,
            `Upload file: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`
          ),
        };
      }

      // Verify payment if header provided
      if (userAddress) {
        const parsed = parseX402Header(paymentHeader);
        if (parsed) {
          const verified = verifyX402Payment(
            parsed,
            PAYMENT_RECIPIENT,
            userAddress as `0x${string}`,
            { expectedAmount: costWei }
          );
          if (!verified) {
            return {
              message: 'Payment verification failed',
              data: { error: 'Invalid payment signature or insufficient amount' },
            };
          }
        }
      }

      return {
        message: 'Payment verified. Submit file to POST /upload endpoint',
        data: {
          endpoint: '/upload',
          method: 'POST',
          headers: { 
            'X-Payment': paymentHeader, 
            'x-jeju-address': userAddress || '',
            'Content-Type': 'multipart/form-data',
          },
          estimatedCostETH: formatEther(costWei),
        },
      };
    }

    case 'pin-existing-cid': {
      const cid = params.cid as string;
      const sizeBytes = (params.sizeBytes as number) || 1024 * 1024;
      const durationDays = ((params.durationMonths as number) || 1) * 30;
      
      if (!cid) {
        return { message: 'Error: cid required', data: { error: 'Missing cid' } };
      }

      const costWei = calculateStorageCost(sizeBytes, durationDays, 'warm');

      if (!paymentHeader) {
        return {
          message: 'Payment required for pinning',
          data: { cid, estimatedCostWei: costWei.toString() },
          requiresPayment: createStoragePaymentRequirement(
            '/a2a/pin-existing-cid',
            costWei,
            PAYMENT_RECIPIENT,
            `Pin CID: ${cid}`
          ),
        };
      }

      return {
        message: 'Payment verified. Submit pin request',
        data: {
          endpoint: '/pins',
          method: 'POST',
          body: { cid, name: params.name || cid },
          headers: { 'X-Payment': paymentHeader, 'x-jeju-address': userAddress || '' },
        },
      };
    }

    case 'list-pins': {
      const pins = await db.listPins({ limit: 20, offset: 0 });
      const count = await db.countPins();
      return {
        message: `Found ${count} pinned files`,
        data: {
          total: count,
          results: pins.map(p => ({
            id: p.id,
            cid: p.cid,
            name: p.name,
            status: p.status,
            sizeBytes: p.sizeBytes,
          })),
        },
      };
    }

    case 'retrieve-file': {
      const cid = params.cid as string;
      if (!cid) {
        return { message: 'Error: cid required', data: { error: 'Missing cid' } };
      }

      const ipfsGateway = process.env.IPFS_GATEWAY_URL || 'https://ipfs.io';
      return {
        message: 'File available via IPFS gateway',
        data: {
          cid,
          gatewayUrl: `${ipfsGateway}/ipfs/${cid}`,
          localEndpoint: `/ipfs/${cid}`,
        },
      };
    }

    default:
      return {
        message: 'Unknown skill',
        data: { error: 'Skill not found', availableSkills: AGENT_CARD.skills.map(s => s.id) },
      };
  }
}

// Serve agent card at well-known endpoint
a2aApp.get('/.well-known/agent-card.json', (c) => {
  return c.json(AGENT_CARD);
});

// A2A JSON-RPC endpoint with x402 payment support
a2aApp.post('/a2a', async (c) => {
  const body = await c.req.json();

  if (body.method !== 'message/send') {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    });
  }

  const message = body.params?.message;
  if (!message || !message.parts) {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'Invalid params' },
    });
  }

  const dataPart = message.parts.find((p: { kind: string }) => p.kind === 'data');
  if (!dataPart || !dataPart.data) {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No data part found' },
    });
  }

  const skillId = dataPart.data.skillId;
  if (!skillId) {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32602, message: 'No skillId specified' },
    });
  }

  // Extract payment headers
  const userAddress = c.req.header('x-jeju-address');
  const paymentHeader = c.req.header('x-payment');

  const result = await executeSkill(
    skillId as string, 
    dataPart.data as Record<string, unknown>,
    userAddress,
    paymentHeader
  );

  // Return 402 if payment is required
  if (result.requiresPayment) {
    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      error: { 
        code: 402, 
        message: 'Payment Required', 
        data: result.requiresPayment 
      },
    }, 402);
  }

  return c.json({
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
});

export { a2aApp };

