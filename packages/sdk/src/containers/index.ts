/**
 * Containers Module - OCI Container Registry
 *
 * Provides:
 * - OCI-compatible container image management
 * - Repository creation and management
 * - Image push/pull tracking
 * - Multi-architecture support
 * - Image signing and verification
 */

import type { NetworkType } from "@jejunetwork/types";
import type { Address, Hex } from "viem";
import { encodeFunctionData, keccak256, toHex } from "viem";
import { getContractAddresses } from "../config";
import type { JejuWallet } from "../wallet";

// ============================================================================
// Types
// ============================================================================

export type ContainerVisibility = "PUBLIC" | "PRIVATE" | "ORGANIZATION";

export interface ContainerRepository {
  repoId: Hex;
  name: string;
  namespace: string;
  owner: Address;
  ownerAgentId: bigint;
  description: string;
  visibility: ContainerVisibility;
  tags: string[];
  createdAt: bigint;
  updatedAt: bigint;
  pullCount: bigint;
  starCount: bigint;
  isVerified: boolean;
}

export interface ImageManifest {
  manifestId: Hex;
  repoId: Hex;
  tag: string;
  digest: string;
  manifestUri: string;
  manifestHash: Hex;
  size: bigint;
  architectures: string[];
  layers: string[];
  publishedAt: bigint;
  publisher: Address;
  buildInfo: string;
}

export interface LayerBlob {
  digest: string;
  cid: string;
  size: bigint;
  mediaType: string;
  uploadedAt: bigint;
}

export interface ImageSignature {
  signatureId: Hex;
  manifestId: Hex;
  signer: Address;
  signerAgentId: bigint;
  signature: Hex;
  publicKeyUri: string;
  signedAt: bigint;
  isValid: boolean;
}

export interface CreateRepositoryParams {
  name: string;
  namespace: string;
  description?: string;
  visibility?: ContainerVisibility;
  tags?: string[];
}

export interface PublishImageParams {
  repoId: Hex;
  tag: string;
  manifestUri: string;
  layers: string[];
  architectures?: string[];
  buildInfo?: string;
}

export interface SignImageParams {
  manifestId: Hex;
  signature: Hex;
  publicKeyUri: string;
}

// ============================================================================
// ABIs
// ============================================================================

