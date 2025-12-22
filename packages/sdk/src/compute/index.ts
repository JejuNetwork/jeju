/**
 * Compute Module - GPU/CPU rentals, inference, triggers
 */

import {
  type Address,
  type Hex,
  formatEther,
  parseEther,
  encodeFunctionData,
  getContract,
} from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { safeGetContract } from "../config";
import {
  COMPUTE_REGISTRY_ABI,
  COMPUTE_RENTAL_ABI,
  INFERENCE_ABI,
  TRIGGER_REGISTRY_ABI,
} from "../contracts";
import { InferenceResponseSchema } from "../shared/schemas";

const GPU_TYPES = [
  "NONE",
  "NVIDIA_RTX_4090",
  "NVIDIA_A100_40GB",
  "NVIDIA_A100_80GB",
  "NVIDIA_H100",
  "NVIDIA_H200",
  "AMD_MI300X",
  "APPLE_M1_MAX",
  "APPLE_M2_ULTRA",
  "APPLE_M3_MAX",
] as const;

const RENTAL_STATUS = [
  "PENDING",
  "ACTIVE",
  "COMPLETED",
  "CANCELLED",
  "DISPUTED",
] as const;

export type GPUType = (typeof GPU_TYPES)[number];
export type RentalStatus = (typeof RENTAL_STATUS)[number];

export interface ProviderInfo {
  address: Address;
  name: string;
  endpoint: string;
  stake: bigint;
  stakeFormatted: string;
  active: boolean;
  agentId: bigint;
  resources?: {
    cpuCores: number;
    memoryGb: number;
    storageGb: number;
    gpuType: GPUType;
    gpuCount: number;
    gpuMemoryGb: number;
    teeSupported: boolean;
  };
  pricing?: {
    pricePerHour: bigint;
    pricePerHourFormatted: string;
    minimumHours: number;
    maximumHours: number;
  };
  available: boolean;
  sshEnabled: boolean;
  dockerEnabled: boolean;
}

export interface ListProvidersOptions {
  gpuType?: GPUType;
  minGpuCount?: number;
  maxPricePerHour?: bigint;
  teeRequired?: boolean;
  sshRequired?: boolean;
  dockerRequired?: boolean;
}

export interface RentalInfo {
  rentalId: Hex;
  user: Address;
  provider: Address;
  status: RentalStatus;
  startTime: number;
  endTime: number;
  totalCost: bigint;
  totalCostFormatted: string;
  paidAmount: bigint;
  sshHost?: string;
  sshPort?: number;
  containerImage?: string;
}

export interface CreateRentalParams {
  provider: Address;
  durationHours: number;
  sshPublicKey?: string;
  containerImage?: string;
  startupScript?: string;
}

export interface InferenceModel {
  provider: Address;
  modelId: string;
  model: string;
  endpoint: string;
  pricePerInputToken: bigint;
  pricePerOutputToken: bigint;
  pricePerToken: string;
  active: boolean;
}

export interface InferenceParams {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface InferenceResult {
  id: string;
  model: string;
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface TriggerInfo {
  triggerId: Hex;
  owner: Address;
  type: "cron" | "webhook" | "event";
  name: string;
  endpoint: string;
  active: boolean;
  executionCount: number;
  lastExecutedAt: number;
  agentId: bigint;
}

export interface CreateTriggerParams {
  type: "cron" | "webhook" | "event";
  name: string;
  endpoint: string;
  cronExpression?: string;
  agentId?: bigint;
}

export interface ComputeModule {
  // Provider discovery
  listProviders(options?: ListProvidersOptions): Promise<ProviderInfo[]>;
  getProvider(address: Address): Promise<ProviderInfo>;

  // Rentals
  getQuote(
    provider: Address,
    durationHours: number,
  ): Promise<{ cost: bigint; costFormatted: string }>;
  createRental(params: CreateRentalParams): Promise<Hex>;
  getRental(rentalId: Hex): Promise<RentalInfo>;
  listMyRentals(): Promise<RentalInfo[]>;
  cancelRental(rentalId: Hex): Promise<Hex>;
  extendRental(rentalId: Hex, additionalHours: number): Promise<Hex>;

  // Inference
  listModels(): Promise<InferenceModel[]>;
  inference(params: InferenceParams): Promise<InferenceResult>;

