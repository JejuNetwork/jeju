'use client';

/**
 * @deprecated This component is vendor-specific and maintained in vendor/hyperscape/components/.
 * This copy remains for backwards compatibility. For new development,
 * use the component from vendor/hyperscape/components/HyperscapeStatsPanel.tsx
 */

import { useState } from 'react';
import { usePlayerEvents } from '@/hooks/markets/usePlayerEvents';

interface HyperscapeStatsPanelProps {
  playerAddress?: string;
  className?: string;
}

/**
 * Game stats panel component
 * 
 * @deprecated Use vendor/hyperscape/components/HyperscapeStatsPanel.tsx for new development
 * 
 * Uses generic player events hook - works with any Jeju-integrated game
 */
export function HyperscapeStatsPanel({ playerAddress, className = '' }: HyperscapeStatsPanelProps) {
  const [selectedTab, setSelectedTab] = useState<'skills' | 'combat' | 'achievements'>('skills');
  const { skillEvents, deathEvents, killEvents, achievements, playerStats, loading, error } = usePlayerEvents(playerAddress);

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="h-8 bg-gray-700 rounded mb-4"></div>
        <div className="grid grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-900/20 border border-red-700 rounded-lg p-4 ${className}`}>
        <p className="text-red-400">Failed to load Hyperscape stats: {error.message}</p>
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-bold text-white">Hyperscape Stats</h3>
        {playerAddress && (
          <div className="text-xs text-slate-400">
            {playerAddress.slice(0, 6)}...{playerAddress.slice(-4)}
          </div>
        )}
      </div>

      {playerStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{playerStats.totalSkillEvents}</div>
            <div className="text-xs text-slate-400">Level-Ups</div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{playerStats.totalKills}</div>
            <div className="text-xs text-slate-400">Kills</div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-red-400">{playerStats.totalDeaths}</div>
            <div className="text-xs text-slate-400">Deaths</div>
          </div>
          <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 text-center">
            <div className="text-2xl font-bold text-purple-400">{playerStats.totalAchievements}</div>
            <div className="text-xs text-slate-400">Achievements</div>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-b border-gray-700">
        <button
          onClick={() => setSelectedTab('skills')}
          className={`px-4 py-2 font-medium transition-colors ${
            selectedTab === 'skills'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-gray-200'
          }`}
        >
          Skills ({skillEvents.length})
        </button>
        <button
          onClick={() => setSelectedTab('combat')}
          className={`px-4 py-2 font-medium transition-colors ${
            selectedTab === 'combat'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-gray-200'
          }`}
        >
          Combat ({deathEvents.length + killEvents.length})
        </button>
        <button
          onClick={() => setSelectedTab('achievements')}
          className={`px-4 py-2 font-medium transition-colors ${
            selectedTab === 'achievements'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-slate-400 hover:text-gray-200'
          }`}
        >
          Achievements ({achievements.length})
        </button>
      </div>

      <div className="max-h-[500px] overflow-y-auto">
        {selectedTab === 'skills' && (
          <div className="space-y-2">
            {skillEvents.length === 0 ? (
              <p className="text-center py-8 text-slate-400">No skill events yet</p>
            ) : (
              skillEvents.map((event) => (
                <div
                  key={event.id}
                  className="bg-gray-800 rounded-lg border border-gray-700 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="text-2xl">⬆️</div>
                      <div>
                        <div className="text-sm font-semibold text-white capitalize">
                          {event.skillName} Level {event.newLevel}
                        </div>
                        <div className="text-xs text-slate-400">
                          {Number(event.totalXp).toLocaleString()} XP
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {selectedTab === 'combat' && (
          <div className="space-y-2">
            {killEvents.map((event) => (
              <div
                key={event.id}
                className="bg-green-900/20 rounded-lg border border-green-700 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl">⚔️</div>
                    <div>
                      <div className="text-sm font-semibold text-green-400">
                        Kill ({event.method})
                      </div>
                      <div className="text-xs text-slate-400">
                        Victim: {event.victim.slice(0, 6)}...{event.victim.slice(-4)}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {deathEvents.map((event) => (
              <div
                key={event.id}
                className="bg-red-900/20 rounded-lg border border-red-700 p-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="text-2xl">💀</div>
                    <div>
                      <div className="text-sm font-semibold text-red-400">Death</div>
                      <div className="text-xs text-slate-400">
                        {event.killer ? `Killed by ${event.killer.slice(0, 6)}...` : 'Environmental'} • {event.location}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-slate-500">
                    {new Date(event.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
            {killEvents.length === 0 && deathEvents.length === 0 && (
              <p className="text-center py-8 text-slate-400">No combat events yet</p>
            )}
          </div>
        )}

        {selectedTab === 'achievements' && (
          <div className="space-y-2">
            {achievements.length === 0 ? (
              <p className="text-center py-8 text-slate-400">No achievements yet</p>
            ) : (
              achievements.map((event) => (
                <div
                  key={event.id}
                  className="bg-purple-900/20 rounded-lg border border-purple-700 p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="text-2xl">🏆</div>
                      <div>
                        <div className="text-sm font-semibold text-purple-400 capitalize">
                          {event.achievementType}
                        </div>
                        <div className="text-xs text-slate-400">
                          Score: {event.value}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-500">
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="text-xs text-slate-500 text-center pt-2 border-t border-gray-700">
        Powered by HyperscapeOracle • Real-time on-chain events
      </div>
    </div>
  );
}



