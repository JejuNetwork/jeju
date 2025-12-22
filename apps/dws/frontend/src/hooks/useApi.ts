import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { z } from 'zod'
import { fetchApi, postApi, uploadFile } from '../lib/eden'
import {
  type APIListing,
  type APIProvider,
  apiListingsResponseSchema,
  apiProvidersResponseSchema,
  type CDNStats,
  type CIPipeline,
  type ComputeJob,
  type ComputeNode,
  type Container,
  cdnStatsSchema,
  computeJobsResponseSchema,
  computeNodeSchema,
  containersResponseSchema,
  createListingResponseSchema,
  type DWSHealth,
  depositResponseSchema,
  dwsHealthSchema,
  embeddingsResponseSchema,
  inferenceResponseSchema,
  type KMSKey,
  kmsKeySchema,
  kmsKeysResponseSchema,
  type Package,
  packagesResponseSchema,
  pipelinesResponseSchema,
  type Repository,
  type RPCChain,
  registerNodeResponseSchema,
  repositoriesResponseSchema,
  repositorySchema,
  rpcChainsResponseSchema,
  rpcKeyResponseSchema,
  type Secret,
  secretSchema,
  secretsResponseSchema,
  storageHealthSchema,
  submitJobResponseSchema,
  type TrainingRun,
  trainingRunSchema,
  type UserAccount,
  userAccountSchema,
  type VPNSession,
  vpnRegionsResponseSchema,
  vpnSessionSchema,
  type WorkerFunction,
  workerFunctionSchema,
  workersResponseSchema,
} from '../lib/schemas'

// Health checks
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApi<DWSHealth>('/health', undefined, dwsHealthSchema),
    refetchInterval: 30000,
  })
}

export function useStorageHealth() {
  return useQuery({
    queryKey: ['storage-health'],
    queryFn: () =>
      fetchApi<{ service: string; status: string; backends: string[] }>(
        '/storage/health',
        undefined,
        storageHealthSchema,
      ),
  })
}

export function useCDNStats() {
  return useQuery({
    queryKey: ['cdn-stats'],
    queryFn: () => fetchApi<CDNStats>('/cdn/stats', undefined, cdnStatsSchema),
  })
}

// Compute - Jobs
export function useJobs() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['jobs', address],
    queryFn: () =>
      fetchApi<{ jobs: ComputeJob[]; total: number }>(
        '/compute/jobs',
        { address },
        computeJobsResponseSchema,
      ),
    enabled: !!address,
    refetchInterval: 5000,
  })
}

export function useSubmitJob() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      command: string
      shell?: string
      timeout?: number
    }) =>
      postApi<{ jobId: string; status: string }>(
        '/compute/jobs',
        params,
        { address },
        submitJobResponseSchema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

// Compute - Inference
export function useInference() {
  return useMutation({
    mutationFn: (params: {
      model?: string
      messages: Array<{ role: string; content: string }>
    }) =>
      postApi<{
        id: string
        model: string
        choices: Array<{ message: { content: string } }>
        usage: { total_tokens: number }
      }>(
        '/compute/chat/completions',
        params,
        undefined,
        inferenceResponseSchema,
      ),
  })
}

export function useEmbeddings() {
  return useMutation({
    mutationFn: (params: { input: string | string[]; model?: string }) =>
      postApi<{
        data: Array<{ embedding: number[] }>
        model: string
        usage: { total_tokens: number }
      }>('/compute/embeddings', params, undefined, embeddingsResponseSchema),
  })
}

// Compute - Training
export function useTrainingRuns() {
  return useQuery({
    queryKey: ['training-runs'],
    queryFn: () =>
      fetchApi<TrainingRun[]>(
        '/compute/training/runs',
        undefined,
        z.array(trainingRunSchema),
      ),
    refetchInterval: 10000,
  })
}

export function useComputeNodes() {
  return useQuery({
    queryKey: ['compute-nodes'],
    queryFn: async () => {
      const nodes = await fetchApi<ComputeNode[]>(
        '/compute/nodes',
        undefined,
        z.array(computeNodeSchema),
      )
      return { nodes }
    },
    refetchInterval: 30000,
  })
}

export function useRegisterNode() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      nodeId: string
      endpoint: string
      region: string
      zone: string
      totalCpu: number
      totalMemoryMb: number
      totalStorageMb: number
    }) =>
      postApi<{ nodeId: string; status: string }>(
        '/containers/nodes',
        { ...params, address },
        { address },
        registerNodeResponseSchema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compute-nodes'] })
    },
  })
}

// Containers
export function useContainers() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['containers', address],
    queryFn: () =>
      fetchApi<{ executions: Container[] }>(
        '/containers/executions',
        { address },
        containersResponseSchema,
      ),
    enabled: !!address,
    refetchInterval: 5000,
  })
}

export function useRunContainer() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      image: string
      command?: string[]
      env?: Record<string, string>
      mode?: string
    }) =>
      postApi<Container>(
        '/containers/execute',
        params,
        { address },
        z.object({
          executionId: z.string(),
          instanceId: z.string(),
          image: z.string(),
          status: z.enum([
            'pending',
            'running',
            'completed',
            'failed',
            'cancelled',
          ]),
          submittedAt: z.number(),
          startedAt: z.number().nullable(),
        }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

// Workers
export function useWorkers() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['workers', address],
    queryFn: () =>
      fetchApi<{ functions: WorkerFunction[] }>(
        '/workers',
        { address },
        workersResponseSchema,
      ),
    enabled: !!address,
  })
}

