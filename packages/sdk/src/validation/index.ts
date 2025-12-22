/**
 * Validation Module - ERC-8004 Validation Registry
 *
 * Provides validation request/response functionality for trustless agent verification.
 * Supports TEE attestation, zkML proofs, and stake-secured validation.
 */

import type { NetworkType } from "@jejunetwork/types";
import {
  type Address,
  encodeFunctionData,
  type Hex,
  keccak256,
  type PublicClient,
  toHex,
} from "viem";
import { requireContract } from "../config";
import type { JejuWallet } from "../wallet";

export interface ValidationRequest {
  requestHash: Hex;
  validatorAddress: Address;
  agentId: bigint;
  requestUri: string;
  timestamp: number;
}

export interface ValidationStatus {
  requestHash: Hex;
  validatorAddress: Address;
  agentId: bigint;
  response: number; // 0-100
  responseHash: Hex;
  tag: Hex;
  lastUpdate: number;
}

export interface ValidationSummary {
  agentId: bigint;
  count: number;
  avgResponse: number; // 0-100
}

export interface RequestValidationParams {
  validatorAddress: Address;
  agentId: bigint;
  requestUri: string;
  requestHash?: Hex;
}

export interface RespondValidationParams {
  requestHash: Hex;
  response: number; // 0-100
  responseUri?: string;
  responseHash?: Hex;
  tag?: string;
}

export interface ValidationModule {
  // Request validation
  requestValidation(params: RequestValidationParams): Promise<Hex>;

  // Respond to validation (for validators)
  respondToValidation(params: RespondValidationParams): Promise<Hex>;

  // Get validation status
  getStatus(requestHash: Hex): Promise<ValidationStatus | null>;

  // Get request details
  getRequest(requestHash: Hex): Promise<ValidationRequest | null>;

  // Get summary for an agent
  getSummary(
    agentId: bigint,
    validatorAddresses?: Address[],
    tag?: Hex,
  ): Promise<ValidationSummary>;

  // Get all validations for an agent
  getAgentValidations(agentId: bigint): Promise<Hex[]>;

  // Get all requests assigned to a validator
  getValidatorRequests(validatorAddress: Address): Promise<Hex[]>;

  // Check if request exists
  requestExists(requestHash: Hex): Promise<boolean>;
}

const VALIDATION_REGISTRY_ABI = [
  {
    name: "validationRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestUri", type: "string" },
      { name: "requestHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "validationResponse",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "requestHash", type: "bytes32" },
      { name: "response", type: "uint8" },
      { name: "responseUri", type: "string" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "getValidationStatus",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "response", type: "uint8" },
      { name: "responseHash", type: "bytes32" },
      { name: "tag", type: "bytes32" },
      { name: "lastUpdate", type: "uint256" },
    ],
  },
  {
    name: "getRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [
      { name: "validatorAddress", type: "address" },
      { name: "agentId", type: "uint256" },
      { name: "requestUri", type: "string" },
      { name: "timestamp", type: "uint256" },
    ],
  },
  {
    name: "getSummary",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agentId", type: "uint256" },
      { name: "validatorAddresses", type: "address[]" },
      { name: "tag", type: "bytes32" },
    ],
    outputs: [
      { name: "count", type: "uint64" },
      { name: "avgResponse", type: "uint8" },
    ],
  },
  {
    name: "getAgentValidations",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agentId", type: "uint256" }],
    outputs: [{ name: "requestHashes", type: "bytes32[]" }],
  },
  {
    name: "getValidatorRequests",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "validatorAddress", type: "address" }],
    outputs: [{ name: "requestHashes", type: "bytes32[]" }],
  },
  {
    name: "requestExists",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestHash", type: "bytes32" }],
    outputs: [{ name: "exists", type: "bool" }],
  },
] as const;

const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const ZERO_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

function stringToBytes32(str: string): Hex {
  if (!str) return ZERO_BYTES32;
  const bytes = new TextEncoder().encode(str);
  const padded = new Uint8Array(32);
  padded.set(bytes.slice(0, 32));
  return toHex(padded);
}

