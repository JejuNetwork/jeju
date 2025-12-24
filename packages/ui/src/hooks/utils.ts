import type { JejuClient } from '@jejunetwork/sdk'
import { toError } from '@jejunetwork/types'
import { useCallback, useState } from 'react'

export interface AsyncState {
  isLoading: boolean
  error: Error | null
}

export interface UseAsyncStateResult extends AsyncState {
  execute: <T>(operation: () => Promise<T>) => Promise<T>
}

export function useAsyncState(): UseAsyncStateResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const execute = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      setIsLoading(true)
      setError(null)
      return operation()
        .then((result: T) => {
          setIsLoading(false)
          return result
        })
        .catch((err): never => {
          const e = toError(err)
          setError(e)
          setIsLoading(false)
          throw e
        })
    },
    [],
  )

  return { isLoading, error, execute }
}

export function requireClient(client: JejuClient | null): JejuClient {
  if (!client) {
    throw new Error('Not connected')
  }
  return client
}
