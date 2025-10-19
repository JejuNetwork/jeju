/**
 * Agent Card Generator
 * Creates the .well-known/agent-card.json endpoint for ERC-8004
 */

import type { AgentCard } from './types';

export function generateAgentCard(agentName: string, serverUrl: string): AgentCard {
  return {
    name: agentName,
    description: `Elizagotchi AI Agent - ${agentName}`,
    version: '1.0.0',
    capabilities: [
      'chat',
      'erc8004-discovery',
      'service-connection',
      'autonomous-exploration'
    ],
    endpoints: {
      websocket: `${serverUrl}/ws`,
      rest: `${serverUrl}/api`
    },
    metadata: {
      type: 'ai-agent',
      platform: 'elizagotchi',
      runtime: 'elizaos'
    }
  };
}

/**
 * Express middleware to serve agent card
 */
export function agentCardMiddleware(agentName: string, serverUrl: string) {
  return (req: { path: string }, res: { json: (arg0: AgentCard) => void }) => {
    if (req.path === '/.well-known/agent-card.json') {
      const card = generateAgentCard(agentName, serverUrl);
      res.json(card);
    }
  };
}

