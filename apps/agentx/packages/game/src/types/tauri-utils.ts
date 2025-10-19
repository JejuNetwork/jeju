import { TauriMemoryResponse, MemoryEntry, LogEntry } from './shared';

/**
 * Type-safe utilities for handling Tauri responses to avoid 'as any' casts
 */

/**
 * Safely extracts memories from a TauriMemoryResponse
 */
export function extractMemoriesFromResponse(response: unknown): MemoryEntry[] {
  if (!response || typeof response !== 'object') {
    return [];
  }

  // If response is already an array, return it (assuming it's MemoryEntry[])
  if (Array.isArray(response)) {
    return response as MemoryEntry[];
  }

  const responseObj = response as TauriMemoryResponse;

  // Check for memories in the direct property
  if (Array.isArray(responseObj.memories)) {
    return responseObj.memories;
  }

  // Check for memories in the data.memories property
  if (responseObj.data && Array.isArray(responseObj.data.memories)) {
    return responseObj.data.memories;
  }

  // Check for memories in the data property (direct array)
  if (responseObj.data && Array.isArray(responseObj.data)) {
    return responseObj.data as MemoryEntry[];
  }

  return [];
}

/**
 * Safely extracts logs from a TauriMemoryResponse
 */
export function extractLogsFromResponse(response: unknown): LogEntry[] {
  if (!response || typeof response !== 'object') {
    return [];
  }

  const responseObj = response as TauriMemoryResponse;

  // Check if it's a successful response with logs
  if (responseObj.success && responseObj.data && Array.isArray(responseObj.data.logs)) {
    return responseObj.data.logs;
  }

  return [];
}

/**
 * Type guard to check if response is a successful TauriMemoryResponse
 */
export function isSuccessfulTauriResponse(
  response: unknown
): response is TauriMemoryResponse & { success: true } {
  return (
    response !== null &&
    typeof response === 'object' &&
    'success' in response &&
    (response as TauriMemoryResponse).success === true
  );
}

/**
 * Safely extracts data from a TauriMemoryResponse with proper typing
 */
export function extractDataFromResponse<T = unknown>(
  response: unknown,
  dataKey?: keyof NonNullable<TauriMemoryResponse['data']>
): T[] {
  if (!isSuccessfulTauriResponse(response) || !response.data) {
    return [];
  }

  if (dataKey) {
    const data = response.data[dataKey];
    return Array.isArray(data) ? (data as T[]) : [];
  }

  // If no specific key requested, try to return the data itself if it's an array
  if (Array.isArray(response.data)) {
    return response.data as T[];
  }

  return [];
}

/**
 * Type-safe converter from unknown response to expected shape
 * Replaces the need for 'as unknown as Record<string, unknown>[]'
 */
export function convertToRecordArray(data: unknown[]): Record<string, unknown>[] {
  return data.map((item) => {
    if (typeof item === 'object' && item !== null) {
      return item as Record<string, unknown>;
    }
    return { value: item };
  });
}
