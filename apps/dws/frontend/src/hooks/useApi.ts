import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { fetchApi, postApi, uploadFile } from '../lib/eden'
import type {
  APIListing,
  APIProvider,
  CIPipeline,
  ComputeJob,
  ComputeNode,
  Container,
  DWSHealth,
  HelmDeployment,
  K3sCluster,
  KMSKey,
  MeshService,
  Package,
  Repository,
  RPCChain,
  Secret,
  TrainingRun,
  UserAccount,
  VPNSession,
  WorkerdWorker,
  WorkerFunction,
} from '../types'

// Health and status hooks

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApi<DWSHealth>('/health'),
    refetchInterval: 30000,
  })
}

export function useStorageHealth() {
  return useQuery({
    queryKey: ['storage-health'],
    queryFn: () =>
      fetchApi<{
        service: string
        status: 'healthy' | 'unhealthy'
        backends: string[]
        health: Record<string, boolean>
        stats: {
          entries?: number
          sizeBytes?: number
          maxSizeBytes?: number
        }
      }>('/storage/health'),
  })
}

export function useCDNStats() {
  return useQuery({
    queryKey: ['cdn-stats'],
    queryFn: () =>
      fetchApi<{
        entries: number
        sizeBytes: number
        maxSizeBytes: number
        hitRate: number
      }>('/cdn/stats'),
  })
}

// Compute hooks

export function useJobs() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['jobs', address],
    queryFn: () =>
      fetchApi<{ jobs: ComputeJob[]; total: number }>('/compute/jobs', {
        address,
      }),
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
    }) => postApi<{ jobId: string }>('/compute/jobs', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

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
      }>('/compute/chat/completions', params),
  })
}

export function useEmbeddings() {
  return useMutation({
    mutationFn: (params: { input: string | string[]; model?: string }) =>
      postApi<{
        data: Array<{ embedding: number[] }>
        model: string
        usage: { total_tokens: number }
      }>('/compute/embeddings', params),
  })
}

export function useTrainingRuns() {
  return useQuery({
    queryKey: ['training-runs'],
    queryFn: () => fetchApi<TrainingRun[]>('/compute/training/runs'),
    refetchInterval: 10000,
  })
}

export function useComputeNodes() {
  return useQuery({
    queryKey: ['compute-nodes'],
    queryFn: () => fetchApi<{ nodes: ComputeNode[] }>('/compute/nodes'),
    refetchInterval: 30000,
  })
}

// Generic DWS API hook

export function useDWSApi<T>(
  endpoint: string,
  options?: { enabled?: boolean; refetchInterval?: number },
) {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['dws-api', endpoint, address],
    queryFn: () => fetchApi<T>(endpoint, { address }),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
  })
}

// Container hooks

export function useContainers() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['containers', address],
    queryFn: () =>
      fetchApi<{ executions: Container[] }>('/containers/executions', {
        address,
      }),
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
    }) => postApi<Container>('/containers/execute', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

// Worker hooks

export function useWorkers() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['workers', address],
    queryFn: () =>
      fetchApi<{ functions: WorkerFunction[] }>('/workers', { address }),
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
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workers'] })
    },
  })
}

export function useInvokeWorker<
  T = { result: string; executionTime: number },
>() {
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Record<string, unknown>
    }) => postApi<T>(`/workers/${id}/invoke`, payload),
  })
}

// Storage hooks

export function useUploadFile() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: (file: File) => uploadFile('/storage/upload', file, address),
  })
}

// Git hooks

export function useRepositories(limit = 20) {
  return useQuery({
    queryKey: ['repositories', limit],
    queryFn: () =>
      fetchApi<{ repositories: Repository[]; total: number }>(
        `/git/repos?limit=${limit}`,
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
    }) => postApi<Repository>('/git/repos', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

// Package hooks

export function usePackages(limit = 20) {
  return useQuery({
    queryKey: ['packages', limit],
    queryFn: () =>
      fetchApi<{ packages: Package[]; total: number }>(
        `/pkg/packages?limit=${limit}`,
      ),
  })
}

// CI hooks

export function usePipelines() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['pipelines', address],
    queryFn: () =>
      fetchApi<{ pipelines: CIPipeline[] }>('/ci/pipelines', { address }),
    enabled: !!address,
    refetchInterval: 10000,
  })
}

