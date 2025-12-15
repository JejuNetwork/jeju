/**
 * Governance hook
 */

import { useCallback, useState } from "react";
import type { Hex } from "viem";
import { useNetworkContext } from "../context";
import type {
  ProposalInfo,
  CreateProposalParams,
  VoteParams,
  DelegateInfo,
} from "@jejunetwork/sdk";
import type { ProposalStatus } from "@jejunetwork/types";

export function useGovernance() {
  const { client } = useNetworkContext();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const listProposals = useCallback(
    async (status?: ProposalStatus): Promise<ProposalInfo[]> => {
      if (!client) throw new Error("Not connected");
      return client.governance.listProposals(status);
    },
    [client],
  );

  const createProposal = useCallback(
    async (params: CreateProposalParams): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.governance.createProposal(params);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  const vote = useCallback(
    async (params: VoteParams): Promise<Hex> => {
      if (!client) throw new Error("Not connected");
      setIsLoading(true);
      setError(null);

      const txHash = await client.governance.vote(params);
      setIsLoading(false);
      return txHash;
    },
    [client],
  );

  const getVotingPower = useCallback(async (): Promise<bigint> => {
    if (!client) throw new Error("Not connected");
    return client.governance.getVotingPower();
  }, [client]);

  const listDelegates = useCallback(async (): Promise<DelegateInfo[]> => {
    if (!client) throw new Error("Not connected");
    return client.governance.listDelegates();
  }, [client]);

  return {
    isLoading,
    error,
    listProposals,
    createProposal,
    vote,
    getVotingPower,
    listDelegates,
  };
}
