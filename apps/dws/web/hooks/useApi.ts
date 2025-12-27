import type { JsonRecord } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { z } from 'zod'
import { DWS_API_URL } from '../config'
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

// Zod schemas for runtime validation of fetch responses
const S3ListObjectsResponseSchema = z.object({
  Name: z.string(),
  Prefix: z.string(),
  KeyCount: z.number(),
  MaxKeys: z.number(),
  IsTruncated: z.boolean(),
  Contents: z
    .array(
      z.object({
        Key: z.string(),
        LastModified: z.string(),
        ETag: z.string(),
        Size: z.number(),
        StorageClass: z.string().optional(),
      }),
    )
    .optional(),
})

const ScrapingSessionSchema = z.object({
  id: z.string(),
  browserType: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  status: z.string(),
  pageLoads: z.number().optional(),
})

const ScrapingSessionsResponseSchema = z.object({
  sessions: z.array(ScrapingSessionSchema),
})

const ScrapingSessionCreateResponseSchema = z.object({
  sessionId: z.string(),
  browserType: z.string(),
  wsEndpoint: z.string(),
  httpEndpoint: z.string(),
  expiresAt: z.number(),
})

const EmailIndexEntrySchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  date: z.string(),
  size: z.number(),
  read: z.boolean(),
})

const MailboxResponseSchema = z.object({
  mailbox: z.object({
    quotaUsedBytes: z.string(),
    quotaLimitBytes: z.string(),
  }),
  index: z.object({
    inbox: z.array(EmailIndexEntrySchema),
    sent: z.array(EmailIndexEntrySchema),
    drafts: z.array(EmailIndexEntrySchema),
    trash: z.array(EmailIndexEntrySchema),
    spam: z.array(EmailIndexEntrySchema),
    archive: z.array(EmailIndexEntrySchema).optional(),
    folders: z.record(z.string(), z.array(EmailIndexEntrySchema)).optional(),
  }),
  unreadCount: z.number().optional(),
})

// Zod schemas for mutation response validation
const PresignedUrlResponseSchema = z.object({
  url: z.string(),
  expiresAt: z.number(),
})

const SendEmailResponseSchema = z.object({
  success: z.boolean(),
  messageId: z.string(),
})

// Common error response schemas
const S3ErrorSchema = z.object({
  Error: z.object({ Message: z.string().optional() }).optional(),
})

const SimpleErrorSchema = z.object({
  error: z.string().optional(),
})

function parseS3Error(json: unknown, fallback: string): string {
  const parsed = S3ErrorSchema.safeParse(json)
  return parsed.success ? (parsed.data.Error?.Message ?? fallback) : fallback
}

function parseSimpleError(json: unknown, fallback: string): string {
  const parsed = SimpleErrorSchema.safeParse(json)
  return parsed.success ? (parsed.data.error ?? fallback) : fallback
}

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

export function useStorageAnalytics() {
  return useQuery({
    queryKey: ['storage-analytics'],
    queryFn: () =>
      fetchApi<{
        global: {
          totalStorageBytes: number
          totalBandwidthBytes24h: number
          totalRequests24h: number
          totalUploads24h: number
          totalDownloads24h: number
          activeNodes: number
          activeUsers: number
          contentCount: number
          avgResponseTimeMs: number
          errorRate: number
        }
        performance: {
          p50LatencyMs: number
          p95LatencyMs: number
          p99LatencyMs: number
          cacheHitRate: number
        }
        costs: {
          storageCost24h: string
          bandwidthCost24h: string
          totalCost24h: string
          projectedMonthlyCost: string
        }
        trends: {
          storageGrowthRate: number
          bandwidthTrend: number
          requestTrend: number
          costTrend: number
        }
        backends: Array<{
          backend: string
          storageBytes: number
          contentCount: number
          requests24h: number
          bandwidth24h: number
          avgLatencyMs: number
          successRate: number
          status: 'healthy' | 'degraded' | 'down'
        }>
        regions: Array<{
          region: string
          nodeCount: number
          storageBytes: number
          bandwidth24h: number
          requests24h: number
          avgLatencyMs: number
        }>
        topContent: Array<{
          cid: string
          name: string
          requests24h: number
          bandwidth24h: number
          tier: string
          category: string
          trendDirection: 'up' | 'down' | 'stable'
        }>
      }>('/storage/analytics'),
    refetchInterval: 60000, // Refresh every minute
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
    mutationFn: ({ id, payload }: { id: string; payload: JsonRecord }) =>
      postApi<T>(`/workers/${id}/invoke`, payload),
  })
}

