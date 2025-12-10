'use client'

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { INDEXER_URL } from '@/config';

interface RegisteredGame {
  id: string
  agentId: number
  name: string
  tags: string[]
  totalPlayers?: number
  totalItems?: number
}

async function getRegisteredGames() {
  
  const query = `
    query GetGames {
      registeredGames(where: { active_eq: true }, orderBy: registeredAt_DESC) {
        id
        agentId
        name
        tags
        totalPlayers
        totalItems
      }
    }
  `;
  
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    next: { revalidate: 10 },
  });
  
  const result = await response.json();
  return result.data?.registeredGames || [];
}

export default function GamesPage() {
  const { data: games = [], isLoading } = useQuery({
    queryKey: ['registered-games'],
    queryFn: getRegisteredGames,
  });

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          🎮 Games & Applications
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Decentralized games and applications registered on Jeju via ERC-8004
        </p>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--color-primary)' }} />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && games.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl md:text-7xl mb-4">🎮</div>
          <h3 className="text-xl md:text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
            No Games Yet
          </h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Games will appear here once registered via ERC-8004
          </p>
        </div>
      )}

      {/* Games Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {games.map((game: RegisteredGame) => (
          <div key={game.id} className="card p-5 md:p-6 group">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-bazaar-accent to-emerald-600 flex items-center justify-center text-2xl md:text-3xl mb-4 group-hover:scale-110 transition-transform">
              🎮
            </div>
            
            <h3 className="text-xl md:text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
              {game.name}
            </h3>
            
            {/* Tags */}
            {game.tags && game.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {game.tags.map((tag, i) => (
                  <span key={i} className="badge-primary">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Stats */}
            <div className="space-y-1 text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {game.totalPlayers !== undefined && (
                <div>👥 {game.totalPlayers} players</div>
              )}
              {game.totalItems !== undefined && (
                <div>🎁 {game.totalItems} items</div>
              )}
              <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Agent ID: {game.agentId}
              </div>
            </div>

            <Link
              href={`https://jeju.network/agent/${game.agentId}`}
              target="_blank"
              className="btn-primary w-full text-center"
            >
              View Game →
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
