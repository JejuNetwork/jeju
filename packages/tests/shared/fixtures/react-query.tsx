/** React Query test utilities - optimized for testing (no retries, no GC, no stale time) */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'

interface QueryClientOptions {
  staleTime?: number
  gcTime?: number
  retry?: number | boolean
  refetchOnWindowFocus?: boolean
}

export function createTestQueryClient(options: QueryClientOptions = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: options.retry ?? false,
        gcTime: options.gcTime ?? 0,
        staleTime: options.staleTime ?? 0,
        refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
      },
      mutations: {
        retry: options.retry ?? false,
      },
    },
  })
}

/** @deprecated Use createTestQueryClient(options) instead */
export const createTestQueryClientWithOptions = createTestQueryClient

interface TestQueryProviderProps {
  children: ReactNode
  client?: QueryClient
}

export function TestQueryProvider({ children, client }: TestQueryProviderProps): ReactElement {
  return (
    <QueryClientProvider client={client ?? createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

export function createQueryWrapper(
  client?: QueryClient,
): ({ children }: { children: ReactNode }) => ReactElement {
  const queryClient = client ?? createTestQueryClient()
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

export async function waitForQueriesToSettle(
  queryClient: QueryClient,
  timeout = 5000,
): Promise<void> {
  const deadline = Date.now() + timeout
  while (queryClient.isFetching() > 0 || queryClient.isMutating() > 0) {
    if (Date.now() > deadline) throw new Error('Queries did not settle within timeout')
    await new Promise((r) => setTimeout(r, 50))
  }
}

export async function invalidateAndWait(
  queryClient: QueryClient,
  timeout = 5000,
): Promise<void> {
  await queryClient.invalidateQueries()
  await waitForQueriesToSettle(queryClient, timeout)
}

export { QueryClient, QueryClientProvider }
