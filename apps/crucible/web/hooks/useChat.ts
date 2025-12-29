import type { JsonRecord, JsonValue } from '@jejunetwork/types'
import { useMutation } from '@tanstack/react-query'
import { API_URL } from '../config'

interface ChatRequest {
  characterId: string
  text: string
  userId?: string
  roomId?: string
}

interface ChatResponse {
  text: string
  action?: string
  actions?: Array<{
    type: string
    target?: string
    params?: JsonRecord
    result?: JsonValue
    success: boolean
  }>
  character: string
}

export function useChat() {
  return useMutation({
    mutationFn: async (request: ChatRequest): Promise<ChatResponse> => {
      const response = await fetch(
        `${API_URL}/api/v1/chat/${request.characterId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: request.text,
            userId: request.userId,
            roomId: request.roomId,
          }),
        },
      )
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error ?? 'Failed to chat')
      }
      return response.json()
    },
  })
}

export type { ChatRequest, ChatResponse }