// Storage hooks

export function useUploadFile() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: (file: File) => uploadFile('/storage/upload', file, address),
  })
}

// S3 Bucket hooks

export function useS3Buckets() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['s3-buckets', address],
    queryFn: () =>
      fetchApi<{
        Buckets: Array<{ Name: string; CreationDate: string }>
        Owner: { ID: string }
      }>('/s3/', { address }),
    enabled: !!address,
  })
}

export function useCreateS3Bucket() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { name: string; region?: string }) => {
      const headers: Record<string, string> = {}
      if (address) headers['x-jeju-address'] = address
      if (params.region) headers['x-amz-bucket-region'] = params.region

      const response = await fetch(`${DWS_API_URL}/s3/${params.name}`, {
        method: 'PUT',
        headers,
      })

      if (!response.ok) {
        throw new Error(
          parseS3Error(await response.json(), 'Failed to create bucket'),
        )
      }

      return { name: params.name }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s3-buckets'] })
    },
  })
}

export function useDeleteS3Bucket() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (bucketName: string) => {
      const response = await fetch(`${DWS_API_URL}/s3/${bucketName}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(
          parseS3Error(await response.json(), 'Failed to delete bucket'),
        )
      }

      return { name: bucketName }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['s3-buckets'] })
    },
  })
}

export function useS3Objects(bucketName: string, prefix?: string) {
  return useQuery({
    queryKey: ['s3-objects', bucketName, prefix],
    queryFn: async () => {
      const params = new URLSearchParams({ 'list-type': '2' })
      if (prefix) params.set('prefix', prefix)

      const response = await fetch(`${DWS_API_URL}/s3/${bucketName}?${params}`)

      if (!response.ok) {
        throw new Error(
          parseS3Error(await response.json(), 'Failed to list objects'),
        )
      }

      return S3ListObjectsResponseSchema.parse(await response.json())
    },
    enabled: !!bucketName,
  })
}

export function useUploadS3Object() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      bucket: string
      key: string
      file: File
      contentType?: string
    }) => {
      const response = await fetch(
        `${DWS_API_URL}/s3/${params.bucket}/${params.key}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': params.contentType || params.file.type,
          },
          body: params.file,
        },
      )

      if (!response.ok) {
        throw new Error(
          parseS3Error(await response.json(), 'Failed to upload object'),
        )
      }

      return { etag: response.headers.get('ETag') }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['s3-objects', variables.bucket],
      })
    },
  })
}

export function useDeleteS3Object() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { bucket: string; key: string }) => {
      const response = await fetch(
        `${DWS_API_URL}/s3/${params.bucket}/${params.key}`,
        {
          method: 'DELETE',
        },
      )

      if (!response.ok) {
        throw new Error(
          parseS3Error(await response.json(), 'Failed to delete object'),
        )
      }

      return { key: params.key }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['s3-objects', variables.bucket],
      })
    },
  })
}

