/**
 * Trending Tag Page
 * Converted from Next.js to React Router
 */

import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { LoadingSpinner } from '../components/LoadingSpinner'

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
  name: string
  displayName: string
  category?: string | null
}

interface TrendingResponse {
  success: boolean
  tag?: TagInfo
  posts: PostData[]
}

const PAGE_SIZE = 20

export default function TrendingTagPage() {
  const { tag } = useParams<{ tag?: string }>()
  const navigate = useNavigate()

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    hasNextPage: hasMore,
    fetchNextPage,
  } = useInfiniteQuery({
    queryKey: ['trending', tag],
    queryFn: async ({ pageParam = 0 }) => {
      const response = await fetch(
        `/api/trending/${encodeURIComponent(tag || '')}?limit=${PAGE_SIZE}&offset=${pageParam}`,
      )

      if (!response.ok) {
        throw new Error('Failed to fetch posts')
      }

      const responseData = (await response.json()) as TrendingResponse
      return {
        posts: responseData.posts || [],
        tag: responseData.tag,
        nextOffset: pageParam + (responseData.posts?.length || 0),
        hasMore: (responseData.posts?.length || 0) === PAGE_SIZE,
      }
    },
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.nextOffset : undefined,
    initialPageParam: 0,
    enabled: !!tag,
  })

  const { posts, tagInfo } = useMemo(() => {
    if (!data?.pages) {
      return { posts: [] as PostData[], tagInfo: null as TagInfo | null }
    }

    const firstPageTag = data.pages[0]?.tag ?? null
    const allPosts = data.pages.flatMap((page) => page.posts)
    const unique = new Map<string, PostData>()
    allPosts.forEach((post: PostData) => {
      if (post?.id) {
        unique.set(post.id, post)
      }
    })

    const deduped = Array.from(unique.values()).sort((a, b) => {
      const aTime = new Date(a.timestamp).getTime()
      const bTime = new Date(b.timestamp).getTime()
      return bTime - aTime
    })

    return { posts: deduped, tagInfo: firstPageTag }
  }, [data])

  useEffect(() => {
    if (!tag) {
      navigate('/trending', { replace: true })
    }
  }, [tag, navigate])

  if (!tag) {
    return null
  }

  const handleLoadMore = () => {
    if (!loading && !loadingMore && hasMore) {
      fetchNextPage()
    }
  }

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
          {tagInfo ? (
            <>
              <h1
                className="text-2xl font-bold"
                style={{ color: 'var(--text-primary)' }}
              >
                {tagInfo.displayName}
              </h1>
              {tagInfo.category && (
                <p
                  className="text-sm"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {tagInfo.category} · Trending
                </p>
              )}
            </>
          ) : (
            <h1
              className="text-2xl font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              {decodeURIComponent(tag)}
            </h1>
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
            No posts have been tagged with &quot;{tagInfo?.displayName || tag}
            &quot; yet.
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

          {hasMore && (
            <div className="text-center py-4">
              {loadingMore ? (
                <LoadingSpinner size="sm" />
              ) : (
                <button
                  type="button"
                  onClick={handleLoadMore}
                  className="btn-primary"
                >
                  Load More
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
