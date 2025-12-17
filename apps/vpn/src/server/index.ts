/**
 * VPN Server with x402, A2A, MCP, and REST API
 *
 * Provides:
 * - REST API for VPN operations
 * - x402 micropayments for premium/paid tier
 * - A2A protocol for agent-to-agent VPN access
 * - MCP tools for AI agent integration
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { createA2ARouter } from './a2a';
import { createMCPRouter } from './mcp';
import { createRESTRouter } from './rest';
import { createX402Middleware } from './x402';
import type { VPNServerConfig, VPNServiceContext } from './types';

export function createVPNServer(config: VPNServerConfig): Hono {
  const app = new Hono();

  // Base middleware
  app.use('*', cors());
  app.use('*', logger());

  // Service context available to all routes
  const ctx: VPNServiceContext = {
    config,
    nodes: new Map(),
    sessions: new Map(),
    contributions: new Map(),
  };

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok', service: 'vpn' }));

  // Version info
  app.get('/version', (c) => c.json({
    name: 'Jeju VPN',
    version: '1.0.0',
    protocols: ['wireguard', 'socks5', 'http-connect'],
    features: ['x402', 'a2a', 'mcp', 'fair-contribution'],
  }));

  // Mount REST API
  app.route('/api/v1', createRESTRouter(ctx));

  // Mount x402 payment endpoints
  app.route('/x402', createX402Middleware(ctx));

  // Mount A2A protocol
  app.route('/a2a', createA2ARouter(ctx));

  // Mount MCP protocol
  app.route('/mcp', createMCPRouter(ctx));

  // Agent card for A2A discovery
  app.get('/.well-known/agent-card.json', (c) => c.json({
    protocolVersion: '1.0',
    name: 'Jeju VPN Agent',
    description: 'Decentralized VPN service with fair contribution model',
    url: config.publicUrl,
    provider: {
      organization: 'Jeju Network',
      url: 'https://jeju.network',
    },
    version: '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    skills: [
      {
        id: 'vpn_connect',
        name: 'Connect to VPN',
        description: 'Establish a VPN connection through the Jeju network',
        inputs: {
          countryCode: { type: 'string', description: 'Target country (e.g., US, NL, JP)' },
          protocol: { type: 'string', description: 'VPN protocol (wireguard, socks5)', default: 'wireguard' },
        },
        outputs: {
          connectionId: 'string',
          endpoint: 'string',
          publicKey: 'string',
        },
        paymentRequired: false, // Free tier available
      },
      {
        id: 'vpn_disconnect',
        name: 'Disconnect VPN',
        description: 'End the current VPN session',
        inputs: {
          connectionId: { type: 'string', description: 'Connection ID to disconnect' },
        },
        outputs: {
          success: 'boolean',
          bytesTransferred: 'number',
        },
      },
      {
        id: 'get_nodes',
        name: 'List VPN Nodes',
        description: 'Get available VPN exit nodes',
        inputs: {
          countryCode: { type: 'string', description: 'Filter by country', optional: true },
        },
        outputs: {
          nodes: 'array',
        },
      },
      {
        id: 'proxy_request',
        name: 'Proxy HTTP Request',
        description: 'Make an HTTP request through the VPN network',
        inputs: {
          url: { type: 'string', description: 'Target URL' },
          method: { type: 'string', description: 'HTTP method', default: 'GET' },
          headers: { type: 'object', description: 'Request headers', optional: true },
          body: { type: 'string', description: 'Request body', optional: true },
          countryCode: { type: 'string', description: 'Exit country', optional: true },
        },
        outputs: {
          status: 'number',
          headers: 'object',
          body: 'string',
        },
        paymentRequired: true, // Requires x402 payment
      },
      {
        id: 'get_contribution',
        name: 'Get Contribution Status',
        description: 'Get your fair contribution quota status',
        inputs: {},
        outputs: {
          bytesUsed: 'number',
          bytesContributed: 'number',
          quotaRemaining: 'number',
        },
      },
    ],
  }));

  return app;
}

export type { VPNServerConfig, VPNServiceContext } from './types';

