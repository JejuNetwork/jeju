/**
 * JejuModels SDK - HuggingFace-like Model Registry
 *
 * Provides TypeScript interface for:
 * - Model registration and versioning
 * - Training provenance tracking
 * - Inference endpoint management
 * - Model downloads and access control
 */

import type { Address, Hex } from "viem";
import { encodeFunctionData } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { getContractAddresses } from "../config";

// ============================================================================
// Types
// ============================================================================

export enum ModelType {
  LLM = 0,
  VISION = 1,
  AUDIO = 2,
  MULTIMODAL = 3,
  EMBEDDING = 4,
  CLASSIFIER = 5,
  REGRESSION = 6,
  RL = 7,
  OTHER = 8,
}

export enum LicenseType {
  MIT = 0,
  APACHE_2 = 1,
  GPL_3 = 2,
  CC_BY_4 = 3,
  CC_BY_NC_4 = 4,
  LLAMA_2 = 5,
  CUSTOM = 6,
  PROPRIETARY = 7,
}

export enum AccessLevel {
  PUBLIC = 0,
  GATED = 1,
  ENCRYPTED = 2,
}

export interface Model {
  modelId: Hex;
  name: string;
  organization: string;
  owner: Address;
  ownerAgentId: bigint;
  modelType: ModelType;
  license: LicenseType;
  licenseUri: string;
  accessLevel: AccessLevel;
  description: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  isPublic: boolean;
  isVerified: boolean;
}

export interface ModelVersion {
  versionId: Hex;
  modelId: Hex;
  version: string;
  weightsUri: string;
  weightsHash: Hex;
  weightsSize: bigint;
  configUri: string;
  tokenizerUri: string;
  parameterCount: bigint;
  precision: string;
  publishedAt: number;
  isLatest: boolean;
}

export interface TrainingProvenance {
  modelId: Hex;
  versionId: Hex;
  datasetIds: string[];
  trainingConfigUri: string;
  trainingConfigHash: Hex;
  trainingStarted: number;
  trainingCompleted: number;
  computeProviderUri: string;
  computeJobId: Hex;
  frameworkVersion: string;
  baseModels: string[];
  trainer: Address;
  verified: boolean;
}

export interface ModelMetrics {
  modelId: Hex;
  totalDownloads: bigint;
  totalInferences: bigint;
  totalStars: bigint;
  totalForks: bigint;
  weeklyDownloads: bigint;
  lastUpdated: number;
}

export interface InferenceEndpoint {
  endpointId: Hex;
  modelId: Hex;
  versionId: Hex;
  provider: Address;
  endpointUrl: string;
  pricePerRequest: bigint;
  paymentToken: Address;
  isActive: boolean;
  createdAt: number;
}

export interface CreateModelParams {
  name: string;
  organization: string;
  modelType: ModelType;
  license: LicenseType;
  licenseUri?: string;
  accessLevel: AccessLevel;
  description: string;
  tags: string[];
}

export interface PublishVersionParams {
  modelId: Hex;
  version: string;
  weightsUri: string;
  weightsHash: Hex;
  weightsSize: bigint;
  configUri: string;
  tokenizerUri: string;
  parameterCount: bigint;
  precision: string;
}

export interface RecordProvenanceParams {
  modelId: Hex;
  versionId: Hex;
  datasetIds: string[];
  trainingConfigUri: string;
  trainingConfigHash: Hex;
  trainingStarted: number;
  trainingCompleted: number;
  computeProviderUri: string;
  computeJobId: Hex;
  frameworkVersion: string;
  baseModels: string[];
}

export interface CreateEndpointParams {
  modelId: Hex;
  versionId: Hex;
  endpointUrl: string;
  pricePerRequest: bigint;
  paymentToken?: Address;
}

// ============================================================================
// Contract ABIs
// ============================================================================

