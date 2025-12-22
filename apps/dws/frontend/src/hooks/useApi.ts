import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { DWS_API_URL } from '../config'
import { api } from '../lib/eden'
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

// Eden-based hooks with type safety

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error } = await api.health.get()
      if (error) throw new Error(String(error))
      return data as DWSHealth
    },
    refetchInterval: 30000,
  })
}

export function useStorageHealth() {
  return useQuery({
    queryKey: ['storage-health'],
    queryFn: async () => {
      const { data, error } = await api.storage.health.get()
      if (error) throw new Error(String(error))
      return data
    },
  })
}

export function useCDNStats() {
  return useQuery({
    queryKey: ['cdn-stats'],
    queryFn: async () => {
      const { data, error } = await api.cdn.stats.get()
      if (error) throw new Error(String(error))
      return data as {
        entries: number
        sizeBytes: number
        maxSizeBytes: number
        hitRate: number
      }
    },
  })
}

export function useJobs() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['jobs', address],
    queryFn: async () => {
      const { data, error } = await api.compute.jobs.get({
        headers: { 'x-jeju-address': address || '' },
      })
      if (error) throw new Error(String(error))
      return data as { jobs: ComputeJob[]; total: number }
    },
    enabled: !!address,
    refetchInterval: 5000,
  })
}

export function useSubmitJob() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      command: string
      shell?: string
      timeout?: number
    }) => {
      const { data, error } = await api.compute.jobs.post(
        {
          command: params.command,
          shell: params.shell,
          timeout: params.timeout,
        },
        {
          headers: { 'x-jeju-address': address || '' },
        },
      )
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
    },
  })
}

export function useInference() {
  return useMutation({
    mutationFn: async (params: {
      model?: string
      messages: Array<{ role: string; content: string }>
    }) => {
      const { data, error } = await api.compute.chat.completions.post(params)
      if (error) throw new Error(String(error))
      return data as {
        id: string
        model: string
        choices: Array<{ message: { content: string } }>
        usage: { total_tokens: number }
      }
    },
  })
}

export function useEmbeddings() {
  return useMutation({
    mutationFn: async (params: {
      input: string | string[]
      model?: string
    }) => {
      const { data, error } = await api.compute.embeddings.post(params)
      if (error) throw new Error(String(error))
      return data as {
        data: Array<{ embedding: number[] }>
        model: string
        usage: { total_tokens: number }
      }
    },
  })
}

export function useTrainingRuns() {
  return useQuery({
    queryKey: ['training-runs'],
    queryFn: async () => {
      const { data, error } = await api.compute.training.runs.get()
      if (error) throw new Error(String(error))
      return data as TrainingRun[]
    },
    refetchInterval: 10000,
  })
}

export function useComputeNodes() {
  return useQuery({
    queryKey: ['compute-nodes'],
    queryFn: async () => {
      const { data, error } = await api.compute.nodes.get()
      if (error) throw new Error(String(error))
      return { nodes: data as ComputeNode[] }
    },
    refetchInterval: 30000,
  })
}

// Legacy fetch-based hooks for routes not yet converted to Elysia

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

// Generic hook for any DWS endpoint
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

export function useRegisterNode() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      nodeId: string
      endpoint: string
      region: string
      zone: string
      totalCpu: number
      totalMemoryMb: number
      totalStorageMb: number
    }) => {
      const { data, error } = await api.compute.nodes.register.post({
        address: params.nodeId,
        gpuTier: 'cpu',
        endpoint: params.endpoint,
        region: params.region,
      })
      if (error) throw new Error(String(error))
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compute-nodes'] })
    },
  })
}