// KMS hooks

export function useKMSKeys() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['kms-keys', address],
    queryFn: () => fetchApi<{ keys: KMSKey[] }>('/kms/keys', { address }),
    enabled: !!address,
  })
}

export function useCreateKey() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { threshold?: number; totalParties?: number }) =>
      postApi<KMSKey>('/kms/keys', params, { address }),
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
      fetchApi<{ secrets: Secret[] }>('/kms/vault/secrets', { address }),
    enabled: !!address,
  })
}

export function useCreateSecret() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { name: string; value: string; expiresIn?: number }) =>
      postApi<Secret>('/kms/vault/secrets', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
}

// RPC hooks

export function useRPCChains() {
  return useQuery({
    queryKey: ['rpc-chains'],
    queryFn: () => fetchApi<{ chains: RPCChain[] }>('/rpc/chains?testnet=true'),
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
      }>('/rpc/keys', params, { address }),
  })
}

// VPN hooks

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
      }>('/vpn/regions'),
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
    }) => postApi<VPNSession>('/vpn/sessions', params, { address }),
  })
}

// API Marketplace hooks

export function useAPIProviders() {
  return useQuery({
    queryKey: ['api-providers'],
    queryFn: () => fetchApi<{ providers: APIProvider[] }>('/api/providers'),
  })
}

export function useAPIListings(providerId?: string) {
  return useQuery({
    queryKey: ['api-listings', providerId],
    queryFn: () =>
      fetchApi<{ listings: APIListing[] }>(
        `/api/listings${providerId ? `?provider=${providerId}` : ''}`,
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
      postApi<{ listing: APIListing }>('/api/listings', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-listings'] })
    },
  })
}

// Account hooks

export function useUserAccount() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['user-account', address],
    queryFn: () => fetchApi<UserAccount>('/api/account', { address }),
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
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-account'] })
    },
  })
}

// Node registration hook

export function useRegisterNode() {
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
      postApi<{ agentId: string }>('/compute/nodes/register', {
        address: params.nodeId,
        gpuTier: 'cpu',
        endpoint: params.endpoint,
        region: params.region,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compute-nodes'] })
    },
  })
}

// Infrastructure hooks

export function useK3sClusters() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['k3s-clusters', address],
    queryFn: () =>
      fetchApi<{ clusters: K3sCluster[] }>('/k3s/clusters', { address }),
  })
}

export function useCreateK3sCluster() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { name: string; provider: string; nodes: number }) =>
      postApi<{ name: string }>('/k3s/clusters', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['k3s-clusters'] })
    },
  })
}

export function useHelmDeployments() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['helm-deployments', address],
    queryFn: () =>
      fetchApi<{ deployments: HelmDeployment[] }>('/helm/deployments', {
        address,
      }),
  })
}

export function useApplyHelmManifests() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      release: string
      namespace: string
      manifests: Array<Record<string, unknown>>
    }) => postApi<{ id: string }>('/helm/apply', params, { address }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['helm-deployments'] })
    },
  })
}

export function useWorkerdWorkers() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['workerd-workers', address],
    queryFn: () =>
      fetchApi<{ workers: WorkerdWorker[] }>('/workerd', { address }),
  })
}

export function useDeployWorkerdWorker() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: { name: string; code: string }) =>
      postApi<{ id: string }>(
        '/workerd',
        { name: params.name, code: btoa(params.code) },
        { address },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workerd-workers'] })
    },
  })
}

export function useMeshHealth() {
  return useQuery({
    queryKey: ['mesh-health'],
    queryFn: () =>
      fetchApi<{ status: string; services: MeshService[] }>('/mesh/health'),
  })
}
