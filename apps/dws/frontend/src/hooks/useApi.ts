import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { DWS_API_URL } from '../config'
import type {
  APIListing,
  APIProvider,
  CIPipeline,
  ComputeJob,
  ComputeNode,
  Container,
  DWSHealth,
  KMSKey,
  Package,
  Repository,
  RPCChain,
  Secret,
  TrainingRun,
  UserAccount,
  VPNSession,
  WorkerFunction,
} from '../types'

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit & { address?: string },
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  }

  if (options?.address) {
    headers['X-Jeju-Address'] = options.address
  }

  const response = await fetch(`${DWS_API_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ error: response.statusText }))
    throw new Error(error.error || error.message || 'API request failed')
  }

  return response.json()
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchApi<DWSHealth>('/health'),
    refetchInterval: 30000,
  })
}

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
    }) =>
      fetchApi<Container>('/containers/execute', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['containers'] })
    },
  })
}

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
      fetchApi<WorkerFunction>('/workers', {
        method: 'POST',
        body: JSON.stringify({ ...params, code: btoa(params.code) }),
        address,
      }),
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
    }) =>
      fetchApi<unknown>(`/workers/${id}/invoke`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  })
}

export function useJobs() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['jobs', address],
    queryFn: () =>
      fetchApi<{ jobs: ComputeJob[] }>('/compute/jobs', { address }),
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
      fetchApi<{ jobId: string; status: string }>('/compute/jobs', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useStorageHealth() {
  return useQuery({
    queryKey: ['storage-health'],
    queryFn: () =>
      fetchApi<{ service: string; status: string; backends: string[] }>(
        '/storage/health',
      ),
  })
}

export function useUploadFile() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${DWS_API_URL}/storage/upload`, {
        method: 'POST',
        headers: { 'X-Jeju-Address': address || '' },
        body: formData,
      })

      if (!response.ok) throw new Error('Upload failed')
      return response.json()
    },
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
    }) =>
      fetchApi<Repository>('/git/repos', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repositories'] })
    },
  })
}

export function usePackages(limit = 20) {
  return useQuery({
    queryKey: ['packages', limit],
    queryFn: () =>
      fetchApi<{ packages: Package[]; total: number }>(
        `/pkg/packages?limit=${limit}`,
      ),
  })
}

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

export function useInference() {
  return useMutation({
    mutationFn: (params: {
      model?: string
      messages: Array<{ role: string; content: string }>
    }) =>
      fetchApi<{
        id: string
        model: string
        choices: Array<{ message: { content: string } }>
        usage: { total_tokens: number }
      }>('/compute/chat/completions', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useEmbeddings() {
  return useMutation({
    mutationFn: (params: { input: string | string[]; model?: string }) =>
      fetchApi<{
        data: Array<{ embedding: number[] }>
        model: string
        usage: { total_tokens: number }
      }>('/compute/embeddings', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  })
}

export function useTrainingRuns() {
  return useQuery({
    queryKey: ['training-runs'],
    queryFn: () => fetchApi<TrainingRun[]>('/compute/training/runs'),
    refetchInterval: 10000,
  })
}

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
      fetchApi<KMSKey>('/kms/keys', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
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
      fetchApi<Secret>('/kms/vault/secrets', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['secrets'] })
    },
  })
}

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
      fetchApi<{
        apiKey: string
        tier: string
        limits: { rps: number; daily: number }
      }>('/rpc/keys', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
  })
}

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
    }) =>
      fetchApi<VPNSession>('/vpn/sessions', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
  })
}

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
      fetchApi<{ listing: APIListing }>('/api/listings', {
        method: 'POST',
        body: JSON.stringify(params),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-listings'] })
    },
  })
}

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
      fetchApi<{ success: boolean; newBalance: string }>(
        '/api/account/deposit',
        {
          method: 'POST',
          body: JSON.stringify({ amount }),
          address,
        },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-account'] })
    },
  })
}

export function useComputeNodes() {
  return useQuery({
    queryKey: ['compute-nodes'],
    queryFn: () => fetchApi<{ nodes: ComputeNode[] }>('/containers/nodes'),
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
      fetchApi<{ nodeId: string; status: string }>('/containers/nodes', {
        method: 'POST',
        body: JSON.stringify({ ...params, address }),
        address,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compute-nodes'] })
    },
  })
}
