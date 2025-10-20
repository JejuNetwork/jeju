/**
 * A2A Agent Integration for IPFS Storage Service
 * Enables agent-to-agent file storage and retrieval
 */

import { Hono } from 'hono';
import db from './database';

const a2aApp = new Hono();

/**
 * Agent Card - Service discovery
 */
export const AGENT_CARD = {
  protocolVersion: '0.3.0',
  name: 'Jeju IPFS Storage Service',
  description: 'Decentralized file storage with x402 micropayments. Upload, pin, and retrieve files from local IPFS nodes.',
  url: 'http://localhost:3100/a2a',
  preferredTransport: 'http',
  provider: {
    organization: 'Jeju Network',
    url: 'https://jeju.network',
  },
  version: '1.0.0',
  capabilities: {
    streaming: false,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  defaultInputModes: ['text', 'data', 'binary'],
  defaultOutputModes: ['text', 'data', 'binary'],
  skills: [
    {
      id: 'upload-file',
      name: 'Upload File to IPFS',
      description: 'Upload and pin a file to Jeju IPFS network with optional x402 payment',
      tags: ['storage', 'upload', 'ipfs'],
      examples: ['Upload this image', 'Store this file for 6 months'],
      inputs: {
        file: { type: 'binary', required: true },
        durationMonths: { type: 'number', default: 1 },
        paymentToken: { type: 'string', default: 'USDC' },
      },
      outputs: {
        cid: 'string',
        gatewayUrl: 'string',
        size: 'number',
      },
    },
    {
      id: 'pin-existing-cid',
      name: 'Pin Existing CID',
      description: 'Pin an existing IPFS CID to Jeju network',
      tags: ['storage', 'pin', 'ipfs'],
      examples: ['Pin this CID', 'Keep this hash available'],
      inputs: {
        cid: { type: 'string', required: true },
        name: { type: 'string', required: false },
      },
      outputs: {
        requestId: 'string',
        status: 'string',
      },
    },
    {
      id: 'retrieve-file',
      name: 'Retrieve File from IPFS',
      description: 'Fetch file contents from IPFS by CID',
      tags: ['storage', 'retrieve', 'ipfs'],
      examples: ['Get file QmXxx', 'Retrieve this CID'],
      inputs: {
        cid: { type: 'string', required: true },
      },
      outputs: {
        file: 'binary',
        contentType: 'string',
      },
    },
    {
      id: 'list-pins',
      name: 'List My Pinned Files',
      description: 'Get list of files pinned by owner address or agent',
      tags: ['storage', 'query', 'ipfs'],
      examples: ['Show my files', 'List pinned content'],
      inputs: {
        ownerAddress: { type: 'string', required: false },
      },
      outputs: {
        pins: 'array',
        count: 'number',
      },
    },
    {
      id: 'calculate-cost',
      name: 'Calculate Storage Cost',
      description: 'Estimate cost for storing a file with given size and duration',
      tags: ['storage', 'pricing', 'info'],
      examples: ['How much for 10MB for 3 months?', 'Storage cost estimate'],
      inputs: {
        sizeBytes: { type: 'number', required: true },
        durationMonths: { type: 'number', default: 1 },
      },
      outputs: {
        costUSDC: 'number',
        paymentRequired: 'boolean',
      },
    },
    {
      id: 'get-storage-stats',
      name: 'Get Storage Statistics',
      description: 'Get network-wide storage statistics and health',
      tags: ['storage', 'stats', 'info'],
      examples: ['Storage stats', 'How many files stored?'],
      inputs: {},
      outputs: {
        totalPins: 'number',
        totalSizeGB: 'number',
        activeNodes: 'number',
      },
    },
  ],
};

/**
 * Execute A2A skill
 */
async function executeSkill(skillId: string, params: Record<string, unknown> = {}): Promise<{
  message: string;
  data: Record<string, unknown>;
}> {
  switch (skillId) {
    case 'calculate-cost': {
      const sizeBytes = params.sizeBytes as number;
      const durationMonths = (params.durationMonths as number) || 1;
      const sizeGB = sizeBytes / (1024 ** 3);
      const costUSDC = Math.max(sizeGB * 0.10 * durationMonths, 0.001);

      return {
        message: `Storage cost: $${costUSDC.toFixed(4)} USDC for ${sizeGB.toFixed(4)} GB for ${durationMonths} month(s)`,
        data: {
          sizeBytes,
          sizeGB: Number(sizeGB.toFixed(4)),
          durationMonths,
          costUSDC: Number(costUSDC.toFixed(4)),
          paymentRequired: costUSDC > 0,
          perGBPerMonth: 0.10,
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
          perGBPerMonth: 0.10,
          minFee: 0.001,
        },
      };
    }

    case 'pin-existing-cid': {
      return {
        message: 'Pin existing CID via POST /pins endpoint',
        data: {
          note: 'Submit CID to POST /pins with IPFS Pinning Service API',
          cid: params.cid || 'required',
        },
      };
    }

    case 'list-pins': {
      return {
        message: 'List pins via GET /pins endpoint',
        data: {
          note: 'Query GET /pins for pinned files (add ?owner=address filter)',
          ownerAddress: params.ownerAddress || 'all',
        },
      };
    }

    case 'upload-file':
    case 'retrieve-file': {
      return {
        message: 'File operations available via HTTP endpoints',
        data: {
          note: 'Use POST /upload for uploading or GET /ipfs/{cid} for retrieval',
          skillId,
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

// A2A JSON-RPC endpoint
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

  const result = await executeSkill(skillId as string, dataPart.data as Record<string, unknown>);

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

