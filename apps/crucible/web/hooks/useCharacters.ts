import { useQuery } from '@tanstack/react-query'
import { API_URL } from '../config'

interface Character {
  id: string
  name: string
  description: string
}

interface CharacterDetail {
  id: string
  name: string
  description: string
  system: string
  bio: string[]
  topics: string[]
  adjectives: string[]
  style: {
    all: string[]
    chat: string[]
    post: string[]
  }
}

interface CharactersResponse {
  characters: Character[]
}

interface CharacterResponse {
  character: CharacterDetail
}

interface CharacterWithRuntime {
  id: string
  name: string
  description: string
  hasRuntime: boolean
}

interface ChatCharactersResponse {
  characters: CharacterWithRuntime[]
}

export function useCharacters() {
  return useQuery({
    queryKey: ['characters'],
    queryFn: async (): Promise<Character[]> => {
      const response = await fetch(`${API_URL}/api/v1/characters`)
      if (!response.ok) throw new Error('Failed to fetch characters')
      const data: CharactersResponse = await response.json()
      return data.characters
    },
  })
}

export function useCharacter(id: string) {
  return useQuery({
    queryKey: ['character', id],
    queryFn: async (): Promise<CharacterDetail> => {
      const response = await fetch(`${API_URL}/api/v1/characters/${id}`)
      if (!response.ok) throw new Error('Failed to fetch character')
      const data: CharacterResponse = await response.json()
      return data.character
    },
    enabled: !!id,
  })
}

export function useChatCharacters() {
  return useQuery({
    queryKey: ['chat-characters'],
    queryFn: async (): Promise<CharacterWithRuntime[]> => {
      const response = await fetch(`${API_URL}/api/v1/chat/characters`)
      if (!response.ok) throw new Error('Failed to fetch chat characters')
      const data: ChatCharactersResponse = await response.json()
      return data.characters
    },
  })
}

export type { Character, CharacterDetail, CharacterWithRuntime }
