import { useMutation, useQueryClient } from '@tanstack/react-query'
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

export type { Room, RoomMessage, RoomType, AgentRole, CreateRoomRequest }