const CONTAINER_REGISTRY_ABI = [
  {
    type: "function",
    name: "createRepository",
    inputs: [
      { name: "name", type: "string" },
      { name: "namespace", type: "string" },
      { name: "description", type: "string" },
      { name: "visibility", type: "uint8" },
      { name: "tags", type: "string[]" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "publishImage",
    inputs: [
      { name: "repoId", type: "bytes32" },
      { name: "tag", type: "string" },
      { name: "manifestUri", type: "string" },
      { name: "manifestHash", type: "bytes32" },
      { name: "size", type: "uint256" },
      { name: "architectures", type: "string[]" },
      { name: "layers", type: "string[]" },
      { name: "buildInfo", type: "string" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "signImage",
    inputs: [
      { name: "manifestId", type: "bytes32" },
      { name: "signature", type: "bytes" },
      { name: "publicKeyUri", type: "string" },
    ],
    outputs: [{ type: "bytes32" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "recordPull",
    inputs: [{ name: "repoId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "starRepository",
    inputs: [{ name: "repoId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "unstarRepository",
    inputs: [{ name: "repoId", type: "bytes32" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "grantAccess",
    inputs: [
      { name: "repoId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "revokeAccess",
    inputs: [
      { name: "repoId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getRepository",
    inputs: [{ name: "repoId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "repoId", type: "bytes32" },
          { name: "name", type: "string" },
          { name: "namespace", type: "string" },
          { name: "owner", type: "address" },
          { name: "ownerAgentId", type: "uint256" },
          { name: "description", type: "string" },
          { name: "visibility", type: "uint8" },
          { name: "tags", type: "string[]" },
          { name: "createdAt", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "pullCount", type: "uint256" },
          { name: "starCount", type: "uint256" },
          { name: "isVerified", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRepositoryByName",
    inputs: [{ name: "fullName", type: "string" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "repoId", type: "bytes32" },
          { name: "name", type: "string" },
          { name: "namespace", type: "string" },
          { name: "owner", type: "address" },
          { name: "ownerAgentId", type: "uint256" },
          { name: "description", type: "string" },
          { name: "visibility", type: "uint8" },
          { name: "tags", type: "string[]" },
          { name: "createdAt", type: "uint256" },
          { name: "updatedAt", type: "uint256" },
          { name: "pullCount", type: "uint256" },
          { name: "starCount", type: "uint256" },
          { name: "isVerified", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getManifest",
    inputs: [{ name: "manifestId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "manifestId", type: "bytes32" },
          { name: "repoId", type: "bytes32" },
          { name: "tag", type: "string" },
          { name: "digest", type: "string" },
          { name: "manifestUri", type: "string" },
          { name: "manifestHash", type: "bytes32" },
          { name: "size", type: "uint256" },
          { name: "architectures", type: "string[]" },
          { name: "layers", type: "string[]" },
          { name: "publishedAt", type: "uint256" },
          { name: "publisher", type: "address" },
          { name: "buildInfo", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getManifestByTag",
    inputs: [
      { name: "repoId", type: "bytes32" },
      { name: "tag", type: "string" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "manifestId", type: "bytes32" },
          { name: "repoId", type: "bytes32" },
          { name: "tag", type: "string" },
          { name: "digest", type: "string" },
          { name: "manifestUri", type: "string" },
          { name: "manifestHash", type: "bytes32" },
          { name: "size", type: "uint256" },
          { name: "architectures", type: "string[]" },
          { name: "layers", type: "string[]" },
          { name: "publishedAt", type: "uint256" },
          { name: "publisher", type: "address" },
          { name: "buildInfo", type: "string" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasAccess",
    inputs: [
      { name: "repoId", type: "bytes32" },
      { name: "user", type: "address" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getUserRepositories",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bytes32[]" }],
    stateMutability: "view",
  },
] as const;

// ============================================================================
// Module Interface
// ============================================================================

export interface ContainersModule {
  // Repository Management
  createRepository(params: CreateRepositoryParams): Promise<Hex>;
  getRepository(repoId: Hex): Promise<ContainerRepository>;
  getRepositoryByName(fullName: string): Promise<ContainerRepository>;
  listMyRepositories(): Promise<ContainerRepository[]>;
  starRepository(repoId: Hex): Promise<Hex>;
  unstarRepository(repoId: Hex): Promise<Hex>;

  // Access Control
  grantAccess(repoId: Hex, user: Address): Promise<Hex>;
  revokeAccess(repoId: Hex, user: Address): Promise<Hex>;
  hasAccess(repoId: Hex, user?: Address): Promise<boolean>;

  // Image Operations
  publishImage(params: PublishImageParams): Promise<Hex>;
  getManifest(manifestId: Hex): Promise<ImageManifest>;
  getManifestByTag(repoId: Hex, tag: string): Promise<ImageManifest>;
  recordPull(repoId: Hex): Promise<Hex>;

  // Signing
  signImage(params: SignImageParams): Promise<Hex>;

  // Utilities
  getRepoId(namespace: string, name: string): Hex;
  parseImageReference(ref: string): {
    namespace: string;
    name: string;
    tag: string;
  };
}

// ============================================================================
// Implementation
// ============================================================================

export function createContainersModule(
  wallet: JejuWallet,
  network: NetworkType,
): ContainersModule {
  const addresses = getContractAddresses(network);
  const registryAddress = addresses.containerRegistry as Address;

  const visibilityMap: Record<ContainerVisibility, number> = {
    PUBLIC: 0,
    PRIVATE: 1,
    ORGANIZATION: 2,
  };

  const visibilityReverseMap: Record<number, ContainerVisibility> = {
    0: "PUBLIC",
    1: "PRIVATE",
    2: "ORGANIZATION",
  };

  function parseRepository(raw: {
    repoId: Hex;
    name: string;
    namespace: string;
    owner: Address;
    ownerAgentId: bigint;
    description: string;
    visibility: number;
    tags: readonly string[];
    createdAt: bigint;
    updatedAt: bigint;
    pullCount: bigint;
    starCount: bigint;
    isVerified: boolean;
  }): ContainerRepository {
    const visibility = visibilityReverseMap[raw.visibility];
    if (!visibility) {
      throw new Error(`Invalid visibility value: ${raw.visibility}`);
    }
    return {
      ...raw,
      visibility,
      tags: [...raw.tags],
    };
  }

  function parseManifest(raw: {
    manifestId: Hex;
    repoId: Hex;
    tag: string;
    digest: string;
    manifestUri: string;
    manifestHash: Hex;
    size: bigint;
    architectures: readonly string[];
    layers: readonly string[];
    publishedAt: bigint;
    publisher: Address;
    buildInfo: string;
  }): ImageManifest {
    return {
      ...raw,
      architectures: [...raw.architectures],
      layers: [...raw.layers],
    };
  }

  async function createRepository(
    params: CreateRepositoryParams,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "createRepository",
      args: [
        params.name,
        params.namespace,
        params.description ?? "",
        visibilityMap[params.visibility ?? "PUBLIC"],
        params.tags ?? [],
      ],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function getRepository(repoId: Hex): Promise<ContainerRepository> {
    const result = await wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "getRepository",
      args: [repoId],
    });

    return parseRepository(result);
  }

  async function getRepositoryByName(
    fullName: string,
  ): Promise<ContainerRepository> {
    const result = await wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "getRepositoryByName",
      args: [fullName],
    });

    return parseRepository(result);
  }

  async function listMyRepositories(): Promise<ContainerRepository[]> {
    const repoIds = await wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "getUserRepositories",
      args: [wallet.address],
    });

    return Promise.all(repoIds.map((id) => getRepository(id)));
  }

  async function starRepository(repoId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "starRepository",
      args: [repoId],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function unstarRepository(repoId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "unstarRepository",
      args: [repoId],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function grantAccess(repoId: Hex, user: Address): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "grantAccess",
      args: [repoId, user],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function revokeAccess(repoId: Hex, user: Address): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "revokeAccess",
      args: [repoId, user],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function hasAccess(repoId: Hex, user?: Address): Promise<boolean> {
    return wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "hasAccess",
      args: [repoId, user ?? wallet.address],
    });
  }

  async function publishImage(params: PublishImageParams): Promise<Hex> {
    // Calculate manifest hash from URI (simplified - in practice would hash actual content)
    const manifestHash = keccak256(toHex(params.manifestUri));

    // Calculate size from layers (simplified)
    const size = BigInt(params.layers.length * 1024 * 1024);

    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "publishImage",
      args: [
        params.repoId,
        params.tag,
        params.manifestUri,
        manifestHash,
        size,
        params.architectures ?? ["amd64"],
        params.layers,
        params.buildInfo ?? "",
      ],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function getManifest(manifestId: Hex): Promise<ImageManifest> {
    const result = await wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "getManifest",
      args: [manifestId],
    });

    return parseManifest(result);
  }

  async function getManifestByTag(
    repoId: Hex,
    tag: string,
  ): Promise<ImageManifest> {
    const result = await wallet.publicClient.readContract({
      address: registryAddress,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "getManifestByTag",
      args: [repoId, tag],
    });

    return parseManifest(result);
  }

  async function recordPull(repoId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "recordPull",
      args: [repoId],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  async function signImage(params: SignImageParams): Promise<Hex> {
    const data = encodeFunctionData({
      abi: CONTAINER_REGISTRY_ABI,
      functionName: "signImage",
      args: [params.manifestId, params.signature, params.publicKeyUri],
    });

    return wallet.sendTransaction({
      to: registryAddress,
      data,
    });
  }

  function getRepoId(namespace: string, name: string): Hex {
    return keccak256(toHex(`${namespace}/${name}`));
  }

  function parseImageReference(ref: string): {
    namespace: string;
    name: string;
    tag: string;
  } {
    // Format: namespace/name:tag or namespace/name (defaults to :latest)
    const [namePath, tag = "latest"] = ref.split(":");
    const parts = namePath.split("/");

    if (parts.length === 1) {
      return { namespace: "library", name: parts[0], tag };
    }

    return {
      namespace: parts.slice(0, -1).join("/"),
      name: parts[parts.length - 1],
      tag,
    };
  }

  return {
    createRepository,
    getRepository,
    getRepositoryByName,
    listMyRepositories,
    starRepository,
    unstarRepository,
    grantAccess,
    revokeAccess,
    hasAccess,
    publishImage,
    getManifest,
    getManifestByTag,
    recordPull,
    signImage,
    getRepoId,
    parseImageReference,
  };
}
