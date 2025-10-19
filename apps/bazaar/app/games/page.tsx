'use client'

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

interface RegisteredGame {
  id: string;
  agentId: number;
  name: string;
  tags: string[];
  totalPlayers?: number;
  totalItems?: number;
}

async function getRegisteredGames() {
  const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || 'http://localhost:4350/graphql';
  
  const query = `
    query GetGames {
      registeredGames(where: { active_eq: true }, orderBy: registeredAt_DESC) {
        id
        agentId
        name
        tags
        gameType
        totalPlayers
        totalItemsMinted
      }
    }
  `;
  
  const response = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  
  const result = await response.json();
  return result.data?.registeredGames || [];
}

export default function GamesPage() {
  const { data: games = [], isLoading } = useQuery({
    queryKey: ['registered-games'],
    queryFn: getRegisteredGames,
    refetchInterval: 10000,
  });
  
  const rpgGames = games.filter((g: RegisteredGame) => g.tags.includes('rpg'));
  const otherGames = games.filter((g: RegisteredGame) => !g.tags.includes('rpg'));
  
  return (
    <div>
      <h1 className="text-4xl font-bold mb-2">Onchain Games</h1>
      <p className="text-slate-400 mb-8">
        Discover games registered to Jeju's decentralized game registry
      </p>
      
      {isLoading && (
        <div className="text-center py-20 text-slate-400">Loading games...</div>
      )}
      
      {!isLoading && games.length === 0 && (
        <div className="text-center py-20">
          <div className="text-6xl mb-4">🎮</div>
          <h3 className="text-2xl font-semibold mb-2">No Games Yet</h3>
          <p className="text-slate-400">
            Be the first to register a game to the Jeju registry
          </p>
        </div>
      )}
      
      {/* RPG Games Section */}
      {rpgGames.length > 0 && (
        <section className="mb-12">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-3xl font-bold">🗡️ RPG Games</h2>
            <span className="px-3 py-1 bg-purple-600/20 text-purple-400 rounded-full text-sm">
              Interoperable
            </span>
          </div>
          <p className="text-slate-400 mb-6">
            All RPG games share compatible items and gold - trade across games!
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rpgGames.map((game: RegisteredGame) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}
      
      {/* Other Games */}
      {otherGames.length > 0 && (
        <section>
          <h2 className="text-3xl font-bold mb-6">🎲 Other Games</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {otherGames.map((game: RegisteredGame) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function GameCard({ game }: { game: RegisteredGame }) {
  return (
    <Link href={`/games/${game.id}`}>
      <div className="p-6 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all hover:scale-105 cursor-pointer">
        <h3 className="text-xl font-bold mb-2">{game.name}</h3>
        
        <div className="flex flex-wrap gap-2 mb-4">
          {game.tags.map(tag => (
            <span key={tag} className="px-2 py-1 bg-white/10 rounded text-xs">
              {tag}
            </span>
          ))}
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-400">Players</div>
            <div className="font-semibold">{game.totalPlayers || 0}</div>
          </div>
          <div>
            <div className="text-slate-400">Items</div>
            <div className="font-semibold">{game.totalItems || 0}</div>
          </div>
        </div>
      </div>
    </Link>
  );
}

