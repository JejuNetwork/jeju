'use client';

import { useState, useEffect } from 'react';
import { useGameFeed } from '@/hooks/markets/useGameFeed';
import { EXPLORER_URL } from '@/config';

interface GameFeedPanelProps {
  sessionId: string;
  className?: string;
}

export function GameFeedPanel({ sessionId, className = '' }: GameFeedPanelProps) {
  const { posts, marketUpdates, loading, error } = useGameFeed(sessionId);

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-8 bg-gray-700 rounded mb-4"></div>
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-900/20 border border-red-700 rounded-lg p-4 ${className}`}>
        <p className="text-red-400">Failed to load game feed: {error.message}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-white">Game Feed</h3>
        <div className="text-sm text-slate-400">
          {posts.length} posts • Live from blockchain
        </div>
      </div>

      {marketUpdates.length > 0 && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <div className="text-sm text-slate-400 mb-2">Latest Market Odds</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">
                {marketUpdates[0].yesOdds}%
              </div>
              <div className="text-xs text-slate-400">YES</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">
                {marketUpdates[0].noOdds}%
              </div>
              <div className="text-xs text-slate-400">NO</div>
            </div>
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">
            Day {marketUpdates[0].gameDay} • Volume: {Number(marketUpdates[0].totalVolume) / 1e18} ETH
          </div>
        </div>
      )}

      <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
        {posts.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">📭</div>
            <p>No posts yet. Game feed will appear here in real-time.</p>
          </div>
        ) : (
          posts.map((post) => (
            <div
              key={post.id}
              className={`rounded-lg border p-4 ${
                post.isSystemMessage
                  ? 'bg-blue-900/20 border-blue-700'
                  : 'bg-gray-800 border-gray-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                  {post.author.slice(2, 4).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white">
                    {post.author.slice(0, 6)}...{post.author.slice(-4)}
                  </div>
                  <div className="text-xs text-slate-400">
                    Day {post.gameDay} • {new Date(post.timestamp).toLocaleTimeString()}
                  </div>
                </div>
                {post.isSystemMessage && (
                  <span className="px-2 py-1 rounded text-xs bg-blue-700 text-blue-200">
                    System
                  </span>
                )}
              </div>

              <p className="text-gray-200 leading-relaxed">{post.content}</p>

              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>Block {post.blockNumber.toString()}</span>
                <span>•</span>
                <a
                  href={`${EXPLORER_URL}/tx/${post.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-blue-400 transition-colors"
                >
                  View on Explorer ↗
                </a>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="text-xs text-slate-500 text-center pt-2 border-t border-gray-700">
        On-chain feed powered by GameFeedOracle • Updates in real-time
      </div>
    </div>
  );
}

