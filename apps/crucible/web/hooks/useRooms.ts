import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { API_URL } from '../config'

type RoomType = 'collaboration' | 'adversarial' | 'debate' | 'board'
type AgentRole =
  | 'participant'
  | 'moderator'
  | 'red_team'
  | 'blue_team'
  | 'observer'

interface RoomMember {
  agentId: string
  role: AgentRole
  joinedAt: number
  lastActiveAt: number
  score?: number
}

interface RoomConfig {
  maxMembers: number
  turnBased: boolean
  turnTimeout?: number
  visibility: 'public' | 'private' | 'members_only'
}

interface Room {
  roomId: string
  name: string
  description: string
  owner: string
  stateCid: string
  members: RoomMember[]
  roomType: RoomType
  config: RoomConfig
  active: boolean
  createdAt: number
  source?: 'onchain' | 'offchain'
}

interface RoomMessage {
  id: string
  agentId: string
  content: string
  timestamp: number
  action?: string
}

interface CreateRoomRequest {
  name: string
  description?: string
  roomType: RoomType
  config?: {
    maxMembers?: number
    turnBased?: boolean
    turnTimeout?: number
  }
}

interface CreateRoomResponse {
  roomId: string
  stateCid: string
}

interface RoomsSearchResponse {
  rooms: Room[]
  total: number
  hasMore: boolean
}

interface RoomSearchFilters {
  name?: string
  roomType?: RoomType
  active?: boolean
  limit?: number
}

const PAGE_SIZE = 20

export function useRooms(filters?: RoomSearchFilters) {
  const limit = filters?.limit ?? PAGE_SIZE

  return useInfiniteQuery({
    queryKey: ['rooms', filters],
    queryFn: async ({ pageParam = 0 }): Promise<RoomsSearchResponse> => {
      const params = new URLSearchParams()
      if (filters?.name) params.set('name', filters.name)
      if (filters?.roomType) params.set('roomType', filters.roomType)
      if (filters?.active !== undefined)
        params.set('active', String(filters.active))
      params.set('limit', String(limit))
      params.set('offset', String(pageParam))

      const response = await fetch(
        `${API_URL}/api/v1/rooms?${params.toString()}`,
      )
      if (!response.ok) throw new Error('Failed to fetch rooms')
      return response.json()
    },
    getNextPageParam: (lastPage, allPages) => {
      if (!lastPage.hasMore) return undefined
      return allPages.length * limit
    },
    initialPageParam: 0,
    select: (data) => ({
      rooms: data.pages.flatMap((page) => page.rooms),
      total: data.pages[0]?.total ?? 0,
      hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
    }),
  })
}

export function useRoom(roomId: string) {
  return useQuery({
    queryKey: ['room', roomId],
    queryFn: async (): Promise<Room> => {
      const response = await fetch(`${API_URL}/api/v1/rooms/${roomId}`)
      if (!response.ok) throw new Error('Failed to fetch room')
      const data = await response.json()
      return data.room
    },
    enabled: !!roomId,
  })
}

export function useRoomMessages(roomId: string, limit?: number) {
  return useQuery({
    queryKey: ['room-messages', roomId, limit],
    queryFn: async (): Promise<RoomMessage[]> => {
      const params = new URLSearchParams()
      if (limit) params.set('limit', String(limit))
      const response = await fetch(
        `${API_URL}/api/v1/rooms/${roomId}/messages?${params.toString()}`,
      )
      if (!response.ok) throw new Error('Failed to fetch messages')
      const data = await response.json()
      return data.messages
    },
    enabled: !!roomId,
    refetchInterval: 5000, // Poll for new messages
  })
}

export function useCreateRoom() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      request: CreateRoomRequest,
    ): Promise<CreateRoomResponse> => {
      const response = await fetch(`${API_URL}/api/v1/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to create room')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}

export function useJoinRoom() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roomId,
      agentId,
      role,
    }: {
      roomId: string
      agentId: string
      role: AgentRole
    }) => {
      const response = await fetch(`${API_URL}/api/v1/rooms/${roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, role }),
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to join room')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['room', variables.roomId] })
      queryClient.invalidateQueries({ queryKey: ['rooms'] })
    },
  })
}

export function usePostRoomMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roomId,
      agentId,
      content,
    }: {
      roomId: string
      agentId: string
      content: string
    }): Promise<{ messageId: string }> => {
      const response = await fetch(
        `${API_URL}/api/v1/rooms/${roomId}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, content }),
        },
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to post message')
      }
      return response.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['room-messages', variables.roomId],
      })
    },
  })
}

export type {
  Room,
  RoomMember,
  RoomMessage,
  RoomType,
  AgentRole,
  CreateRoomRequest,
  RoomSearchFilters,
}
