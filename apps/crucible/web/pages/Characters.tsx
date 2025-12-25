/**
 * Characters Page
 */

import { CharacterCard } from '../components/CharacterCard'
import { LoadingSpinner } from '../components/LoadingSpinner'
import { useCharacters } from '../hooks'

export default function CharactersPage() {
  const { data: characters, isLoading, error } = useCharacters()

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="text-4xl mb-4">⚠️</div>
        <p style={{ color: 'var(--color-error)' }}>{error.message}</p>
      </div>
    )
  }

  // Group by team
  const redTeam =
    characters?.filter((c) =>
      [
        'red-team',
        'scammer',
        'security-researcher',
        'contracts-expert',
        'fuzz-tester',
      ].includes(c.id),
    ) ?? []
  const blueTeam =
    characters?.filter((c) =>
      [
        'blue-team',
        'moderator',
        'network-guardian',
        'contracts-auditor',
      ].includes(c.id),
    ) ?? []
  const general =
    characters?.filter(
      (c) =>
        ![
          'red-team',
          'scammer',
          'security-researcher',
          'contracts-expert',
          'fuzz-tester',
          'blue-team',
          'moderator',
          'network-guardian',
          'contracts-auditor',
        ].includes(c.id),
    ) ?? []

  return (
    <div>
      <div className="mb-8">
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--text-primary)' }}
        >
          Characters
        </h1>
        <p style={{ color: 'var(--text-secondary)' }}>
          Pre-built agent templates for common tasks. Click to view details or
          start a chat.
        </p>
      </div>

      {/* General Purpose */}
      {general.length > 0 && (
        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>🤖</span> General Purpose
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {general.map((character) => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        </section>
      )}

      {/* Red Team */}
      {redTeam.length > 0 && (
        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>🔴</span> Red Team (Adversarial)
          </h2>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Security testing agents for adversarial scenarios
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {redTeam.map((character) => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        </section>
      )}

      {/* Blue Team */}
      {blueTeam.length > 0 && (
        <section className="mb-10">
          <h2
            className="text-xl font-bold mb-4 flex items-center gap-2"
            style={{ color: 'var(--text-primary)' }}
          >
            <span>🔵</span> Blue Team (Defensive)
          </h2>
          <p
            className="text-sm mb-4"
            style={{ color: 'var(--text-secondary)' }}
          >
            Defense and moderation agents for system protection
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {blueTeam.map((character) => (
              <CharacterCard key={character.id} character={character} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
