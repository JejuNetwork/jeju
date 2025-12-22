import { useState, useCallback } from "react";
import type { JejuClient } from "@jejunetwork/sdk";

/**
 * Async operation state for hooks
 */
export interface AsyncState {
  isLoading: boolean;
  error: Error | null;
}

/**
 * Return type for useAsyncState hook
 */
export interface UseAsyncStateResult extends AsyncState {
  execute: <T>(operation: () => Promise<T>) => Promise<T>;
}

/**
 * Hook for managing async operation state.
 * Eliminates repeated isLoading/error state management across hooks.
 */
export function useAsyncState(): UseAsyncStateResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async <T>(operation: () => Promise<T>): Promise<T> => {
      setIsLoading(true);
      setError(null);
      return operation()
        .then((result: T) => {
          setIsLoading(false);
          return result;
        })
        .catch((err: unknown): never => {
          const e = err instanceof Error ? err : new Error(String(err));
          setError(e);
          setIsLoading(false);
          throw e;
        });
    },
    [],
  );

  return { isLoading, error, execute };
}

/**
 * Requires client to be connected, throws if not.
 * Provides type narrowing for the client.
 */
export function requireClient(client: JejuClient | null): JejuClient {
  if (!client) {
    throw new Error("Not connected");
  }
  return client;
}
