/**
 * Storage hook
 */

import { useCallback, useState } from "react";
import { useNetworkContext } from "../context";
import type { UploadOptions, UploadResult, PinInfo } from "@jejunetwork/sdk";

export function useStorage() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upload = useCallback(
    async (
      data: Uint8Array | Blob | File,
      options?: UploadOptions,
    ): Promise<UploadResult> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const result = await client.storage.upload(data, options);
      setIsLoading(false);
      return result;
    },
    [client],
  );

  const uploadJson = useCallback(
    async (data: object, options?: UploadOptions): Promise<UploadResult> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const result = await client.storage.uploadJson(data, options);
      setIsLoading(false);
      return result;
    },
    [client],
  );

  const retrieve = useCallback(
    async (cid: string): Promise<Uint8Array> => {
      if (!client) throw new Error("Not connected");
      return client.storage.retrieve(cid);
    },
    [client],
  );

  const retrieveJson = useCallback(
    async <T = unknown>(cid: string): Promise<T> => {
      if (!client) throw new Error("Not connected");
      return client.storage.retrieveJson<T>(cid);
    },
    [client],
  );

  const listPins = useCallback(async (): Promise<PinInfo[]> => {
    if (!client) throw new Error("Not connected");
    return client.storage.listPins();
  }, [client]);

  const getGatewayUrl = useCallback(
    (cid: string): string => {
      if (!client) throw new Error("Not connected");
      return client.storage.getGatewayUrl(cid);
    },
    [client],
  );

  return {
    isLoading,
    error,
    upload,
    uploadJson,
    retrieve,
    retrieveJson,
    listPins,
    getGatewayUrl,
  };
}
