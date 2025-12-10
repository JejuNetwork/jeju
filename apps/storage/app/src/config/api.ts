// Re-export from parent config
export { API_BASE_URL } from '../../config/api';

export interface StorageStats {
  totalPins: number
  totalSizeBytes: number
  totalSizeGB: number
  pricePerGBMonth: number
  minFee: number
}

export interface Pin {
  requestId: string
  cid: string
  name: string
  status: 'pinned' | 'queued' | 'unpinned' | 'failed'
  created: string
  info?: {
    sizeBytes?: number
  }
}

export interface UploadResult {
  requestId: string
  cid: string
  name: string
  size: number
  status: 'pinned'
  backend: string
  provider: string
  isIPFS: boolean
  isCloud: boolean
  url?: string
  gatewayUrl: string
}

export interface Backend {
  name: string
  enabled: boolean
  priority: number
}

export interface HealthResponse {
  status: string
  service: string
  version: string
  backends: {
    available: Backend[]
    health: Record<string, boolean>
  }
  ipfs: {
    connected: boolean
    peerId?: string
  }
  database: {
    pins: number
    totalSizeGB: number
  }
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`)
  return res.json()
}

export async function fetchStats(): Promise<StorageStats> {
  const res = await fetch(`${API_BASE_URL}/v1/stats`)
  return res.json()
}

export async function fetchPins(params?: { cid?: string; status?: string; limit?: number; offset?: number }): Promise<{ count: number; results: Pin[] }> {
  const query = new URLSearchParams()
  if (params?.cid) query.set('cid', params.cid)
  if (params?.status) query.set('status', params.status)
  if (params?.limit) query.set('limit', params.limit.toString())
  if (params?.offset) query.set('offset', params.offset.toString())
  
  const res = await fetch(`${API_BASE_URL}/pins?${query}`)
  return res.json()
}

export async function fetchPin(id: string): Promise<Pin> {
  const res = await fetch(`${API_BASE_URL}/pins/${id}`)
  return res.json()
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('file', file)
  
  const res = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    body: formData,
  })
  
  return res.json()
}

export async function deletePin(id: string): Promise<{ status: string }> {
  const res = await fetch(`${API_BASE_URL}/pins/${id}`, {
    method: 'DELETE',
  })
  return res.json()
}

export async function fetchBackends(): Promise<{ backends: Backend[]; health: Record<string, boolean> }> {
  const res = await fetch(`${API_BASE_URL}/backends`)
  return res.json()
}

export async function getQuote(sizeBytes: number, durationMonths = 1): Promise<{ sizeBytes: number; sizeGB: number; durationMonths: number; costUSD: number }> {
  const res = await fetch(`${API_BASE_URL}/v1/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sizeBytes, durationMonths }),
  })
  return res.json()
}

