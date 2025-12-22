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
  reset: () => void;
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
      const result = await operation();
      setIsLoading(false);
      return result;
    },
    [],
  );

  const reset = useCallback((): void => {
    setIsLoading(false);
    setError(null);
  }, []);

  return { isLoading, error, execute, reset };
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
