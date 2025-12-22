import type {
  JsonValue,
  PinInfo,
  UploadOptions,
  UploadResult,
} from '@jejunetwork/sdk'
import { useCallback } from 'react'
import type { ZodSchema } from 'zod'
import { useNetworkContext } from '../context'
import { type AsyncState, requireClient, useAsyncState } from './utils'

export interface UseStorageResult extends AsyncState {
  upload: (
    data: Uint8Array | Blob | File,
    options?: UploadOptions,
  ) => Promise<UploadResult>
  uploadJson: (
    data: JsonValue | Record<string, JsonValue>,
    options?: UploadOptions,
  ) => Promise<UploadResult>
  retrieve: (cid: string) => Promise<Uint8Array>
  /**
   * Retrieve and validate JSON from storage using a Zod schema
   * @param cid - Content identifier
   * @param schema - Zod schema for validation
   * @throws Error if validation fails
   */
  retrieveJson: <T>(cid: string, schema: ZodSchema<T>) => Promise<T>
  listPins: () => Promise<PinInfo[]>
  getGatewayUrl: (cid: string) => string
}

export function useStorage(): UseStorageResult {
  const { client } = useNetworkContext()
  const { isLoading, error, execute } = useAsyncState()

  const upload = useCallback(
    async (
      data: Uint8Array | Blob | File,
      options?: UploadOptions,
    ): Promise<UploadResult> => {
      const c = requireClient(client)
      return execute(() => c.storage.upload(data, options))
    },
    [client, execute],
  )

  const uploadJson = useCallback(
    async (
      data: JsonValue | Record<string, JsonValue>,
      options?: UploadOptions,
    ): Promise<UploadResult> => {
      const c = requireClient(client)
      return execute(() => c.storage.uploadJson(data, options))
    },
    [client, execute],
  )

  const retrieve = useCallback(
    async (cid: string): Promise<Uint8Array> => {
      const c = requireClient(client)
      return c.storage.retrieve(cid)
    },
    [client],
  )

  const retrieveJson = useCallback(
    async <T>(cid: string, schema: ZodSchema<T>): Promise<T> => {
      const c = requireClient(client)
      return c.storage.retrieveJson(cid, schema)
    },
    [client],
  )

  const listPins = useCallback(async (): Promise<PinInfo[]> => {
    const c = requireClient(client)
    return c.storage.listPins()
  }, [client])

  const getGatewayUrl = useCallback(
    (cid: string): string => {
      const c = requireClient(client)
      return c.storage.getGatewayUrl(cid)
    },
    [client],
  )

  return {
    isLoading,
    error,
    upload,
    uploadJson,
    retrieve,
    retrieveJson,
    listPins,
    getGatewayUrl,
  }
}
