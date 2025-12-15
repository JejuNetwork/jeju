/**
 * Identity hook
 */

import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { useNetworkContext } from "../context";
import type {
  AgentInfo,
  RegisterAgentParams,
  ReputationScore,
} from "@jejunetwork/sdk";

export function useIdentity() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const getMyAgent = useCallback(async (): Promise<AgentInfo | null> => {
    if (!client) throw new Error("Not connected");
    return client.identity.getMyAgent();
  }, [client]);

  const register = useCallback(
    async (
      params: RegisterAgentParams,
    ): Promise<{ agentId: bigint; txHash: Hex }> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const result = await client.identity.register(params);
      setIsLoading(false);
      return result;
    },
    [client],
  );

  const getReputation = useCallback(
    async (agentId: bigint): Promise<ReputationScore> => {
      if (!client) throw new Error("Not connected");
      return client.identity.getReputation(agentId);
    },
    [client],
  );

  const getMyReputation =
    useCallback(async (): Promise<ReputationScore | null> => {
      if (!client) throw new Error("Not connected");
      return client.identity.getMyReputation();
    }, [client]);

  const amIBanned = useCallback(async (): Promise<boolean> => {
    if (!client) throw new Error("Not connected");
    return client.identity.amIBanned();
  }, [client]);

  return {
    isLoading,
    error,
    getMyAgent,
    register,
    getReputation,
    getMyReputation,
    amIBanned,
  };
}