  // Triggers
  listTriggers(): Promise<TriggerInfo[]>;
  getTrigger(triggerId: Hex): Promise<TriggerInfo>;
  createTrigger(params: CreateTriggerParams): Promise<Hex>;
  getPrepaidBalance(): Promise<bigint>;
  depositPrepaid(amount: bigint): Promise<Hex>;
}

export function createComputeModule(
  wallet: JejuWallet,
  network: NetworkType,
): ComputeModule {
  const registryAddress = safeGetContract("compute", "registry", network);
  const rentalAddress = safeGetContract("compute", "rental", network);
  const inferenceAddress = safeGetContract("compute", "inference", network);
  const triggerAddress = safeGetContract("compute", "triggerRegistry", network);

  // If core contracts aren't available, return stub module
  if (!registryAddress || !rentalAddress || !inferenceAddress) {
    return createStubComputeModule();
  }

  const registry = getContract({
    address: registryAddress,
    abi: COMPUTE_REGISTRY_ABI,
    client: wallet.publicClient,
  });

  const rental = getContract({
    address: rentalAddress,
    abi: COMPUTE_RENTAL_ABI,
    client: wallet.publicClient,
  });

  const inference = getContract({
    address: inferenceAddress,
    abi: INFERENCE_ABI,
    client: wallet.publicClient,
  });

  const triggerRegistry = triggerAddress
    ? getContract({
        address: triggerAddress,
        abi: TRIGGER_REGISTRY_ABI,
        client: wallet.publicClient,
      })
    : null;

  async function listProviders(
    options?: ListProvidersOptions,
  ): Promise<ProviderInfo[]> {
    const addresses = (await registry.read.getAllProviders()) as Address[];
    const providers: ProviderInfo[] = [];

    for (const addr of addresses.slice(0, 50)) {
      const isActive = await registry.read.isActive([addr]);
      if (!isActive) continue;

      const info = (await registry.read.getProvider([addr])) as {
        name: string;
        endpoint: string;
        stake: bigint;
        active: boolean;
        registeredAt: bigint;
        agentId: bigint;
      };

      const resources = (await rental.read.getProviderResources([addr])) as {
        resources: {
          cpuCores: bigint;
          memoryGb: bigint;
          storageGb: bigint;
          bandwidthMbps: bigint;
          gpuType: number;
          gpuCount: bigint;
          gpuMemoryGb: bigint;
          teeSupported: boolean;
        };
        pricing: {
          pricePerHour: bigint;
          minimumRentalHours: bigint;
          maximumRentalHours: bigint;
          depositRequired: bigint;
        };
        activeRentals: bigint;
        maxConcurrentRentals: bigint;
        available: boolean;
        sshEnabled: boolean;
        dockerEnabled: boolean;
      };

      const gpuType = GPU_TYPES[resources.resources.gpuType];
      if (!gpuType) {
        throw new Error(`Invalid GPU type index: ${resources.resources.gpuType}`);
      }

      // Apply filters
      if (options?.gpuType && gpuType !== options.gpuType) continue;
      if (
        options?.minGpuCount &&
        Number(resources.resources.gpuCount) < options.minGpuCount
      )
        continue;
      if (
        options?.maxPricePerHour &&
        resources.pricing.pricePerHour > options.maxPricePerHour
      )
        continue;
      if (options?.teeRequired && !resources.resources.teeSupported) continue;
      if (options?.sshRequired && !resources.sshEnabled) continue;
      if (options?.dockerRequired && !resources.dockerEnabled) continue;

      providers.push({
        address: addr,
        name: info.name,
        endpoint: info.endpoint,
        stake: info.stake,
        stakeFormatted: formatEther(info.stake),
        active: info.active,
        agentId: info.agentId,
        resources: {
          cpuCores: Number(resources.resources.cpuCores),
          memoryGb: Number(resources.resources.memoryGb),
          storageGb: Number(resources.resources.storageGb),
          gpuType,
          gpuCount: Number(resources.resources.gpuCount),
          gpuMemoryGb: Number(resources.resources.gpuMemoryGb),
          teeSupported: resources.resources.teeSupported,
        },
        pricing: {
          pricePerHour: resources.pricing.pricePerHour,
          pricePerHourFormatted: formatEther(resources.pricing.pricePerHour),
          minimumHours: Number(resources.pricing.minimumRentalHours),
          maximumHours: Number(resources.pricing.maximumRentalHours),
        },
        available: resources.available,
        sshEnabled: resources.sshEnabled,
        dockerEnabled: resources.dockerEnabled,
      });
    }

    return providers;
  }

  async function getProvider(address: Address): Promise<ProviderInfo> {
    const providers = await listProviders();
    const provider = providers.find(
      (p) => p.address.toLowerCase() === address.toLowerCase(),
    );
    if (!provider) throw new Error(`Provider ${address} not found`);
    return provider;
  }

  async function getQuote(provider: Address, durationHours: number) {
    const cost = (await rental.read.calculateRentalCost([
      provider,
      BigInt(durationHours),
    ])) as bigint;
    return { cost, costFormatted: formatEther(cost) };
  }

  async function createRental(params: CreateRentalParams): Promise<Hex> {
    const { cost } = await getQuote(params.provider, params.durationHours);

    const data = encodeFunctionData({
      abi: COMPUTE_RENTAL_ABI,
      functionName: "createRental",
      args: [
        params.provider,
        BigInt(params.durationHours),
        params.sshPublicKey ?? "",
        params.containerImage ?? "",
        params.startupScript ?? "",
      ],
    });

    return wallet.sendTransaction({
      to: rentalAddress,
      value: cost,
      data,
    });
  }

  async function getRental(rentalId: Hex): Promise<RentalInfo> {
    const r = (await rental.read.getRental([rentalId])) as {
      rentalId: Hex;
      user: Address;
      provider: Address;
      status: number;
      startTime: bigint;
      endTime: bigint;
      totalCost: bigint;
      paidAmount: bigint;
      refundedAmount: bigint;
      sshPublicKey: string;
      containerImage: string;
      startupScript: string;
      sshHost: string;
      sshPort: number;
    };

    return {
      rentalId: r.rentalId,
      user: r.user,
      provider: r.provider,
      status: RENTAL_STATUS[r.status] ?? (() => { throw new Error(`Invalid rental status: ${r.status}`); })(),
      startTime: Number(r.startTime),
      endTime: Number(r.endTime),
      totalCost: r.totalCost,
      totalCostFormatted: formatEther(r.totalCost),
      paidAmount: r.paidAmount,
      sshHost: r.sshHost || undefined,
      sshPort: r.sshPort || undefined,
      containerImage: r.containerImage || undefined,
    };
  }

  async function listMyRentals(): Promise<RentalInfo[]> {
    const rentalIds = (await rental.read.getUserRentals([
      wallet.address,
    ])) as Hex[];
    const rentals: RentalInfo[] = [];

    for (const id of rentalIds.slice(-20)) {
      rentals.push(await getRental(id));
    }

    return rentals.reverse();
  }

  async function cancelRental(rentalId: Hex): Promise<Hex> {
    const data = encodeFunctionData({
      abi: COMPUTE_RENTAL_ABI,
      functionName: "cancelRental",
      args: [rentalId],
    });

    return wallet.sendTransaction({ to: rentalAddress, data });
  }

  async function extendRental(
    rentalId: Hex,
    additionalHours: number,
  ): Promise<Hex> {
    const r = await getRental(rentalId);
    const { cost } = await getQuote(r.provider, additionalHours);

    const data = encodeFunctionData({
      abi: COMPUTE_RENTAL_ABI,
      functionName: "extendRental",
      args: [rentalId, BigInt(additionalHours)],
    });

    return wallet.sendTransaction({ to: rentalAddress, value: cost, data });
  }

  async function listModels(): Promise<InferenceModel[]> {
    const providers = await listProviders();
    const models: InferenceModel[] = [];

    for (const provider of providers.slice(0, 20)) {
      const services = (await inference.read.getServices([
        provider.address,
      ])) as Array<{
        provider: Address;
        model: string;
        endpoint: string;
        pricePerInputToken: bigint;
        pricePerOutputToken: bigint;
        active: boolean;
      }>;

      for (const svc of services) {
        if (svc.active) {
          models.push({
            provider: svc.provider,
            modelId: svc.model,
            model: svc.model,
            endpoint: svc.endpoint,
            pricePerInputToken: svc.pricePerInputToken,
            pricePerOutputToken: svc.pricePerOutputToken,
            pricePerToken: formatEther(
              svc.pricePerInputToken + svc.pricePerOutputToken,
            ),
            active: svc.active,
          });
        }
      }
    }

    return models;
  }

  async function inferenceCall(
    params: InferenceParams,
  ): Promise<InferenceResult> {
    const models = await listModels();
    const model = models.find((m) => m.model === params.model);
    if (!model) throw new Error(`Model ${params.model} not found`);

    // Call the provider's inference endpoint
    const response = await fetch(`${model.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jeju-address": wallet.address,
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.maxTokens ?? 1024,
        stream: params.stream ?? false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Inference failed: ${response.statusText}`);
    }

    const rawData: unknown = await response.json();
    const data = InferenceResponseSchema.parse(rawData);

    if (data.choices.length === 0) {
      throw new Error("Invalid inference response: empty choices array");
    }

    const firstChoice = data.choices[0];
    return {
      id: data.id,
      model: data.model,
      content: firstChoice.message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
    };
  }

