/**
 * Character Detail Page
 */

import { Link, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useCharacter } from '../hooks'

export default function CharacterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: character, isLoading, error } = useCharacter(id ?? '')

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error || !character) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <p style={{ color: 'var(--color-error)' }}>
          {error?.message ?? 'Character not found'}
        </p>
        <Link to="/characters" className="btn-secondary mt-4 inline-block">
          Back to Characters
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link
          to="/characters"
          className="text-sm flex items-center gap-1 mb-4"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Back to Characters
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-3xl font-bold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {character.name}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              {character.description}
            </p>
          </div>
          <Link to={`/chat?character=${id}`} className="btn-primary">
            Start Chat
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bio */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Bio
          </h2>
          <ul className="space-y-2">
            {character.bio.map((line) => (
              <li
                key={line}
                className="flex items-start gap-2 text-sm"
                style={{ color: 'var(--text-secondary)' }}
              >
                <span style={{ color: 'var(--color-primary)' }}>•</span>
                {line}
              </li>
            ))}
          </ul>
        </div>

        {/* Topics */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Topics
          </h2>
          <div className="flex flex-wrap gap-2">
            {character.topics.map((topic) => (
              <span key={topic} className="badge-info">
                {topic}
              </span>
            ))}
          </div>
        </div>

        {/* Adjectives */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Personality
          </h2>
          <div className="flex flex-wrap gap-2">
            {character.adjectives.map((adj) => (
              <span key={adj} className="badge-purple">
                {adj}
              </span>
            ))}
          </div>
        </div>

        {/* Style */}
        <div className="card-static p-6">
          <h2
            className="text-lg font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Communication Style
          </h2>
          <div className="space-y-3">
            <div>
              <p
                className="text-xs font-medium mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                General
              </p>
              <div className="flex flex-wrap gap-1">
                {character.style.all.slice(0, 5).map((s) => (
                  <span key={s} className="badge-accent text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <p
                className="text-xs font-medium mb-1"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Chat
              </p>
              <div className="flex flex-wrap gap-1">
                {character.style.chat.slice(0, 5).map((s) => (
                  <span key={s} className="badge-primary text-xs">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* System Prompt */}
      <div className="mt-6 card-static p-6">
        <h2
          className="text-lg font-bold mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          System Prompt
        </h2>
        <pre
          className="text-sm font-mono p-4 rounded-xl overflow-x-auto whitespace-pre-wrap"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
          }}
        >
          {character.system}
        </pre>
      </div>
    </div>
  )
}
