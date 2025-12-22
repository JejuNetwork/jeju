import { useCallback } from "react";
import type { Hex } from "viem";
import { useNetworkContext } from "../context";
import { useAsyncState, requireClient, type AsyncState } from "./utils";
import type {
  AgentInfo,
  RegisterAgentParams,
  ReputationScore,
} from "@jejunetwork/sdk";

export interface UseIdentityResult extends AsyncState {
  getMyAgent: () => Promise<AgentInfo | null>;
  register: (
    params: RegisterAgentParams,
  ) => Promise<{ agentId: bigint; txHash: Hex }>;
  getReputation: (agentId: bigint) => Promise<ReputationScore>;
  getMyReputation: () => Promise<ReputationScore | null>;
  amIBanned: () => Promise<boolean>;
}

export function useIdentity(): UseIdentityResult {
  const { client } = useNetworkContext();
  const { isLoading, error, execute } = useAsyncState();

  const getMyAgent = useCallback(async (): Promise<AgentInfo | null> => {
    const c = requireClient(client);
    return c.identity.getMyAgent();
  }, [client]);

  const register = useCallback(
    async (
      params: RegisterAgentParams,
    ): Promise<{ agentId: bigint; txHash: Hex }> => {
      const c = requireClient(client);
      return execute(() => c.identity.register(params));
    },
    [client, execute],
  );

  const getReputation = useCallback(
    async (agentId: bigint): Promise<ReputationScore> => {
      const c = requireClient(client);
      return c.identity.getReputation(agentId);
    },
    [client],
  );

  const getMyReputation =
    useCallback(async (): Promise<ReputationScore | null> => {
      const c = requireClient(client);
      return c.identity.getMyReputation();
    }, [client]);

  const amIBanned = useCallback(async (): Promise<boolean> => {
    const c = requireClient(client);
    return c.identity.amIBanned();
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