  async function listTriggers(): Promise<TriggerInfo[]> {
    if (!triggerRegistry) return [];

    const triggerIds = (await triggerRegistry.read.getOwnerTriggers([
      wallet.address,
    ])) as Hex[];
    const triggers: TriggerInfo[] = [];

    for (const id of triggerIds) {
      triggers.push(await getTrigger(id));
    }

    return triggers;
  }

  async function getTrigger(triggerId: Hex): Promise<TriggerInfo> {
    if (!triggerRegistry) throw new Error("Trigger registry not configured");

    const t = (await triggerRegistry.read.getTrigger([triggerId])) as [
      Address,
      number,
      string,
      string,
      boolean,
      bigint,
      bigint,
      bigint,
    ];

    const typeMap = ["cron", "webhook", "event"] as const;

    return {
      triggerId,
      owner: t[0],
      type: typeMap[t[1]] ?? (() => { throw new Error(`Invalid trigger type: ${t[1]}`); })(),
      name: t[2],
      endpoint: t[3],
      active: t[4],
      executionCount: Number(t[5]),
      lastExecutedAt: Number(t[6]),
      agentId: t[7],
    };
  }

  async function createTrigger(params: CreateTriggerParams): Promise<Hex> {
    if (!triggerRegistry || !triggerAddress)
      throw new Error("Trigger registry not configured");

    const typeMap = { cron: 0, webhook: 1, event: 2 };
    const data = encodeFunctionData({
      abi: TRIGGER_REGISTRY_ABI,
      functionName: "registerTrigger",
      args: [
        typeMap[params.type],
        params.name,
        params.endpoint,
        params.cronExpression ?? "",
        params.agentId ?? 0n,
      ],
    });

    return wallet.sendTransaction({
      to: triggerAddress,
      value: parseEther("0.01"),
      data,
    });
  }

