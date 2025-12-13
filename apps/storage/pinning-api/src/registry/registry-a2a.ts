/**
 * Container Registry A2A Server
 * 
 * Agent-to-agent interface for container registry operations.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { OCIRegistry, ImageRecord, RegistryAccount } from './oci-registry';

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
// A2A Server
// ============================================================================

export function createRegistryA2AServer(registry: OCIRegistry): Hono {
  const app = new Hono();

  app.use('/*', cors());

  const AGENT_CARD = {
    protocolVersion: '0.3.0',
    name: 'Jeju Container Registry',
    description: 'Decentralized OCI-compatible container registry backed by IPFS and Arweave',
    url: '/registry/a2a',
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      // Repository Operations
      { id: 'list-repositories', name: 'List Repositories', description: 'List all repositories in the registry', tags: ['query', 'repositories'] },
      { id: 'list-tags', name: 'List Tags', description: 'List all tags for a repository', tags: ['query', 'tags'] },
      { id: 'get-image', name: 'Get Image Info', description: 'Get image metadata by digest or tag', tags: ['query', 'image'] },
      { id: 'search-images', name: 'Search Images', description: 'Search for images by name or tag', tags: ['query', 'search'] },
      
      // Account Operations
      { id: 'get-account', name: 'Get Account', description: 'Get registry account details', tags: ['account', 'query'] },
      { id: 'get-account-images', name: 'Get Account Images', description: 'List images uploaded by an account', tags: ['account', 'images'] },
      { id: 'topup-account', name: 'Top Up Account', description: 'Add balance to registry account', tags: ['account', 'payment'] },
      { id: 'stake-for-access', name: 'Stake for Access', description: 'Stake tokens for unlimited registry access', tags: ['account', 'staking'] },
      
      // Image Operations
      { id: 'prepare-push', name: 'Prepare Push', description: 'Get push authorization and upload URL', tags: ['push', 'action'] },
      { id: 'prepare-pull', name: 'Prepare Pull', description: 'Get pull authorization and download URLs', tags: ['pull', 'action'] },
      { id: 'delete-image', name: 'Delete Image', description: 'Delete an image from the registry', tags: ['delete', 'action'] },
      { id: 'verify-image', name: 'Verify Image', description: 'Verify image integrity and content hash', tags: ['verify', 'security'] },
      
      // Registry Stats
      { id: 'registry-stats', name: 'Registry Statistics', description: 'Get overall registry statistics', tags: ['stats', 'query'] },
      { id: 'registry-health', name: 'Registry Health', description: 'Check registry health status', tags: ['health', 'query'] },
    ],
  };

  app.get('/.well-known/agent-card.json', (c) => c.json(AGENT_CARD));

  app.post('/', async (c) => {
    const body = await c.req.json<A2ARequest>();

    if (body.method !== 'message/send') {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Method not found' } });
    }

    const message = body.params?.message;
    if (!message?.parts) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Invalid params' } });
    }

    const dataPart = message.parts.find((p) => p.kind === 'data');
    if (!dataPart?.data) {
      return c.json({ jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'No data part found' } });
    }

    const skillId = dataPart.data.skillId as string;
    const params = dataPart.data;

    const result = await executeSkill(skillId, params);

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

  async function executeSkill(skillId: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (skillId) {
      case 'list-repositories': {
        const n = (params.limit as number) ?? 100;
        // Would call registry method
        return {
          message: 'Repository listing available via /v2/_catalog',
          data: { endpoint: '/v2/_catalog', params: { n } },
        };
      }

      case 'list-tags': {
        const repository = params.repository as string;
        if (!repository) {
          return { message: 'Repository name required', data: { error: 'Missing repository' } };
        }
        return {
          message: `Tags for ${repository} available`,
          data: { endpoint: `/v2/${repository}/tags/list` },
        };
      }

      case 'get-image': {
        const repository = params.repository as string;
        const reference = params.reference as string;
        if (!repository || !reference) {
          return { message: 'Repository and reference required', data: { error: 'Missing params' } };
        }
        return {
          message: `Image info for ${repository}:${reference}`,
          data: { endpoint: `/v2/${repository}/manifests/${reference}` },
        };
      }

      case 'search-images': {
        const query = params.query as string;
        if (!query) {
          return { message: 'Search query required', data: { error: 'Missing query' } };
        }
        return {
          message: `Searching for images matching "${query}"`,
          data: { query, note: 'Search by repository name prefix' },
        };
      }

      case 'get-account': {
        const address = params.address as string;
        if (!address) {
          return { message: 'Address required', data: { error: 'Missing address' } };
        }
        return {
          message: `Account details for ${address}`,
          data: { endpoint: `/v2/_registry/accounts/${address}` },
        };
      }

      case 'get-account-images': {
        const address = params.address as string;
        if (!address) {
          return { message: 'Address required', data: { error: 'Missing address' } };
        }
        return {
          message: `Images uploaded by ${address}`,
          data: { endpoint: `/v2/_registry/accounts/${address}/images` },
        };
      }

      case 'topup-account': {
        const address = params.address as string;
        const amount = params.amount as string;
        if (!address || !amount) {
          return { message: 'Address and amount required', data: { error: 'Missing params' } };
        }
        return {
          message: `Prepare payment for ${amount} to top up account`,
          data: {
            action: 'sign-and-send',
            transaction: {
              to: process.env.REGISTRY_PAYMENT_RECIPIENT,
              value: amount,
              data: `0x${Buffer.from(`topup:${address}`).toString('hex')}`,
            },
            callback: `/v2/_registry/accounts/${address}/topup`,
          },
        };
      }

      case 'stake-for-access': {
        const address = params.address as string;
        const amount = params.amount as string;
        if (!address || !amount) {
          return { message: 'Address and amount required', data: { error: 'Missing params' } };
        }
        return {
          message: `Prepare staking transaction for unlimited access`,
          data: {
            action: 'sign-and-send',
            transaction: {
              to: process.env.REGISTRY_STAKING_CONTRACT,
              data: '0x...', // Would be actual contract call
            },
            note: 'Stake tokens for unlimited push/pull access',
          },
        };
      }

      case 'prepare-push': {
        const repository = params.repository as string;
        if (!repository) {
          return { message: 'Repository name required', data: { error: 'Missing repository' } };
        }
        return {
          message: `Push authorization for ${repository}`,
          data: {
            uploadEndpoint: `/v2/${repository}/blobs/uploads/`,
            manifestEndpoint: `/v2/${repository}/manifests/`,
            instructions: [
              '1. POST to uploadEndpoint to start blob upload',
              '2. PATCH with chunks or PUT with full blob',
              '3. PUT to manifestEndpoint with manifest JSON',
            ],
          },
        };
      }

      case 'prepare-pull': {
        const repository = params.repository as string;
        const reference = params.reference as string;
        if (!repository || !reference) {
          return { message: 'Repository and reference required', data: { error: 'Missing params' } };
        }
        return {
          message: `Pull authorization for ${repository}:${reference}`,
          data: {
            manifestEndpoint: `/v2/${repository}/manifests/${reference}`,
            blobEndpoint: `/v2/${repository}/blobs/`,
            instructions: [
              '1. GET manifest to get layer digests',
              '2. GET each layer blob by digest',
            ],
          },
        };
      }

      case 'delete-image': {
        const repository = params.repository as string;
        const reference = params.reference as string;
        if (!repository || !reference) {
          return { message: 'Repository and reference required', data: { error: 'Missing params' } };
        }
        return {
          message: `Delete ${repository}:${reference}`,
          data: {
            action: 'DELETE',
            endpoint: `/v2/${repository}/manifests/${reference}`,
            warning: 'This action cannot be undone',
          },
        };
      }

      case 'verify-image': {
        const digest = params.digest as string;
        if (!digest) {
          return { message: 'Digest required', data: { error: 'Missing digest' } };
        }
        return {
          message: `Image verification`,
          data: {
            endpoint: `/v2/_registry/images/${digest}`,
            verificationSteps: [
              '1. Fetch manifest and compute digest',
              '2. Compare computed vs stored digest',
              '3. Verify all layer blobs exist',
            ],
          },
        };
      }

      case 'registry-stats': {
        return {
          message: 'Registry statistics',
          data: { endpoint: '/v2/_registry/health' },
        };
      }

      case 'registry-health': {
        return {
          message: 'Registry health check',
          data: { endpoint: '/v2/_registry/health' },
        };
      }

      default:
        return {
          message: 'Unknown skill',
          data: { error: 'Skill not found', availableSkills: AGENT_CARD.skills.map(s => s.id) },
        };
    }
  }

  return app;
}

