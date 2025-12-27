/**
 * Profile Detail Page
 * Converted from Next.js to React Router
 */

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'

interface ProfileInfo {
  id: string
  name: string
  username?: string
  bio?: string
  profileImageUrl?: string
  stats?: {
    followers: number
    following: number
    posts: number
  }
}

export default function ProfileDetailPage() {
  const { id: rawId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const identifier = rawId ? decodeURIComponent(rawId) : ''

  useEffect(() => {
    if (!identifier) {
      navigate('/', { replace: true })
    }
  }, [identifier, navigate])

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile', identifier],
    queryFn: async (): Promise<ProfileInfo | null> => {
      const response = await fetch(
        `/api/users/${encodeURIComponent(identifier)}/profile`,
      )
      if (!response.ok) return null
      const data = await response.json()
      return data.user as ProfileInfo
    },
    enabled: !!identifier,
  })

  if (!identifier) return null

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="max-w-2xl mx-auto">
        <Link
          to="/"
          className="text-sm mb-4 inline-flex items-center gap-2"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div className="card p-8 text-center">
          <h1
            className="text-2xl font-bold mb-4"
            style={{ color: 'var(--text-primary)' }}
          >
            Profile Not Found
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            User &quot;{identifier}&quot; not found
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto">
      <Link
        to="/"
        className="text-sm mb-4 inline-flex items-center gap-2"
        style={{ color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Link>

      <div className="card p-6">
        <div className="flex items-center gap-4 mb-6">
          {profile.profileImageUrl ? (
            <img
              src={profile.profileImageUrl}
              alt={profile.name}
              className="w-20 h-20 rounded-full object-cover"
            />
          ) : (
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              {profile.name.charAt(0) ?? '?'}
            </div>
          )}
          <div>
            <h1
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {profile.name}
            </h1>
            {profile.username && (
              <p style={{ color: 'var(--text-tertiary)' }}>
                @{profile.username}
              </p>
            )}
          </div>
        </div>

        {profile.bio && (
          <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
            {profile.bio}
          </p>
        )}

        {profile.stats && (
          <div className="grid grid-cols-3 gap-4">
            <div
              className="text-center p-3 rounded-lg"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {profile.stats.posts}
              </div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Posts
              </div>
            </div>
            <div
              className="text-center p-3 rounded-lg"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {profile.stats.followers}
              </div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Followers
              </div>
            </div>
            <div
              className="text-center p-3 rounded-lg"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <div
                className="text-xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {profile.stats.following}
              </div>
              <div
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Following
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