export function useDeployWorker() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      name: string
      code: string
      runtime?: string
      handler?: string
      memory?: number
      timeout?: number
    }) =>
      postApi<WorkerFunction>(
        '/workers',
        { ...params, code: btoa(params.code) },
        { address },
        workerFunctionSchema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

export function useInvokeWorker() {
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Record<string, unknown>
    }) => postApi<Record<string, unknown>>(`/workers/${id}/invoke`, payload),
  })
}

// Storage
export function useUploadFile() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: (file: File) => uploadFile('/storage/upload', file, address),
  })
}

// Git
export function useRepositories(limit = 20) {
  return useQuery({
    queryKey: ['repositories', limit],
    queryFn: () =>
      fetchApi<{ repositories: Repository[]; total: number }>(
        `/git/repos?limit=${limit}`,
        undefined,
        repositoriesResponseSchema,
      ),
  })
}

export function useCreateRepository() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      name: string
      description?: string
      visibility?: string
    }) =>
      postApi<Repository>('/git/repos', params, { address }, repositorySchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

// Packages
export function usePackages(limit = 20) {
  return useQuery({
    queryKey: ['packages', limit],
    queryFn: () =>
      fetchApi<{ packages: Package[]; total: number }>(
        `/pkg/packages?limit=${limit}`,
        undefined,
        packagesResponseSchema,
      ),
  })
}

// CI
export function usePipelines() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['pipelines', address],
    queryFn: () =>
      fetchApi<{ pipelines: CIPipeline[] }>(
        '/ci/pipelines',
        { address },
        pipelinesResponseSchema,
      ),
    enabled: !!address,
    refetchInterval: 10000,
  })
}

// KMS
export function useKMSKeys() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['kms-keys', address],
    queryFn: () =>
      fetchApi<{ keys: KMSKey[] }>(
        '/kms/keys',
        { address },
        kmsKeysResponseSchema,
      ),
    enabled: !!address,
  })
}

export function useCreateKey() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { threshold?: number; totalParties?: number }) =>
      postApi<KMSKey>('/kms/keys', params, { address }, kmsKeySchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kms-keys'] })
    },
  })
}

export function useSecrets() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['secrets', address],
    queryFn: () =>
      fetchApi<{ secrets: Secret[] }>(
        '/kms/vault/secrets',
        { address },
        secretsResponseSchema,
      ),
    enabled: !!address,
  })
}

export function useCreateSecret() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { name: string; value: string; expiresIn?: number }) =>
      postApi<Secret>('/kms/vault/secrets', params, { address }, secretSchema),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
}

// RPC
export function useRPCChains() {
  return useQuery({
    queryKey: ['rpc-chains'],
    queryFn: () =>
      fetchApi<{ chains: RPCChain[] }>(
        '/rpc/chains?testnet=true',
        undefined,
        rpcChainsResponseSchema,
      ),
  })
}

export function useCreateRPCKey() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: (params: { tier?: string }) =>
      postApi<{
        apiKey: string
        tier: string
        limits: { rps: number; daily: number }
      }>('/rpc/keys', params, { address }, rpcKeyResponseSchema),
  })
}

// VPN
export function useVPNRegions() {
  return useQuery({
    queryKey: ['vpn-regions'],
    queryFn: () =>
      fetchApi<{
        regions: Array<{
          code: string
          name: string
          country: string
          nodeCount: number
        }>
      }>('/vpn/regions', undefined, vpnRegionsResponseSchema),
  })
}

export function useCreateVPNSession() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: (params: {
      region?: string
      country?: string
      type?: string
      duration?: number
    }) =>
      postApi<VPNSession>(
        '/vpn/sessions',
        params,
        { address },
        vpnSessionSchema,
      ),
  })
}

// API Marketplace
export function useAPIProviders() {
  return useQuery({
    queryKey: ['api-providers'],
    queryFn: () =>
      fetchApi<{ providers: APIProvider[] }>(
        '/api/providers',
        undefined,
        apiProvidersResponseSchema,
      ),
  })
}

export function useAPIListings(providerId?: string) {
  return useQuery({
    queryKey: ['api-listings', providerId],
    queryFn: () =>
      fetchApi<{ listings: APIListing[] }>(
        `/api/listings${providerId ? `?provider=${providerId}` : ''}`,
        undefined,
        apiListingsResponseSchema,
      ),
  })
}

export function useCreateListing() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      providerId: string
      apiKey: string
      pricePerRequest?: string
    }) =>
      postApi<{ listing: APIListing }>(
        '/api/listings',
        params,
        { address },
        createListingResponseSchema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-listings'] })
    },
  })
}

export function useUserAccount() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['user-account', address],
    queryFn: () =>
      fetchApi<UserAccount>('/api/account', { address }, userAccountSchema),
    enabled: !!address,
  })
}

export function useDeposit() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (amount: string) =>
      postApi<{ success: boolean; newBalance: string }>(
        '/api/account/deposit',
        { amount },
        { address },
        depositResponseSchema,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-account'] })
    },
  })
}
