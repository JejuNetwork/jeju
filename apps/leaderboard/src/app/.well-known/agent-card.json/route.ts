import { NextResponse } from 'next/server';

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://jejunetwork.github.io';

export async function GET() {
  return NextResponse.json({
    protocolVersion: '0.3.0',
    name: 'Jeju Leaderboard',
    description: 'Contributor analytics and rankings for the Jeju Network',
    url: `${BASE_URL}/api/a2a`,
    preferredTransport: 'http',
    provider: { organization: 'Jeju Network', url: 'https://jeju.network' },
    version: '1.0.0',
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['text', 'data'],
    defaultOutputModes: ['text', 'data'],
    skills: [
      { id: 'get-leaderboard', name: 'Get Leaderboard', description: 'Fetch contributor rankings', tags: ['query'], examples: ['Show leaderboard'] },
      { id: 'get-contributor-profile', name: 'Get Contributor', description: 'Get contributor profile and stats', tags: ['query'], examples: ['Show profile'] },
      { id: 'get-repo-stats', name: 'Get Repo Stats', description: 'Repository contribution statistics', tags: ['query'], examples: ['Repo stats'] }
    ]
  }, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

