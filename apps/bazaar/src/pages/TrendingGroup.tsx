/**
 * Grouped Trending Page
 * Converted from Next.js to React Router
 */

import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { LoadingSpinner } from '../../components/LoadingSpinner'

interface PostData {
  id: string
  content: string
  authorId: string
  authorName: string
  authorUsername?: string | null
  timestamp: string
  likeCount?: number
  commentCount?: number
}

interface TagInfo {
  id: string
  displayName: string
  category: string | null
}

interface TrendingGroupResponse {
  success: boolean
  posts: PostData[]
  tags: TagInfo[]
}

export default function TrendingGroupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const tagsParam = searchParams.get('tags') || ''

  const { data, isLoading: loading } = useQuery({
    queryKey: ['trending', 'group', tagsParam],
    queryFn: async (): Promise<{ posts: PostData[]; tags: TagInfo[] }> => {
      if (!tagsParam) {
        return { posts: [], tags: [] }
      }

      const response = await fetch(
        `/api/trending/group?tags=${tagsParam}&limit=50`,
      )

      if (!response.ok) {
        return { posts: [], tags: [] }
      }

      const result = (await response.json()) as TrendingGroupResponse

      if (result.success) {
        return { posts: result.posts || [], tags: result.tags || [] }
      }

      return { posts: [], tags: [] }
    },
    enabled: !!tagsParam,
  })

  const posts = data?.posts ?? []
  const tags = data?.tags ?? []

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Go back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1
            className="text-xl font-bold"
            style={{ color: 'var(--text-primary)' }}
          >
            {tags.length > 0
              ? tags.map((t) => t.displayName).join(' • ')
              : 'Grouped Trending'}
          </h1>
          {tags.length > 0 && tags[0]?.category && (
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              {tags[0].category}
            </p>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12">
          <h2
            className="text-xl font-semibold mb-2"
            style={{ color: 'var(--text-primary)' }}
          >
            No posts found
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            No posts found for these trending topics yet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map((post) => (
            <div key={post.id} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {post.authorName}
                </span>
                {post.authorUsername && (
                  <span style={{ color: 'var(--text-tertiary)' }}>
                    @{post.authorUsername}
                  </span>
                )}
              </div>
              <p style={{ color: 'var(--text-secondary)' }}>{post.content}</p>
              <div
                className="flex gap-4 mt-2 text-sm"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <span>{post.likeCount || 0} likes</span>
                <span>{post.commentCount || 0} comments</span>
              </div>
            </div>
          ))}

          {posts.length > 0 && (
            <div
              className="text-center py-4 text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              You're all caught up.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
