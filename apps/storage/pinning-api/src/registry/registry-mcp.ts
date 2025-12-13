/**
 * Container Registry MCP Server
 * 
 * Model Context Protocol interface for container registry operations.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { OCIRegistry } from './oci-registry';

// ============================================================================
// MCP Server
// ============================================================================

export function createRegistryMCPServer(registry: OCIRegistry): Hono {
  const app = new Hono();

  app.use('/*', cors());

  const SERVER_INFO = {
    name: 'jeju-container-registry',
    version: '1.0.0',
    description: 'Decentralized OCI container registry with IPFS/Arweave storage',
    capabilities: { resources: true, tools: true, prompts: false },
  };

  const RESOURCES = [
    { uri: 'registry://repositories', name: 'Repositories', description: 'List of all repositories', mimeType: 'application/json' },
    { uri: 'registry://stats', name: 'Registry Stats', description: 'Registry statistics and health', mimeType: 'application/json' },
    { uri: 'registry://config', name: 'Registry Config', description: 'Registry configuration', mimeType: 'application/json' },
  ];

  const TOOLS = [
    {
      name: 'list_repositories',
      description: 'List all repositories in the registry',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Maximum number of repositories to return' },
          last: { type: 'string', description: 'Last repository from previous page' },
        },
      },
    },
    {
      name: 'list_tags',
      description: 'List all tags for a repository',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository name' },
        },
        required: ['repository'],
      },
    },
    {
      name: 'get_manifest',
      description: 'Get manifest for an image',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository name' },
          reference: { type: 'string', description: 'Tag or digest' },
        },
        required: ['repository', 'reference'],
      },
    },
    {
      name: 'get_image_info',
      description: 'Get detailed information about an image',
      inputSchema: {
        type: 'object',
        properties: {
          digest: { type: 'string', description: 'Image digest (sha256:...)' },
        },
        required: ['digest'],
      },
    },
    {
      name: 'check_blob_exists',
      description: 'Check if a blob exists in the registry',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository name' },
          digest: { type: 'string', description: 'Blob digest' },
        },
        required: ['repository', 'digest'],
      },
    },
    {
      name: 'get_account_info',
      description: 'Get registry account information',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Account address' },
        },
        required: ['address'],
      },
    },
    {
      name: 'prepare_push_transaction',
      description: 'Prepare transaction for pushing an image',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Target repository' },
          sizeBytes: { type: 'number', description: 'Estimated size in bytes' },
        },
        required: ['repository', 'sizeBytes'],
      },
    },
    {
      name: 'prepare_topup_transaction',
      description: 'Prepare transaction for topping up account balance',
      inputSchema: {
        type: 'object',
        properties: {
          address: { type: 'string', description: 'Account address' },
          amount: { type: 'string', description: 'Amount to add (in ETH)' },
        },
        required: ['address', 'amount'],
      },
    },
    {
      name: 'verify_image_integrity',
      description: 'Verify image integrity against stored hashes',
      inputSchema: {
        type: 'object',
        properties: {
          repository: { type: 'string', description: 'Repository name' },
          reference: { type: 'string', description: 'Tag or digest' },
        },
        required: ['repository', 'reference'],
      },
    },
  ];

  // Initialize endpoint
  app.post('/initialize', (c) => {
    return c.json({
      protocolVersion: '2024-11-05',
      serverInfo: SERVER_INFO,
      capabilities: SERVER_INFO.capabilities,
    });
  });

  // List resources
  app.post('/resources/list', (c) => {
    return c.json({ resources: RESOURCES });
  });

  // Read resource
  app.post('/resources/read', async (c) => {
    const { uri } = await c.req.json() as { uri: string };
    let contents: unknown;

    switch (uri) {
      case 'registry://repositories':
        contents = {
          note: 'Fetch from /v2/_catalog',
          endpoint: '/v2/_catalog',
        };
        break;

      case 'registry://stats':
        contents = {
          note: 'Fetch from /v2/_registry/health',
          endpoint: '/v2/_registry/health',
        };
        break;

      case 'registry://config':
        contents = {
          storageBackend: process.env.REGISTRY_STORAGE_BACKEND ?? 'ipfs',
          allowPublicPulls: process.env.REGISTRY_PUBLIC_PULLS === 'true',
          maxLayerSize: '5GB',
          maxManifestSize: '10MB',
          paymentRecipient: process.env.REGISTRY_PAYMENT_RECIPIENT,
        };
        break;

      default:
        return c.json({ error: 'Resource not found' }, 404);
    }

    return c.json({
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(contents, null, 2),
      }],
    });
  });

  // List tools
  app.post('/tools/list', (c) => {
    return c.json({ tools: TOOLS });
  });

  // Call tool
  app.post('/tools/call', async (c) => {
    const { name, arguments: args } = await c.req.json() as { name: string; arguments: Record<string, unknown> };
    let result: unknown;
    let isError = false;

    switch (name) {
      case 'list_repositories':
        result = {
          endpoint: '/v2/_catalog',
          params: {
            n: args.limit ?? 100,
            last: args.last,
          },
        };
        break;

      case 'list_tags':
        if (!args.repository) {
          result = { error: 'Repository required' };
          isError = true;
        } else {
          result = {
            endpoint: `/v2/${args.repository}/tags/list`,
          };
        }
        break;

      case 'get_manifest':
        if (!args.repository || !args.reference) {
          result = { error: 'Repository and reference required' };
          isError = true;
        } else {
          result = {
            endpoint: `/v2/${args.repository}/manifests/${args.reference}`,
            headers: {
              Accept: 'application/vnd.docker.distribution.manifest.v2+json',
            },
          };
        }
        break;

      case 'get_image_info':
        if (!args.digest) {
          result = { error: 'Digest required' };
          isError = true;
        } else {
          result = {
            endpoint: `/v2/_registry/images/${args.digest}`,
          };
        }
        break;

      case 'check_blob_exists':
        if (!args.repository || !args.digest) {
          result = { error: 'Repository and digest required' };
          isError = true;
        } else {
          result = {
            endpoint: `/v2/${args.repository}/blobs/${args.digest}`,
            method: 'HEAD',
          };
        }
        break;

      case 'get_account_info':
        if (!args.address) {
          result = { error: 'Address required' };
          isError = true;
        } else {
          result = {
            endpoint: `/v2/_registry/accounts/${args.address}`,
          };
        }
        break;

      case 'prepare_push_transaction':
        if (!args.repository || !args.sizeBytes) {
          result = { error: 'Repository and sizeBytes required' };
          isError = true;
        } else {
          const sizeGb = (args.sizeBytes as number) / (1024 * 1024 * 1024);
          const estimatedCost = sizeGb * 0.001; // $0.001 per GB
          result = {
            repository: args.repository,
            estimatedCost: `${estimatedCost.toFixed(6)} ETH`,
            steps: [
              '1. Ensure account has sufficient balance',
              '2. POST to /v2/{repository}/blobs/uploads/ to initiate',
              '3. Upload blob chunks via PATCH',
              '4. Complete upload with PUT and digest',
              '5. PUT manifest to /v2/{repository}/manifests/{tag}',
            ],
          };
        }
        break;

      case 'prepare_topup_transaction':
        if (!args.address || !args.amount) {
          result = { error: 'Address and amount required' };
          isError = true;
        } else {
          result = {
            action: 'sign-and-send',
            transaction: {
              to: process.env.REGISTRY_PAYMENT_RECIPIENT,
              value: args.amount,
              chainId: parseInt(process.env.CHAIN_ID ?? '84532', 10),
            },
            callback: `/v2/_registry/accounts/${args.address}/topup`,
            callbackBody: {
              amount: args.amount,
              txHash: '{{TX_HASH}}',
            },
          };
        }
        break;

      case 'verify_image_integrity':
        if (!args.repository || !args.reference) {
          result = { error: 'Repository and reference required' };
          isError = true;
        } else {
          result = {
            steps: [
              {
                step: 1,
                action: 'GET manifest',
                endpoint: `/v2/${args.repository}/manifests/${args.reference}`,
              },
              {
                step: 2,
                action: 'Compute manifest digest',
                expected: 'sha256:...',
              },
              {
                step: 3,
                action: 'Verify each layer exists',
                endpoint: `/v2/${args.repository}/blobs/{digest}`,
              },
              {
                step: 4,
                action: 'Verify layer content hashes',
              },
            ],
          };
        }
        break;

      default:
        result = { error: 'Tool not found' };
        isError = true;
    }

    return c.json({
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      isError,
    });
  });

  // Info endpoint
  app.get('/', (c) => {
    return c.json({
      server: SERVER_INFO.name,
      version: SERVER_INFO.version,
      description: SERVER_INFO.description,
      resources: RESOURCES,
      tools: TOOLS,
      capabilities: SERVER_INFO.capabilities,
    });
  });

  return app;
}