const MODEL_REGISTRY_ABI = [
  "function createModel(string name, string organization, uint8 modelType, uint8 license, string licenseUri, uint8 accessLevel, string description, string[] tags) external payable returns (bytes32)",
  "function publishVersion(bytes32 modelId, string version, string weightsUri, bytes32 weightsHash, uint256 weightsSize, string configUri, string tokenizerUri, uint256 parameterCount, string precision) external returns (bytes32)",
  "function recordProvenance(bytes32 modelId, bytes32 versionId, string[] datasetIds, string trainingConfigUri, bytes32 trainingConfigHash, uint256 trainingStarted, uint256 trainingCompleted, string computeProviderUri, bytes32 computeJobId, string frameworkVersion, string[] baseModels) external",
  "function downloadModel(bytes32 modelId) external",
  "function grantAccess(bytes32 modelId, address user) external",
  "function toggleStar(bytes32 modelId) external",
  "function createInferenceEndpoint(bytes32 modelId, bytes32 versionId, string endpointUrl, uint256 pricePerRequest, address paymentToken) external returns (bytes32)",
  "function requestInference(bytes32 modelId, uint256 endpointIndex) external payable",
  "function getModel(bytes32 modelId) external view returns (tuple(bytes32 modelId, string name, string organization, address owner, uint256 ownerAgentId, uint8 modelType, uint8 license, string licenseUri, uint8 accessLevel, string description, string[] tags, uint256 createdAt, uint256 updatedAt, bool isPublic, bool isVerified))",
  "function getModelVersions(bytes32 modelId) external view returns (tuple(bytes32 versionId, bytes32 modelId, string version, string weightsUri, bytes32 weightsHash, uint256 weightsSize, string configUri, string tokenizerUri, uint256 parameterCount, string precision, uint256 publishedAt, bool isLatest)[])",
  "function getLatestVersion(bytes32 modelId) external view returns (tuple(bytes32 versionId, bytes32 modelId, string version, string weightsUri, bytes32 weightsHash, uint256 weightsSize, string configUri, string tokenizerUri, uint256 parameterCount, string precision, uint256 publishedAt, bool isLatest))",
  "function getProvenance(bytes32 versionId) external view returns (tuple(bytes32 modelId, bytes32 versionId, string[] datasetIds, string trainingConfigUri, bytes32 trainingConfigHash, uint256 trainingStarted, uint256 trainingCompleted, string computeProviderUri, bytes32 computeJobId, string frameworkVersion, string[] baseModels, address trainer, bool verified))",
  "function getMetrics(bytes32 modelId) external view returns (tuple(bytes32 modelId, uint256 totalDownloads, uint256 totalInferences, uint256 totalStars, uint256 totalForks, uint256 weeklyDownloads, uint256 lastUpdated))",
  "function getEndpoints(bytes32 modelId) external view returns (tuple(bytes32 endpointId, bytes32 modelId, bytes32 versionId, address provider, string endpointUrl, uint256 pricePerRequest, address paymentToken, bool isActive, uint256 createdAt)[])",
  "function getOrganizationModels(string org) external view returns (bytes32[])",
  "function getTotalModels() external view returns (uint256)",
  "function getAllModelIds(uint256 offset, uint256 limit) external view returns (bytes32[])",
  "function hasAccess(bytes32 modelId, address user) external view returns (bool)",
  "function hasStarred(bytes32 modelId, address user) external view returns (bool)",
  "function uploadFee() external view returns (uint256)",
] as const;

// ============================================================================
// Models Module Interface
// ============================================================================

export interface ModelsModule {
  // Model Queries
  getModel(modelId: Hex): Promise<Model | null>;
  listModels(offset?: number, limit?: number): Promise<Model[]>;
  getOrganizationModels(organization: string): Promise<Model[]>;
  searchModels(query: string): Promise<Model[]>;
  getTotalModels(): Promise<number>;

  // Version Management
  getVersions(modelId: Hex): Promise<ModelVersion[]>;
  getLatestVersion(modelId: Hex): Promise<ModelVersion | null>;
  getProvenance(versionId: Hex): Promise<TrainingProvenance | null>;

  // Metrics & Analytics
  getMetrics(modelId: Hex): Promise<ModelMetrics | null>;
  getEndpoints(modelId: Hex): Promise<InferenceEndpoint[]>;

  // Access Control
  hasAccess(modelId: Hex, user?: Address): Promise<boolean>;
  hasStarred(modelId: Hex, user?: Address): Promise<boolean>;

