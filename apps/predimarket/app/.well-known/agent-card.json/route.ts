/**
 * Agent Card endpoint for Predimarket
 * ERC-8004 / A2A service discovery
 */

import { NextResponse } from 'next/server';

export async function GET() {
  const serverUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:4007';

  const agentCard = {
    protocolVersion: '0.3.0',
    name: 'Predimarket - Prediction Markets',
    description: 'Futarchy-based prediction markets on Jeju with Hyperscape integration',
    url: `${serverUrl}/api/a2a`,
    preferredTransport: 'http',
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
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      {
        id: 'list-markets',
        name: 'List Prediction Markets',
        description: 'Get all active prediction markets',
        tags: ['query', 'markets', 'predictions'],
        examples: ['Show me prediction markets', 'List all markets', 'What can I bet on?'],
      },
      {
        id: 'get-market-odds',
        name: 'Get Market Odds',
        description: 'Get current odds for a specific market',
        tags: ['query', 'markets', 'odds'],
        examples: ['What are the odds for market X?', 'Show market odds'],
      },
      {
        id: 'list-user-positions',
        name: 'List User Positions',
        description: 'Get user market positions and potential winnings',
        tags: ['query', 'portfolio', 'positions'],
        examples: ['Show my positions', 'What are my bets?', 'My portfolio'],
      },
    ],
  };

  return NextResponse.json(agentCard);
}