  async function getPrepaidBalance(): Promise<bigint> {
    if (!triggerRegistry) return 0n;
    return (await triggerRegistry.read.prepaidBalances([
      wallet.address,
    ])) as bigint;
  }

  async function depositPrepaid(amount: bigint): Promise<Hex> {
    if (!triggerAddress) throw new Error("Trigger registry not configured");
    return wallet.sendTransaction({ to: triggerAddress, value: amount });
  }

  return {
    listProviders,
    getProvider,
    getQuote,
    createRental,
    getRental,
    listMyRentals,
    cancelRental,
    extendRental,
    listModels,
    inference: inferenceCall,
    listTriggers,
    getTrigger,
    createTrigger,
    getPrepaidBalance,
    depositPrepaid,
  };
}

/**
 * Create a stub compute module when contracts aren't deployed
 */
function createStubComputeModule(): ComputeModule {
  const notAvailable = (): never => {
    throw new Error("Compute contracts not deployed on this network");
  };

  const emptyProviderInfo: ProviderInfo = {
    address: "0x0000000000000000000000000000000000000000" as Address,
    name: "",
    endpoint: "",
    stake: 0n,
    stakeFormatted: "0",
    active: false,
    agentId: 0n,
    available: false,
    sshEnabled: false,
    dockerEnabled: false,
  };

  const emptyRentalInfo: RentalInfo = {
    rentalId: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    user: "0x0000000000000000000000000000000000000000" as Address,
    provider: "0x0000000000000000000000000000000000000000" as Address,
    status: "PENDING",
    startTime: 0,
    endTime: 0,
    totalCost: 0n,
    totalCostFormatted: "0",
    paidAmount: 0n,
  };

  const emptyTriggerInfo: TriggerInfo = {
    triggerId: "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex,
    owner: "0x0000000000000000000000000000000000000000" as Address,
    type: "cron",
    name: "",
    endpoint: "",
    active: false,
    executionCount: 0,
    lastExecutedAt: 0,
    agentId: 0n,
  };
  
  return {
    listProviders: async () => [],
    getProvider: async () => emptyProviderInfo,
    listModels: async () => [],
    listMyRentals: async () => [],
    listTriggers: async () => [],
    getPrepaidBalance: async () => 0n,
    getQuote: async () => ({ cost: 0n, costFormatted: "0" }),
    inference: notAvailable,
    createRental: notAvailable,
    cancelRental: notAvailable,
    extendRental: notAvailable,
    getRental: async () => emptyRentalInfo,
    getTrigger: async () => emptyTriggerInfo,
    createTrigger: notAvailable,
    depositPrepaid: notAvailable,
  };
}
