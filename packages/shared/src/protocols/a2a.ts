/**
 * A2A Server Factory - Agent-to-Agent Protocol
 * 
 * Creates A2A servers for dApps.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getNetworkName, getWebsiteUrl } from '@jejunetwork/config';
import type { Address } from 'viem';
import type { A2ASkill } from './server';
import type { JsonRpcId, ProtocolData } from '../types';

export interface A2AConfig {
  name: string;
  description: string;
  version?: string;
  skills: A2ASkill[];
  executeSkill: (skillId: string, params: ProtocolData, address: Address) => Promise<A2AResult>;
}

export type { A2ASkill };

export interface A2AResult {
  message: string;
  data: ProtocolData;
}

export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  preferredTransport: string;
  provider: { organization: string; url: string };
  version: string;
  capabilities: {
    streaming: boolean;
    pushNotifications: boolean;
    stateTransitionHistory: boolean;
  };
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2ASkill[];
}

export function createA2AServer(config: A2AConfig): Hono {
  const app = new Hono();
  app.use('/*', cors());

  const agentCard: AgentCard = {
    protocolVersion: '0.3.0',
    name: config.name,
    description: config.description,
    url: '/a2a',
    preferredTransport: 'http',
    provider: { organization: getNetworkName(), url: getWebsiteUrl() },
    version: config.version || '1.0.0',
    capabilities: {
      streaming: false,
      pushNotifications: true,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: config.skills,
  };

  // Agent card discovery
  app.get('/.well-known/agent-card.json', (c) => c.json(agentCard));

  // Main A2A endpoint
  app.post('/', async (c) => {
    interface A2ARequest {
      jsonrpc: string;
      method: string;
      params?: {
        message?: {
          messageId: string;
          parts: Array<{ kind: string; text?: string; data?: ProtocolData }>;
        };
      };
      id: JsonRpcId;
    }

    const body = await c.req.json() as A2ARequest;
    const address = c.req.header('x-jeju-address') as Address;

    if (body.method !== 'message/send') {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      });
    }

    if (!address) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: 401, message: 'Authentication required' },
      });
    }

    const dataPart = body.params?.message?.parts?.find(p => p.kind === 'data');
    if (!dataPart?.data) {
      return c.json({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32602, message: 'No data part found in message' },
      });
    }
    const skillId = dataPart.data.skillId as string;
    const params = dataPart.data;

    const result = await config.executeSkill(skillId, params, address);

    return c.json({
      jsonrpc: '2.0',
      id: body.id,
      result: {
        role: 'agent',
        parts: [
          { kind: 'text', text: result.message },
          { kind: 'data', data: result.data },
        ],
        messageId: body.params?.message?.messageId ?? `msg-${Date.now()}`,
        kind: 'message',
      },
    });
  });

  return app;
}
