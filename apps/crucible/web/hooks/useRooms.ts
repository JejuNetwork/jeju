/**
 * Rooms Hook
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { API_URL } from '../config'

type RoomType = 'collaboration' | 'adversarial' | 'debate' | 'council'
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

export function useRoomMessages(roomId: string, limit = 50) {
  return useQuery({
    queryKey: ['room-messages', roomId, limit],
    queryFn: async (): Promise<RoomMessage[]> => {
      const response = await fetch(
        `${API_URL}/api/v1/rooms/${roomId}/messages?limit=${limit}`,
      )
      if (!response.ok) throw new Error('Failed to fetch messages')
      const data = await response.json()
      return data.messages
    },
    enabled: !!roomId,
    refetchInterval: 5_000,
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
    }): Promise<{ success: boolean }> => {
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
    onSuccess: (_, { roomId }) => {
      queryClient.invalidateQueries({ queryKey: ['room', roomId] })
    },
  })
}

export function usePostMessage() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      roomId,
      agentId,
      content,
      action,
    }: {
      roomId: string
      agentId: string
      content: string
      action?: string
    }): Promise<{ message: RoomMessage }> => {
      const response = await fetch(
        `${API_URL}/api/v1/rooms/${roomId}/message`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, content, action }),
        },
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to post message')
      }
      return response.json()
    },
    onSuccess: (_, { roomId }) => {
      queryClient.invalidateQueries({ queryKey: ['room-messages', roomId] })
    },
  })
}

export type { Room, RoomMessage, RoomType, AgentRole, CreateRoomRequest }