export function createValidationModule(
  wallet: JejuWallet,
  network: NetworkType,
  publicClient?: PublicClient,
): ValidationModule {
  const validationAddress = requireContract("registry", "validation", network);
  const client = publicClient ?? wallet.publicClient;

  async function requestValidation(
    params: RequestValidationParams,
  ): Promise<Hex> {
    const requestHash =
      params.requestHash ||
      keccak256(
        toHex(
          `${params.validatorAddress}${params.agentId}${params.requestUri}${Date.now()}`,
        ),
      );

    const data = encodeFunctionData({
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "validationRequest",
      args: [
        params.validatorAddress,
        params.agentId,
        params.requestUri,
        requestHash,
      ],
    });

    return wallet.sendTransaction({ to: validationAddress, data });
  }

  async function respondToValidation(
    params: RespondValidationParams,
  ): Promise<Hex> {
    if (params.response < 0 || params.response > 100) {
      throw new Error("Response must be 0-100");
    }

    const responseHash =
      params.responseHash ||
      (params.responseUri
        ? keccak256(toHex(params.responseUri))
        : ZERO_BYTES32);
    const tag = params.tag ? stringToBytes32(params.tag) : ZERO_BYTES32;

    const data = encodeFunctionData({
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "validationResponse",
      args: [
        params.requestHash,
        params.response,
        params.responseUri || "",
        responseHash,
        tag,
      ],
    });

    return wallet.sendTransaction({ to: validationAddress, data });
  }

  async function getStatus(requestHash: Hex): Promise<ValidationStatus | null> {
    if (!publicClient) throw new Error("Public client required for reads");

    const result = (await publicClient.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getValidationStatus",
      args: [requestHash],
    })) as [Address, bigint, number, Hex, Hex, bigint];

    const [validatorAddress, agentId, response, respHash, tag, lastUpdate] =
      result;

    // Return null if no response yet
    if (validatorAddress === ZERO_ADDRESS) return null;

    return {
      requestHash,
      validatorAddress,
      agentId,
      response,
      responseHash: respHash,
      tag,
      lastUpdate: Number(lastUpdate),
    };
  }

  async function getRequest(
    requestHash: Hex,
  ): Promise<ValidationRequest | null> {
    const result = (await client.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getRequest",
      args: [requestHash],
    })) as [Address, bigint, string, bigint];

    const [validatorAddress, agentId, requestUri, timestamp] = result;

    if (validatorAddress === ZERO_ADDRESS) return null;

    return {
      requestHash,
      validatorAddress,
      agentId,
      requestUri,
      timestamp: Number(timestamp),
    };
  }

  async function getSummary(
    agentId: bigint,
    validatorAddresses?: Address[],
    tag?: Hex,
  ): Promise<ValidationSummary> {
    if (!publicClient) throw new Error("Public client required for reads");

    const result = (await publicClient.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getSummary",
      args: [agentId, validatorAddresses || [], tag || ZERO_BYTES32],
    })) as [bigint, number];

    const [count, avgResponse] = result;

    return {
      agentId,
      count: Number(count),
      avgResponse,
    };
  }

  async function getAgentValidations(agentId: bigint): Promise<Hex[]> {
    const result = (await client.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getAgentValidations",
      args: [agentId],
    })) as Hex[];

    return result;
  }

  async function getValidatorRequests(
    validatorAddress: Address,
  ): Promise<Hex[]> {
    if (!publicClient) throw new Error("Public client required for reads");

    const result = (await publicClient.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "getValidatorRequests",
      args: [validatorAddress],
    })) as Hex[];

    return result;
  }

  async function requestExists(requestHash: Hex): Promise<boolean> {
    const result = (await client.readContract({
      address: validationAddress,
      abi: VALIDATION_REGISTRY_ABI,
      functionName: "requestExists",
      args: [requestHash],
    })) as boolean;

    return result;
  }

  return {
    requestValidation,
    respondToValidation,
    getStatus,
    getRequest,
    getSummary,
    getAgentValidations,
    getValidatorRequests,
    requestExists,
  };
}
