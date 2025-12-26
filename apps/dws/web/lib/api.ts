/** DWS API Client - always same-origin (dev proxy or production) */

interface FetchOptions extends RequestInit {
  address?: string
}

async function apiFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  const { address, ...rest } = opts
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  }
  if (address) headers['x-jeju-address'] = address

  const res = await fetch(path, { ...rest, headers })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error || `API ${res.status}`)
  }
  return res.json()
}

async function safeFetch<T>(
  path: string,
  opts: FetchOptions,
  fallback: T,
): Promise<T> {
  const { address, ...rest } = opts
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  }
  if (address) headers['x-jeju-address'] = address

  const res = await fetch(path, { ...rest, headers })

  if (res.status === 401 || res.status === 403)
    throw new Error(`Auth: ${res.status}`)
  if (res.status >= 500) throw new Error(`Server: ${res.status}`)
  if (res.status === 404 || !res.ok) return fallback

  return res.json()
}

// Types
export interface Deployment {
  id: string
  appName: string
  domain: string
  status: 'deploying' | 'active' | 'failed' | 'stopped'
  version: string
  commit?: string
  branch?: string
  createdAt: number
  updatedAt: number
  url: string
  framework?: string
  region: string
  owner?: string
}

export interface EdgeFunction {
  id: string
  name: string
  routes: string[]
  runtime: 'v8-isolate' | 'bun' | 'wasm'
  region: string
  status: 'active' | 'deploying' | 'stopped' | 'error'
  memoryMb: number
  cpuMs: number
  invocations: number
  avgLatency: number
  lastDeployed: number
}

export interface NodeInfo {
  nodeId: string
  operator: string
  endpoint: string
  services: string[]
  region: string
  stake: string
  status: 'active' | 'offline' | 'syncing'
  teePlatform: string
  attestationHash?: string
  lastSeen: number
  resources?: {
    cpu: number
    memory: number
    storage: number
    bandwidth: number
  }
  earnings?: { total: string; pending: string }
}

export interface MarketplaceListing {
  id: string
  providerId: string
  name: string
  description: string
  type: 'compute' | 'storage' | 'inference'
  pricing: { pricePerUnit: string; unit: string }
  capabilities: string[]
  status: 'active' | 'paused'
}

export interface DomainRecord {
  id: string
  name: string
  type: 'jns' | 'custom'
  target: string
  targetType: 'app' | 'ipfs' | 'address'
  status: 'active' | 'pending' | 'error'
  ssl: 'active' | 'pending' | 'none'
  expiresAt?: number
  records: Array<{ type: string; name: string; value: string; ttl: number }>
}

// APIs
export const deploymentsApi = {
  list: (addr: string) =>
    safeFetch<{ deployments: Deployment[] }>(
      '/deploy/list',
      { address: addr },
      { deployments: [] },
    ).then((r) => r.deployments),
  deploy: (
    addr: string,
    req: { gitUrl: string; branch: string; framework?: string; region: string },
  ) =>
    apiFetch<Deployment>('/deploy/', {
      method: 'POST',
      address: addr,
      body: JSON.stringify({
        manifest: {
          name: req.gitUrl.split('/').pop()?.replace('.git', '') || 'app',
          git: { url: req.gitUrl, branch: req.branch },
          framework: req.framework || 'auto',
          region: req.region,
        },
      }),
    }),
  getStatus: (addr: string, app: string) =>
    apiFetch<Deployment>(`/deploy/status/${app}`, { address: addr }),
  rollback: (addr: string, id: string) =>
    apiFetch(`/deploy/${id}/rollback`, { method: 'POST', address: addr }),
  delete: (addr: string, id: string) =>
    apiFetch(`/deploy/${id}`, { method: 'DELETE', address: addr }),
}

export const functionsApi = {
  list: (addr: string) =>
    safeFetch<{ workers: EdgeFunction[] }>(
      '/workers/',
      { address: addr },
      { workers: [] },
    ).then((r) => r.workers),
  deploy: (
    addr: string,
    req: {
      name: string
      code: string
      routes: string[]
      memoryMb: number
      cpuMs: number
    },
  ) =>
    apiFetch<EdgeFunction>('/workers/', {
      method: 'POST',
      address: addr,
      body: JSON.stringify({
        name: req.name,
        code: btoa(req.code),
        routes: req.routes,
        config: { memoryMb: req.memoryMb, timeoutMs: req.cpuMs },
      }),
    }),
  invoke: (id: string, path = '/') => fetch(`/workers/${id}/invoke${path}`),
  getLogs: (id: string, lines = 100) =>
    apiFetch<{ logs: string[] }>(`/workers/${id}/logs?lines=${lines}`).then(
      (r) => r.logs,
    ),
  delete: (addr: string, id: string) =>
    apiFetch(`/workers/${id}`, { method: 'DELETE', address: addr }),
}

export const nodesApi = {
  list: () =>
    safeFetch<{ nodes: NodeInfo[] }>(
      '/terraform/v1/data/dws_nodes',
      {},
      { nodes: [] },
    ).then((r) => r.nodes),
  getSelf: (addr: string) =>
    safeFetch<NodeInfo | null>('/node/status', { address: addr }, null),
  getEarnings: (addr: string) =>
    apiFetch<{
      total: string
      pending: string
      breakdown: Record<string, string>
    }>('/node/earnings', { address: addr }),
  register: (
    addr: string,
    cfg: {
      endpoint: string
      services: string[]
      region: string
      stake: string
      teePlatform: string
    },
  ) =>
    apiFetch<NodeInfo>('/terraform/v1/resources/dws_node', {
      method: 'POST',
      address: addr,
      body: JSON.stringify(cfg),
    }),
}

export const marketplaceApi = {
  listListings: () =>
    safeFetch<{ listings: MarketplaceListing[] }>(
      '/api/marketplace/listings',
      {},
      { listings: [] },
    ).then((r) => r.listings),
  getProviders: () =>
    safeFetch<{
      providers: Array<{
        id: string
        address: string
        name: string
        capabilities: string[]
        reputation: number
      }>
    }>('/api/marketplace/providers', {}, { providers: [] }).then(
      (r) => r.providers,
    ),
  getStats: () =>
    apiFetch<{
      totalProviders: number
      totalListings: number
      totalRequests: number
    }>('/api/marketplace/stats'),
  getBalance: (addr: string) =>
    apiFetch<{ balance: string; deposited: string; spent: string }>(
      '/api/marketplace/account/balance',
      { address: addr },
    ),
}

export const domainsApi = {
  list: (addr: string) =>
    safeFetch<{ domains: DomainRecord[] }>(
      '/terraform/v1/resources/dws_domain',
      { address: addr },
      { domains: [] },
    ).then((r) => r.domains),
  register: (
    addr: string,
    d: { name: string; target: string; targetType: string; autoSsl: boolean },
  ) =>
    apiFetch<DomainRecord>('/terraform/v1/resources/dws_domain', {
      method: 'POST',
      address: addr,
      body: JSON.stringify(d),
    }),
  delete: (addr: string, id: string) =>
    apiFetch(`/terraform/v1/resources/dws_domain/${id}`, {
      method: 'DELETE',
      address: addr,
    }),
}

export const healthApi = {
  getHealth: () =>
    apiFetch<{
      status: string
      uptime: number
      services: Record<string, { status: string }>
    }>('/health'),
  getCdnStats: () =>
    apiFetch<{
      requests: number
      bandwidth: number
      cacheHitRate: number
      edgeNodes: number
    }>('/cdn/stats'),
}
