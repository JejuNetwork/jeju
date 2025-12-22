/**
 * Identity Module - ERC-8004, reputation, moderation
 */

import type { NetworkType } from "@jejunetwork/types";
import { type Address, encodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import { getServicesConfig, requireContract } from "../config";
import {
  AgentInfoSchema,
  BanInfoSchema,
  ReputationScoreSchema,
} from "../shared/schemas";
import type { JejuWallet } from "../wallet";

export interface AgentInfo {
  agentId: bigint;
  owner: Address;
  name: string;
  tags: string[];
  a2aEndpoint: string;
  mcpEndpoint: string;
  registeredAt: number;
  lastActivityAt: number;
  isBanned: boolean;
}

export interface ReputationScore {
  agentId: bigint;
  feedbackCount: number;
  averageScore: number;
  violationCount: number;
  compositeScore: number;
  tier: "bronze" | "silver" | "gold" | "platinum";
}

export interface BanInfo {
  agentId: bigint;
  isBanned: boolean;
  bannedAt: number;
  reason: string;
  banType: "network" | "app" | "category";
}

export interface ReportParams {
  agentId: bigint;
  type: "spam" | "scam" | "abuse" | "illegal" | "other";
  description: string;
  evidence?: string;
}

export interface RegisterAgentParams {
  name: string;
  tags: string[];
  a2aEndpoint?: string;
  mcpEndpoint?: string;
}

export interface IdentityModule {
  // Agent management
  register(
    params: RegisterAgentParams,
  ): Promise<{ agentId: bigint; txHash: Hex }>;
  update(params: Partial<RegisterAgentParams>): Promise<Hex>;
  getAgent(agentIdOrAddress: bigint | Address): Promise<AgentInfo | null>;
  getMyAgent(): Promise<AgentInfo | null>;
  listAgents(tags?: string[]): Promise<AgentInfo[]>;

  // Reputation
  getReputation(agentId: bigint): Promise<ReputationScore>;
  getMyReputation(): Promise<ReputationScore | null>;
  leaveFeedback(agentId: bigint, score: number, comment?: string): Promise<Hex>;

  // Moderation
  report(params: ReportParams): Promise<Hex>;
  getBanStatus(agentId: bigint): Promise<BanInfo>;
  amIBanned(): Promise<boolean>;
}

const IDENTITY_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "tags", type: "string[]" },
      { name: "a2aEndpoint", type: "string" },
      { name: "mcpEndpoint", type: "string" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "updateAgent",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "name", type: "string" },
      { name: "tags", type: "string[]" },
      { name: "a2aEndpoint", type: "string" },
      { name: "mcpEndpoint", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getAgent",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "owner", type: "address" },
          { name: "name", type: "string" },
          { name: "tags", type: "string[]" },
          { name: "a2aEndpoint", type: "string" },
          { name: "mcpEndpoint", type: "string" },
          { name: "registeredAt", type: "uint256" },
          { name: "lastActivityAt", type: "uint256" },
          { name: "isBanned", type: "bool" },
        ],
      },
    ],
  },
  {
    name: "getAgentIdByOwner",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

const REPORTING_ABI = [
  {
    name: "submitReport",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "reportType", type: "uint8" },
      { name: "descriptionHash", type: "bytes32" },
      { name: "evidenceHash", type: "bytes32" },
    ],
    outputs: [{ type: "bytes32" }],
  },
  {
    name: "leaveFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "score", type: "uint8" },
      { name: "commentHash", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

export function createIdentityModule(
  wallet: JejuWallet,
  network: NetworkType,
): IdentityModule {
  const identityAddress = requireContract("registry", "identity", network);
  const reportingAddress = requireContract(
    "moderation",
    "reportingSystem",
    network,
  );
  const services = getServicesConfig(network);

  async function register(
    params: RegisterAgentParams,
  ): Promise<{ agentId: bigint; txHash: Hex }> {
    const data = encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "register",
      args: [
        params.name,
        params.tags,
        params.a2aEndpoint ?? "",
        params.mcpEndpoint ?? "",
      ],
    });

    const txHash = await wallet.sendTransaction({ to: identityAddress, data });

    // Get the agent ID from the transaction receipt (simplified - would parse from logs)
    const agentId = 1n;

    return { agentId, txHash };
  }

  async function update(params: Partial<RegisterAgentParams>): Promise<Hex> {
    const current = await getMyAgent();
    if (!current) throw new Error("No agent registered");

    const data = encodeFunctionData({
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "updateAgent",
      args: [
        params.name ?? current.name,
        params.tags ?? current.tags,
        params.a2aEndpoint ?? current.a2aEndpoint,
        params.mcpEndpoint ?? current.mcpEndpoint,
      ],
    });

    return wallet.sendTransaction({ to: identityAddress, data });
  }

  async function getAgent(
    agentIdOrAddress: bigint | Address,
  ): Promise<AgentInfo | null> {
    const response = await fetch(
      `${services.gateway.api}/identity/agent/${agentIdOrAddress}`,
    );
    if (!response.ok) return null;

    const data = AgentInfoSchema.parse(await response.json());
    return data;
  }

  async function getMyAgent(): Promise<AgentInfo | null> {
    return getAgent(wallet.address);
  }

  async function listAgents(tags?: string[]): Promise<AgentInfo[]> {
    const url = tags
      ? `${services.gateway.api}/identity/agents?tags=${tags.join(",")}`
      : `${services.gateway.api}/identity/agents`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to list agents: ${response.statusText}`);
    }

    const AgentsListResponseSchema = z.object({
      agents: z.array(AgentInfoSchema),
    });
    const data = AgentsListResponseSchema.parse(await response.json());
    return data.agents;
  }

  async function getReputation(agentId: bigint): Promise<ReputationScore> {
    const response = await fetch(
      `${services.gateway.api}/identity/reputation/${agentId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get reputation: ${response.statusText}`);
    }

    return ReputationScoreSchema.parse(await response.json());
  }

  async function getMyReputation(): Promise<ReputationScore | null> {
    const agent = await getMyAgent();
    if (!agent) return null;
    return getReputation(agent.agentId);
  }

  async function leaveFeedback(
    agentId: bigint,
    score: number,
    comment?: string,
  ): Promise<Hex> {
    if (score < 1 || score > 5)
      throw new Error("Score must be between 1 and 5");

    const commentHash = comment
      ? (`0x${Buffer.from(comment).toString("hex").slice(0, 64).padEnd(64, "0")}` as Hex)
      : ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);

    const data = encodeFunctionData({
      abi: REPORTING_ABI,
      functionName: "leaveFeedback",
      args: [agentId, score, commentHash],
    });

    return wallet.sendTransaction({ to: reportingAddress, data });
  }

  async function report(params: ReportParams): Promise<Hex> {
    const typeMap = { spam: 0, scam: 1, abuse: 2, illegal: 3, other: 4 };

    const descHash =
      `0x${Buffer.from(params.description).toString("hex").slice(0, 64).padEnd(64, "0")}` as Hex;
    const evidenceHash = params.evidence
      ? (`0x${Buffer.from(params.evidence).toString("hex").slice(0, 64).padEnd(64, "0")}` as Hex)
      : ("0x0000000000000000000000000000000000000000000000000000000000000000" as Hex);

    const data = encodeFunctionData({
      abi: REPORTING_ABI,
      functionName: "submitReport",
      args: [params.agentId, typeMap[params.type], descHash, evidenceHash],
    });

    return wallet.sendTransaction({ to: reportingAddress, data });
  }

  async function getBanStatus(agentId: bigint): Promise<BanInfo> {
    const response = await fetch(
      `${services.gateway.api}/moderation/ban/${agentId}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to get ban status: ${response.statusText}`);
    }

    return BanInfoSchema.parse(await response.json());
  }

  async function amIBanned(): Promise<boolean> {
    const agent = await getMyAgent();
    if (!agent) return false;

    const status = await getBanStatus(agent.agentId);
    return status.isBanned;
  }

  return {
    register,
    update,
    getAgent,
    getMyAgent,
    listAgents,
    getReputation,
    getMyReputation,
    leaveFeedback,
    report,
    getBanStatus,
    amIBanned,
  };
}