export function useS3Presign() {
  return useMutation({
    mutationFn: async (params: {
      bucket: string
      key: string
      operation: 'GET' | 'PUT'
      expiresIn?: number
      contentType?: string
    }) => {
      const response = await fetch(`${DWS_API_URL}/s3/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!response.ok) {
        const errorJson: unknown = await response.json()
        const parsed = z
          .object({
            Error: z.object({ Message: z.string().optional() }).optional(),
          })
          .safeParse(errorJson)
        throw new Error(
          parsed.success
            ? (parsed.data.Error?.Message ?? 'Failed to generate presigned URL')
            : 'Failed to generate presigned URL',
        )
      }

      return PresignedUrlResponseSchema.parse(await response.json())
    },
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
    queryFn: () =>
      fetchApi<UserAccount>('/api-marketplace/account', { address }),
    enabled: !!address,
  })
}

export function useDeposit() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (amount: string) =>
      postApi<{ success: boolean; newBalance: string }>(
        '/api-marketplace/account/deposit',
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
      manifests: Array<JsonRecord>
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

// Data Availability hooks

export function useDAHealth() {
  return useQuery({
    queryKey: ['da-health'],
    queryFn: () =>
      fetchApi<{
        status: string
        initialized: boolean
        localOperator: string | null
        localOperatorStatus: string | null
        operators: number
        blobs: { total: number; pending: number; available: number }
        timestamp: number
      }>('/da/health'),
    refetchInterval: 30000,
  })
}

export function useDAStats() {
  return useQuery({
    queryKey: ['da-stats'],
    queryFn: () =>
      fetchApi<{
        blobs: { total: number; pending: number; available: number }
        operators: {
          active: number
          totalCapacityGB: number
          usedCapacityGB: number
        }
        localOperator: {
          address: string
          status: string
          metrics: Record<string, number>
        } | null
      }>('/da/stats'),
  })
}

export function useDAOperators() {
  return useQuery({
    queryKey: ['da-operators'],
    queryFn: () =>
      fetchApi<{
        count: number
        operators: Array<{
          address: string
          endpoint: string
          region: string
          status: string
          capacityGB: number
          usedGB: number
        }>
      }>('/da/operators'),
  })
}

export function useDABlobs(status?: string) {
  return useQuery({
    queryKey: ['da-blobs', status],
    queryFn: () =>
      fetchApi<{
        count: number
        blobs: Array<{
          id: string
          status: string
          size: number
          submitter: string
          submittedAt: number
          expiresAt: number
        }>
      }>(`/da/blobs${status ? `?status=${status}` : ''}`),
  })
}

export function useSubmitBlob() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      data: string
      submitter: string
      namespace?: string
      quorumPercent?: number
      retentionPeriod?: number
    }) =>
      postApi<{
        blobId: string
        commitment: string
        attestation: string
        operators: string[]
      }>('/da/blob', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['da-blobs'] })
      queryClient.invalidateQueries({ queryKey: ['da-stats'] })
    },
  })
}

// Scraping service hooks

export function useScrape() {
  return useMutation({
    mutationFn: (params: {
      url: string
      waitFor?: string
      javascript?: boolean
    }) =>
      postApi<{
        url: string
        html?: string
        title?: string
        statusCode?: number
        headers?: Record<string, string>
        timing?: {
          loadTime: number
          domContentLoaded: number
          firstPaint: number
        }
      }>('/scraping/scrape', params),
  })
}

export function useScrapingHealth() {
  return useQuery({
    queryKey: ['scraping-health'],
    queryFn: () =>
      fetchApi<{
        status: string
        service: string
        nodes: {
          total: number
          active: number
          capacity: number
          inUse: number
        }
        sessions: { active: number }
        endpoints: string[]
      }>('/scraping/health'),
    refetchInterval: 30000,
  })
}

export function useScrapingNodes() {
  return useQuery({
    queryKey: ['scraping-nodes'],
    queryFn: () =>
      fetchApi<{
        nodes: Array<{
          id: string
          region: string
          browserType: string
          maxConcurrent: number
          currentSessions: number
          status: string
          capabilities: string[]
        }>
      }>('/scraping/nodes'),
  })
}

export function useScrapingSessions() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['scraping-sessions', address],
    queryFn: async () => {
      // Sessions endpoint requires auth - fetch with address header
      const response = await fetch(`${DWS_API_URL}/scraping/sessions`, {
        headers: address ? { 'x-jeju-address': address } : {},
      })
      if (!response.ok) return { sessions: [] }
      return ScrapingSessionsResponseSchema.parse(await response.json())
    },
    enabled: !!address,
  })
}

export function useCreateScrapingSession() {
  const { address } = useAccount()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      browserType?: 'chromium' | 'firefox' | 'webkit'
      region?: string
      duration?: number
    }) => {
      const response = await fetch(`${DWS_API_URL}/scraping/sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(address ? { 'x-jeju-address': address } : {}),
        },
        body: JSON.stringify(params),
      })
      if (!response.ok) {
        throw new Error(
          parseSimpleError(await response.json(), 'Failed to create session'),
        )
      }
      return ScrapingSessionCreateResponseSchema.parse(await response.json())
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scraping-sessions'] })
    },
  })
}

