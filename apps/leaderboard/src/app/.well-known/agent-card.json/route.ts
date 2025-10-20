import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Leaderboard',
    description: 'Contributor analytics and rankings',
    url: 'http://localhost:5012/api/a2a',
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { id: 'get-leaderboard', name: 'Get Leaderboard', description: 'Fetch rankings', tags: ['query'], examples: ['Show leaderboard'] },
      { id: 'get-contributor-profile', name: 'Get Contributor', description: 'Get contributor data', tags: ['query'], examples: ['Show profile'] },
      { id: 'get-repo-stats', name: 'Get Repo Stats', description: 'Repository statistics', tags: ['query'], examples: ['Repo stats'] },
      { id: 'claim-rewards', name: 'Claim Rewards', description: 'Claim contributor rewards', tags: ['action'], examples: ['Claim rewards'] }
    ]
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

