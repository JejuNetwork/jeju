/**
 * Character Card Component
 */

import { Link } from 'react-router-dom'
import type { Character, CharacterWithRuntime } from '../hooks'

interface CharacterCardProps {
  character: Character | CharacterWithRuntime
  showRuntime?: boolean
  onSelect?: (id: string) => void
}

const TEAM_COLORS: Record<string, { bg: string; text: string; badge: string }> =
  {
    'red-team': {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: '#EF4444',
      badge: 'Red Team',
    },
    scammer: {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: '#EF4444',
      badge: 'Red Team',
    },
    'security-researcher': {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: '#EF4444',
      badge: 'Red Team',
    },
    'contracts-expert': {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: '#EF4444',
      badge: 'Red Team',
    },
    'fuzz-tester': {
      bg: 'rgba(239, 68, 68, 0.1)',
      text: '#EF4444',
      badge: 'Red Team',
    },
    'blue-team': {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: '#3B82F6',
      badge: 'Blue Team',
    },
    moderator: {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: '#3B82F6',
      badge: 'Blue Team',
    },
    'network-guardian': {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: '#3B82F6',
      badge: 'Blue Team',
    },
    'contracts-auditor': {
      bg: 'rgba(59, 130, 246, 0.1)',
      text: '#3B82F6',
      badge: 'Blue Team',
    },
  }

const ICONS: Record<string, string> = {
  'project-manager': '📊',
  'community-manager': '👥',
  devrel: '🛠️',
  liaison: '🤝',
  'social-media-manager': '📱',
  'red-team': '🔴',
  scammer: '🎭',
  'security-researcher': '🔍',
  'contracts-expert': '📜',
  'fuzz-tester': '🧪',
  'blue-team': '🔵',
  moderator: '🛡️',
  'network-guardian': '⚔️',
  'contracts-auditor': '📋',
}

export function CharacterCard({
  character,
  showRuntime = false,
  onSelect,
}: CharacterCardProps) {
  const team = TEAM_COLORS[character.id]
  const icon = ICONS[character.id] ?? '🤖'
  const hasRuntime = 'hasRuntime' in character ? character.hasRuntime : false

  const content = (
    <div className="card p-6 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div className="text-4xl">{icon}</div>
        <div className="flex flex-col items-end gap-2">
          {team && (
            <span
              className="badge"
              style={{ backgroundColor: team.bg, color: team.text }}
            >
              {team.badge}
            </span>
          )}
          {showRuntime && (
            <span className={hasRuntime ? 'badge-success' : 'badge-warning'}>
              {hasRuntime ? 'Active' : 'Inactive'}
            </span>
          )}
        </div>
      </div>
      <h3
        className="text-lg font-bold mb-2"
        style={{ color: 'var(--text-primary)' }}
      >
        {character.name}
      </h3>
      <p
        className="text-sm line-clamp-3 flex-1"
        style={{ color: 'var(--text-secondary)' }}
      >
        {character.description}
      </p>
      <div
        className="mt-4 pt-4 border-t"
        style={{ borderColor: 'var(--border)' }}
      >
        <code
          className="text-xs font-mono px-2 py-1 rounded"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-tertiary)',
          }}
        >
          {character.id}
        </code>
      </div>
    </div>
  )

  if (onSelect) {
    return (
      <button
        type="button"
        onClick={() => onSelect(character.id)}
        className="text-left w-full"
      >
        {content}
      </button>
    )
  }

  return <Link to={`/characters/${character.id}`}>{content}</Link>
}