  // Write Operations
  createModel(
    params: CreateModelParams,
  ): Promise<{ txHash: Hex; modelId: Hex }>;
  publishVersion(
    params: PublishVersionParams,
  ): Promise<{ txHash: Hex; versionId: Hex }>;
  recordProvenance(params: RecordProvenanceParams): Promise<{ txHash: Hex }>;
  downloadModel(modelId: Hex): Promise<{ txHash: Hex }>;
  grantAccess(modelId: Hex, user: Address): Promise<{ txHash: Hex }>;
  toggleStar(modelId: Hex): Promise<{ txHash: Hex }>;
  createEndpoint(
    params: CreateEndpointParams,
  ): Promise<{ txHash: Hex; endpointId: Hex }>;
  requestInference(
    modelId: Hex,
    endpointIndex: number,
    payment?: bigint,
  ): Promise<{ txHash: Hex }>;

  // Constants
  readonly UPLOAD_FEE: bigint;
}

// ============================================================================
// Implementation
// ============================================================================

export function createModelsModule(
  wallet: JejuWallet,
  network: NetworkType,
): ModelsModule {
  const contracts = getContractAddresses(network);
  if (!contracts.modelRegistry) {
    throw new Error(`ModelRegistry contract not deployed on ${network}`);
  }
  const modelRegistryAddress = contracts.modelRegistry;

  let cachedUploadFee: bigint | null = null;

  async function getUploadFee(): Promise<bigint> {
    if (cachedUploadFee !== null) return cachedUploadFee;

    const fee = (await wallet.publicClient.readContract({
      address: modelRegistryAddress,
      abi: MODEL_REGISTRY_ABI,
      functionName: "uploadFee",
      args: [],
    })) as bigint;

    cachedUploadFee = fee;
    return fee;
  }

  return {
    get UPLOAD_FEE(): bigint {
      if (cachedUploadFee === null) {
        throw new Error("Upload fee not yet loaded. Call any write method first.");
      }
      return cachedUploadFee;
    },

    async getModel(modelId: Hex): Promise<Model | null> {
      const data = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getModel",
        args: [modelId],
      })) as {
        modelId: Hex;
        name: string;
        organization: string;
        owner: Address;
        ownerAgentId: bigint;
        modelType: number;
        license: number;
        licenseUri: string;
        accessLevel: number;
        description: string;
        tags: readonly string[];
        createdAt: bigint;
        updatedAt: bigint;
        isPublic: boolean;
        isVerified: boolean;
      };

      if (!data || data.createdAt === 0n) return null;

      return {
        modelId: data.modelId,
        name: data.name,
        organization: data.organization,
        owner: data.owner,
        ownerAgentId: data.ownerAgentId,
        modelType: data.modelType as ModelType,
        license: data.license as LicenseType,
        licenseUri: data.licenseUri,
        accessLevel: data.accessLevel as AccessLevel,
        description: data.description,
        tags: [...data.tags],
        createdAt: Number(data.createdAt),
        updatedAt: Number(data.updatedAt),
        isPublic: data.isPublic,
        isVerified: data.isVerified,
      };
    },

    async listModels(offset = 0, limit = 100): Promise<Model[]> {
      const modelIds = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getAllModelIds",
        args: [BigInt(offset), BigInt(limit)],
      })) as Hex[];

      const models: Model[] = [];
      for (const id of modelIds) {
        const model = await this.getModel(id);
        if (model) models.push(model);
      }
      return models;
    },

    async getOrganizationModels(organization: string): Promise<Model[]> {
      const modelIds = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getOrganizationModels",
        args: [organization],
      })) as Hex[];

      const models: Model[] = [];
      for (const id of modelIds) {
        const model = await this.getModel(id);
        if (model) models.push(model);
      }
      return models;
    },

    async searchModels(query: string): Promise<Model[]> {
      // For now, fetch all and filter locally
      // In production, would use an indexer
      const allModels = await this.listModels(0, 1000);
      const lowerQuery = query.toLowerCase();
      return allModels.filter(
        (m) =>
          m.name.toLowerCase().includes(lowerQuery) ||
          m.description.toLowerCase().includes(lowerQuery) ||
          m.organization.toLowerCase().includes(lowerQuery) ||
          m.tags.some((t) => t.toLowerCase().includes(lowerQuery)),
      );
    },

    async getTotalModels(): Promise<number> {
      const total = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getTotalModels",
        args: [],
      })) as bigint;
      return Number(total);
    },

    async getVersions(modelId: Hex): Promise<ModelVersion[]> {
      const versions = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getModelVersions",
        args: [modelId],
      })) as readonly {
        versionId: Hex;
        modelId: Hex;
        version: string;
        weightsUri: string;
        weightsHash: Hex;
        weightsSize: bigint;
        configUri: string;
        tokenizerUri: string;
        parameterCount: bigint;
        precision: string;
        publishedAt: bigint;
        isLatest: boolean;
      }[];

      return versions.map((v) => ({
        versionId: v.versionId,
        modelId: v.modelId,
        version: v.version,
        weightsUri: v.weightsUri,
        weightsHash: v.weightsHash,
        weightsSize: v.weightsSize,
        configUri: v.configUri,
        tokenizerUri: v.tokenizerUri,
        parameterCount: v.parameterCount,
        precision: v.precision,
        publishedAt: Number(v.publishedAt),
        isLatest: v.isLatest,
      }));
    },

    async getLatestVersion(modelId: Hex): Promise<ModelVersion | null> {
      const v = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getLatestVersion",
        args: [modelId],
      })) as {
        versionId: Hex;
        modelId: Hex;
        version: string;
        weightsUri: string;
        weightsHash: Hex;
        weightsSize: bigint;
        configUri: string;
        tokenizerUri: string;
        parameterCount: bigint;
        precision: string;
        publishedAt: bigint;
        isLatest: boolean;
      };

      if (!v || v.publishedAt === 0n) return null;

      return {
        versionId: v.versionId,
        modelId: v.modelId,
        version: v.version,
        weightsUri: v.weightsUri,
        weightsHash: v.weightsHash,
        weightsSize: v.weightsSize,
        configUri: v.configUri,
        tokenizerUri: v.tokenizerUri,
        parameterCount: v.parameterCount,
        precision: v.precision,
        publishedAt: Number(v.publishedAt),
        isLatest: v.isLatest,
      };
    },

    async getProvenance(versionId: Hex): Promise<TrainingProvenance | null> {
      const p = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getProvenance",
        args: [versionId],
      })) as {
        modelId: Hex;
        versionId: Hex;
        datasetIds: readonly string[];
        trainingConfigUri: string;
        trainingConfigHash: Hex;
        trainingStarted: bigint;
        trainingCompleted: bigint;
        computeProviderUri: string;
        computeJobId: Hex;
        frameworkVersion: string;
        baseModels: readonly string[];
        trainer: Address;
        verified: boolean;
      };

      if (!p || p.trainingStarted === 0n) return null;

      return {
        modelId: p.modelId,
        versionId: p.versionId,
        datasetIds: [...p.datasetIds],
        trainingConfigUri: p.trainingConfigUri,
        trainingConfigHash: p.trainingConfigHash,
        trainingStarted: Number(p.trainingStarted),
        trainingCompleted: Number(p.trainingCompleted),
        computeProviderUri: p.computeProviderUri,
        computeJobId: p.computeJobId,
        frameworkVersion: p.frameworkVersion,
        baseModels: [...p.baseModels],
        trainer: p.trainer,
        verified: p.verified,
      };
    },

    async getMetrics(modelId: Hex): Promise<ModelMetrics | null> {
      const m = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getMetrics",
        args: [modelId],
      })) as {
        modelId: Hex;
        totalDownloads: bigint;
        totalInferences: bigint;
        totalStars: bigint;
        totalForks: bigint;
        weeklyDownloads: bigint;
        lastUpdated: bigint;
      };

      return {
        modelId: m.modelId,
        totalDownloads: m.totalDownloads,
        totalInferences: m.totalInferences,
        totalStars: m.totalStars,
        totalForks: m.totalForks,
        weeklyDownloads: m.weeklyDownloads,
        lastUpdated: Number(m.lastUpdated),
      };
    },

    async getEndpoints(modelId: Hex): Promise<InferenceEndpoint[]> {
      const endpoints = (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "getEndpoints",
        args: [modelId],
      })) as readonly {
        endpointId: Hex;
        modelId: Hex;
        versionId: Hex;
        provider: Address;
        endpointUrl: string;
        pricePerRequest: bigint;
        paymentToken: Address;
        isActive: boolean;
        createdAt: bigint;
      }[];

      return endpoints.map((e) => ({
        endpointId: e.endpointId,
        modelId: e.modelId,
        versionId: e.versionId,
        provider: e.provider,
        endpointUrl: e.endpointUrl,
        pricePerRequest: e.pricePerRequest,
        paymentToken: e.paymentToken,
        isActive: e.isActive,
        createdAt: Number(e.createdAt),
      }));
    },

    async hasAccess(modelId: Hex, user?: Address): Promise<boolean> {
      return (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "hasAccess",
        args: [modelId, user ?? wallet.address],
      })) as boolean;
    },

    async hasStarred(modelId: Hex, user?: Address): Promise<boolean> {
      return (await wallet.publicClient.readContract({
        address: modelRegistryAddress,
        abi: MODEL_REGISTRY_ABI,
        functionName: "hasStarred",
        args: [modelId, user ?? wallet.address],
      })) as boolean;
    },

    async createModel(
      params: CreateModelParams,
    ): Promise<{ txHash: Hex; modelId: Hex }> {
      const fee = await getUploadFee();

      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        value: fee,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "createModel",
          args: [
            params.name,
            params.organization,
            params.modelType,
            params.license,
            params.licenseUri ?? "",
            params.accessLevel,
            params.description,
            params.tags,
          ],
        }),
      });

      // Parse modelId from logs in production
      const modelId = `0x${"0".repeat(64)}` as Hex;
      return { txHash, modelId };
    },

    async publishVersion(
      params: PublishVersionParams,
    ): Promise<{ txHash: Hex; versionId: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "publishVersion",
          args: [
            params.modelId,
            params.version,
            params.weightsUri,
            params.weightsHash,
            params.weightsSize,
            params.configUri,
            params.tokenizerUri,
            params.parameterCount,
            params.precision,
          ],
        }),
      });

      const versionId = `0x${"0".repeat(64)}` as Hex;
      return { txHash, versionId };
    },

    async recordProvenance(
      params: RecordProvenanceParams,
    ): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "recordProvenance",
          args: [
            params.modelId,
            params.versionId,
            params.datasetIds,
            params.trainingConfigUri,
            params.trainingConfigHash,
            BigInt(params.trainingStarted),
            BigInt(params.trainingCompleted),
            params.computeProviderUri,
            params.computeJobId,
            params.frameworkVersion,
            params.baseModels,
          ],
        }),
      });

      return { txHash };
    },

    async downloadModel(modelId: Hex): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "downloadModel",
          args: [modelId],
        }),
      });

      return { txHash };
    },

    async grantAccess(modelId: Hex, user: Address): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "grantAccess",
          args: [modelId, user],
        }),
      });

      return { txHash };
    },

    async toggleStar(modelId: Hex): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "toggleStar",
          args: [modelId],
        }),
      });

      return { txHash };
    },

    async createEndpoint(
      params: CreateEndpointParams,
    ): Promise<{ txHash: Hex; endpointId: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "createInferenceEndpoint",
          args: [
            params.modelId,
            params.versionId,
            params.endpointUrl,
            params.pricePerRequest,
            params.paymentToken ?? "0x0000000000000000000000000000000000000000",
          ],
        }),
      });

      const endpointId = `0x${"0".repeat(64)}` as Hex;
      return { txHash, endpointId };
    },

    async requestInference(
      modelId: Hex,
      endpointIndex: number,
      payment?: bigint,
    ): Promise<{ txHash: Hex }> {
      const txHash = await wallet.sendTransaction({
        to: modelRegistryAddress,
        value: payment ?? 0n,
        data: encodeFunctionData({
          abi: MODEL_REGISTRY_ABI,
          functionName: "requestInference",
          args: [modelId, BigInt(endpointIndex)],
        }),
      });

      return { txHash };
    },
  };
}
