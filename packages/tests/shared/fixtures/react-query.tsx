/**
 * React Query Test Utilities
 *
 * Provides test-specific QueryClient configuration and wrapper components
 * for testing React components that use TanStack Query (React Query).
 *
 * @module @jejunetwork/tests/fixtures/react-query
 *
 * @example
 * ```tsx
 * import { createTestQueryClient, TestQueryProvider } from '@jejunetwork/tests';
 * import { renderHook } from '@testing-library/react';
 *
 * const queryClient = createTestQueryClient();
 *
 * const { result } = renderHook(() => useMyQuery(), {
 *   wrapper: ({ children }) => (
 *     <TestQueryProvider client={queryClient}>{children}</TestQueryProvider>
 *   ),
 * });
 * ```
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'

/**
 * Creates a QueryClient configured for testing
 *
 * Configuration optimized for tests:
 * - No retries (fail fast)
 * - No garbage collection (tests are short-lived)
 * - No stale time (always fetch fresh data)
 * - Errors are thrown to allow test assertion (throwOnError)
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/**
 * Creates a QueryClient with custom options for specific test scenarios
 */
export function createTestQueryClientWithOptions(options: {
  staleTime?: number
  gcTime?: number
  retry?: number | boolean
  refetchOnWindowFocus?: boolean
}): QueryClient {
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

interface TestQueryProviderProps {
  children: ReactNode
  client?: QueryClient
}

/**
 * Wrapper component for testing components that use React Query
 *
 * If no client is provided, creates a fresh test client.
 * Each test should ideally use a fresh client to avoid state leakage.
 */
export function TestQueryProvider({
  children,
  client,
}: TestQueryProviderProps): ReactElement {
  const queryClient = client ?? createTestQueryClient()
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

/**
 * Creates a wrapper function for renderHook
 *
 * @example
 * ```tsx
 * const wrapper = createQueryWrapper();
 * const { result } = renderHook(() => useMyQuery(), { wrapper });
 * ```
 */
export function createQueryWrapper(
  client?: QueryClient,
): ({ children }: { children: ReactNode }) => ReactElement {
  const queryClient = client ?? createTestQueryClient()
  return function QueryWrapper({
    children,
  }: {
    children: ReactNode
  }): ReactElement {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

/**
 * Utility to wait for queries to settle in tests
 *
 * Use after mutations or queries that trigger refetches
 */
export async function waitForQueriesToSettle(
  queryClient: QueryClient,
  timeout = 5000,
): Promise<void> {
  const start = Date.now()

  while (queryClient.isFetching() > 0 || queryClient.isMutating() > 0) {
    if (Date.now() - start > timeout) {
      throw new Error('Queries did not settle within timeout')
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

/**
 * Invalidates all queries and waits for them to refetch
 *
 * Useful for testing refetch behavior after mutations
 */
export async function invalidateAndWait(
  queryClient: QueryClient,
  timeout = 5000,
): Promise<void> {
  await queryClient.invalidateQueries()
  await waitForQueriesToSettle(queryClient, timeout)
}

// Re-export for convenience
export { QueryClient, QueryClientProvider }