// Email service hooks

export function useSendEmail() {
  const { address } = useAccount()

  return useMutation({
    mutationFn: async (params: {
      from: string
      to: string[]
      subject: string
      bodyText: string
      bodyHtml?: string
    }) => {
      const response = await fetch(`${DWS_API_URL}/email/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(address ? { 'x-wallet-address': address } : {}),
        },
        body: JSON.stringify(params),
      })
      if (!response.ok) {
        const errorJson: unknown = await response.json()
        const parsed = z
          .object({ error: z.string().optional() })
          .safeParse(errorJson)
        throw new Error(
          parsed.success
            ? (parsed.data.error ?? 'Failed to send email')
            : 'Failed to send email',
        )
      }
      return SendEmailResponseSchema.parse(await response.json())
    },
  })
}

export function useMailbox() {
  const { address } = useAccount()
  return useQuery({
    queryKey: ['mailbox', address],
    queryFn: async () => {
      const response = await fetch(`${DWS_API_URL}/email/mailbox`, {
        headers: address ? { 'x-wallet-address': address } : {},
      })
      if (!response.ok) {
        throw new Error(
          parseSimpleError(await response.json(), 'Failed to fetch mailbox'),
        )
      }
      return MailboxResponseSchema.parse(await response.json())
    },
    enabled: !!address,
  })
}

// Agents hooks

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () =>
      fetchApi<{
        agents: Array<{
          id: string
          name: string
          owner: string
          status: string
          endpoint: string
          capabilities: string[]
        }>
      }>('/a2a/agents'),
  })
}

export function useAgentTasks(agentId?: string) {
  return useQuery({
    queryKey: ['agent-tasks', agentId],
    queryFn: () =>
      fetchApi<{
        tasks: Array<{
          id: string
          status: string
          input: JsonRecord
          output: JsonRecord | null
          createdAt: number
        }>
      }>(`/a2a/agents/${agentId}/tasks`),
    enabled: !!agentId,
  })
}

// Moderation hooks

export function useModerationHealth() {
  return useQuery({
    queryKey: ['moderation-health'],
    queryFn: () =>
      fetchApi<{
        status: string
        queueLength: number
        moderationMarketplace: string
        banManager: string
      }>('/moderation/health'),
    refetchInterval: 30000,
  })
}

export function useModerationQueue() {
  return useQuery({
    queryKey: ['moderation-queue'],
    queryFn: () =>
      fetchApi<{
        length: number
        items: Array<{
          id: string
          type: 'ban' | 'review' | 'appeal'
          target: string
          reason: string
          service: string
          priority: 'low' | 'normal' | 'high' | 'urgent'
          createdAt: number
          attempts: number
          lastError?: string
        }>
      }>('/moderation/queue'),
  })
}

export function useModerationStatus(address: string | null) {
  return useQuery({
    queryKey: ['moderation-status', address],
    queryFn: () =>
      fetchApi<{
        address: string
        isBanned: boolean
        status: string
        statusCode: number
      }>(`/moderation/status/${address}`),
    enabled: !!address && address.match(/^0x[a-fA-F0-9]{40}$/) !== null,
  })
}

export function useSubmitBan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (params: {
      target: string
      reason: string
      service: 'email' | 'messaging' | 'content' | 'general'
      severity: 'low' | 'medium' | 'high' | 'critical'
      autoban?: boolean
    }) =>
      postApi<{ success: boolean; queued?: boolean; queueId?: string }>(
        '/moderation/ban',
        params,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['moderation-queue'] })
      queryClient.invalidateQueries({ queryKey: ['moderation-health'] })
    },
  })
}

// MCP hooks

export function useMCPTools() {
  return useQuery({
    queryKey: ['mcp-tools'],
    queryFn: () =>
      fetchApi<{
        tools: Array<{
          name: string
          description: string
          inputSchema: JsonRecord
        }>
      }>('/mcp/tools'),
  })
}

export function useMCPResources() {
  return useQuery({
    queryKey: ['mcp-resources'],
    queryFn: () =>
      fetchApi<{
        resources: Array<{
          uri: string
          name: string
          mimeType: string
        }>
      }>('/mcp/resources'),
  })
}
