/**
 * Internal JNS Service Discovery for DWS
 *
 * Provides DNS-like service discovery for internal DWS services.
 * All stateful services get registered with internal JNS names:
 *   - {podName}.{serviceName}.{namespace}.internal.jeju
 *   - {serviceName}.{namespace}.svc.jeju (cluster endpoint)
 *
 * Features:
 * - Internal DNS resolution for service mesh
 * - Leader-aware routing for consensus clusters
 * - Health-aware load balancing
 * - Automatic registration/deregistration
 */

import type { Address } from 'viem'
import type { StatefulService } from '../containers/stateful-provisioner'

// ============================================================================
// Types
// ============================================================================

export type ServiceType =
  | 'stateful'
  | 'worker'
  | 'postgres'
  | 'sqlit'
  | 'oauth3'
  | 'email'
  | 'da'
  | 'hubble'
  | 'oracle'
  | 'indexer'
  | 'rpc-gateway'

export interface ServiceRecord {
  id: string
  name: string
  namespace: string
  type: ServiceType
  owner: Address
  endpoints: ServiceEndpoint[]
  headlessFqdn: string
  clusterFqdn: string
  metadata: Record<string, string>
  createdAt: number
  updatedAt: number
  ttl: number
}

export interface ServiceEndpoint {
  ordinal: number
  podName: string
  ip: string
  port: number
  nodeId: string
  role: 'leader' | 'follower' | 'mpc-party' | 'worker' | 'candidate'
  healthy: boolean
  weight: number
}

export interface DNSRecord {
  fqdn: string
  recordType: 'A' | 'SRV' | 'TXT'
  value: string
  ttl: number
  priority?: number
  weight?: number
  port?: number
}

// ============================================================================
// Internal DNS Zone
// ============================================================================

const INTERNAL_ZONE = 'internal.jeju'
const SVC_ZONE = 'svc.jeju'

// ============================================================================
// Service Registry
// ============================================================================

const serviceRegistry = new Map<string, ServiceRecord>()
const dnsRecords = new Map<string, DNSRecord[]>()
const servicesByType = new Map<ServiceType, Set<string>>()

/**
 * Register a stateful service with internal DNS
 */
export function registerStatefulService(
  service: StatefulService,
): ServiceRecord {
  const serviceId = service.id
  const config = service.config

  // Build endpoints from replicas
  const endpoints: ServiceEndpoint[] = service.replicas.map((replica) => ({
    ordinal: replica.ordinal,
    podName: replica.podName,
    ip: extractIp(replica.endpoint),
    port: extractPort(replica.endpoint),
    nodeId: replica.nodeId,
    role: replica.role,
    healthy: replica.healthStatus === 'healthy',
    weight: replica.role === 'leader' ? 100 : 50,
  }))

  const record: ServiceRecord = {
    id: serviceId,
    name: config.name,
    namespace: config.namespace,
    type: 'stateful',
    owner: service.owner,
    endpoints,
    headlessFqdn: `${config.name}.${config.namespace}.${INTERNAL_ZONE}`,
    clusterFqdn: `${config.name}.${config.namespace}.${SVC_ZONE}`,
    metadata: config.labels,
    createdAt: service.createdAt,
    updatedAt: Date.now(),
    ttl: 30,
  }

  // Store service record
  serviceRegistry.set(serviceId, record)

  // Index by type
  const typeIndex = servicesByType.get('stateful') ?? new Set()
  typeIndex.add(serviceId)
  servicesByType.set('stateful', typeIndex)

  // Generate DNS records
  generateDNSRecords(record)

  console.log(
    `[ServiceDiscovery] Registered ${record.headlessFqdn} with ${endpoints.length} endpoints`,
  )

  return record
}

/**
 * Register a typed service (OAuth3, SQLit, etc.)
 */
export function registerTypedService(
  id: string,
  name: string,
  namespace: string,
  type: ServiceType,
  owner: Address,
  endpoints: ServiceEndpoint[],
  metadata: Record<string, string> = {},
): ServiceRecord {
  const record: ServiceRecord = {
    id,
    name,
    namespace,
    type,
    owner,
    endpoints,
    headlessFqdn: `${name}.${namespace}.${INTERNAL_ZONE}`,
    clusterFqdn: `${name}.${namespace}.${SVC_ZONE}`,
    metadata,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ttl: 30,
  }

  serviceRegistry.set(id, record)

  const typeIndex = servicesByType.get(type) ?? new Set()
  typeIndex.add(id)
  servicesByType.set(type, typeIndex)

  generateDNSRecords(record)

  console.log(
    `[ServiceDiscovery] Registered ${type} service ${record.headlessFqdn}`,
  )

  return record
}

/**
 * Update service endpoints (e.g., after scaling or health change)
 */
export function updateServiceEndpoints(
  serviceId: string,
  endpoints: ServiceEndpoint[],
): void {
  const record = serviceRegistry.get(serviceId)
  if (!record) {
    throw new Error(`Service not found: ${serviceId}`)
  }

  record.endpoints = endpoints
  record.updatedAt = Date.now()

  // Regenerate DNS records
  generateDNSRecords(record)
}

/**
 * Mark endpoint as unhealthy
 */
export function markEndpointUnhealthy(
  serviceId: string,
  ordinal: number,
): void {
  const record = serviceRegistry.get(serviceId)
  if (!record) return

  const endpoint = record.endpoints.find((e) => e.ordinal === ordinal)
  if (endpoint) {
    endpoint.healthy = false
    record.updatedAt = Date.now()
    generateDNSRecords(record)
  }
}

/**
 * Mark endpoint as healthy
 */
export function markEndpointHealthy(serviceId: string, ordinal: number): void {
  const record = serviceRegistry.get(serviceId)
  if (!record) return

  const endpoint = record.endpoints.find((e) => e.ordinal === ordinal)
  if (endpoint) {
    endpoint.healthy = true
    record.updatedAt = Date.now()
    generateDNSRecords(record)
  }
}

/**
 * Deregister a service
 */
export function deregisterService(serviceId: string): void {
  const record = serviceRegistry.get(serviceId)
  if (!record) return

  // Remove DNS records
  removeDNSRecords(record)

  // Remove from type index
  const typeIndex = servicesByType.get(record.type)
  if (typeIndex) {
    typeIndex.delete(serviceId)
  }

  serviceRegistry.delete(serviceId)

  console.log(`[ServiceDiscovery] Deregistered ${record.headlessFqdn}`)
}

// ============================================================================
// DNS Resolution
// ============================================================================

/**
 * Resolve FQDN to IP addresses
 */
export function resolveA(fqdn: string): string[] {
  const records = dnsRecords.get(fqdn)
  if (!records) return []

  return records.filter((r) => r.recordType === 'A').map((r) => r.value)
}

/**
 * Resolve FQDN to SRV records
 */
export function resolveSRV(fqdn: string): Array<{
  priority: number
  weight: number
  port: number
  target: string
}> {
  const records = dnsRecords.get(fqdn)
  if (!records) return []

  return records
    .filter((r) => r.recordType === 'SRV')
    .map((r) => ({
      priority: r.priority ?? 0,
      weight: r.weight ?? 100,
      port: r.port ?? 0,
      target: r.value,
    }))
}

/**
 * Resolve FQDN to TXT records
 */
export function resolveTXT(fqdn: string): string[] {
  const records = dnsRecords.get(fqdn)
  if (!records) return []

  return records.filter((r) => r.recordType === 'TXT').map((r) => r.value)
}

/**
 * Resolve pod-level FQDN (e.g., sqlit-0.sqlit.default.internal.jeju)
 */
export function resolvePod(fqdn: string): ServiceEndpoint | null {
  // Parse FQDN: {podName}.{serviceName}.{namespace}.{zone}
  const parts = fqdn.split('.')
  if (parts.length < 4) return null

  const podName = parts[0]
  const serviceName = parts[1]
  const namespace = parts[2]

  // Find service
  for (const record of serviceRegistry.values()) {
    if (record.name === serviceName && record.namespace === namespace) {
      const endpoint = record.endpoints.find((e) => e.podName === podName)
      if (endpoint) return endpoint
    }
  }

  return null
}

/**
 * Get leader endpoint for a service (consensus-aware routing)
 */
export function resolveLeader(
  serviceName: string,
  namespace: string,
): ServiceEndpoint | null {
  for (const record of serviceRegistry.values()) {
    if (record.name === serviceName && record.namespace === namespace) {
      return (
        record.endpoints.find((e) => e.role === 'leader' && e.healthy) ?? null
      )
    }
  }
  return null
}

/**
 * Get healthy endpoints with load balancing weights
 */
export function resolveWithLoadBalancing(
  serviceName: string,
  namespace: string,
): ServiceEndpoint[] {
  for (const record of serviceRegistry.values()) {
    if (record.name === serviceName && record.namespace === namespace) {
      return record.endpoints
        .filter((e) => e.healthy)
        .sort((a, b) => b.weight - a.weight)
    }
  }
  return []
}

// ============================================================================
// Service Lookup
// ============================================================================

/**
 * Get service by ID
 */
export function getService(serviceId: string): ServiceRecord | null {
  return serviceRegistry.get(serviceId) ?? null
}

/**
 * Get service by FQDN
 */
export function getServiceByFqdn(fqdn: string): ServiceRecord | null {
  for (const record of serviceRegistry.values()) {
    if (record.headlessFqdn === fqdn || record.clusterFqdn === fqdn) {
      return record
    }
  }
  return null
}

/**
 * Get all services of a type
 */
export function getServicesByType(type: ServiceType): ServiceRecord[] {
  const ids = servicesByType.get(type)
  if (!ids) return []

  return [...ids]
    .map((id) => serviceRegistry.get(id))
    .filter((r): r is ServiceRecord => !!r)
}

/**
 * List all registered services
 */
export function listServices(): ServiceRecord[] {
  return [...serviceRegistry.values()]
}

// ============================================================================
// Internal Methods
// ============================================================================

function generateDNSRecords(service: ServiceRecord): void {
  const records: DNSRecord[] = []

  // Cluster endpoint - A records for all healthy endpoints
  for (const endpoint of service.endpoints.filter((e) => e.healthy)) {
    records.push({
      fqdn: service.clusterFqdn,
      recordType: 'A',
      value: endpoint.ip,
      ttl: service.ttl,
    })
  }

  // SRV records for cluster endpoint
  for (const endpoint of service.endpoints.filter((e) => e.healthy)) {
    records.push({
      fqdn: `_${service.name}._tcp.${service.namespace}.${SVC_ZONE}`,
      recordType: 'SRV',
      value: `${endpoint.podName}.${service.headlessFqdn}`,
      priority: endpoint.role === 'leader' ? 0 : 10,
      weight: endpoint.weight,
      port: endpoint.port,
      ttl: service.ttl,
    })
  }

  // Per-pod A records (headless service pattern)
  for (const endpoint of service.endpoints) {
    const podFqdn = `${endpoint.podName}.${service.headlessFqdn}`
    records.push({
      fqdn: podFqdn,
      recordType: 'A',
      value: endpoint.ip,
      ttl: service.ttl,
    })

    // TXT record for metadata
    records.push({
      fqdn: podFqdn,
      recordType: 'TXT',
      value: `role=${endpoint.role};healthy=${endpoint.healthy};node=${endpoint.nodeId}`,
      ttl: service.ttl,
    })
  }

  // Leader record (if applicable)
  const leader = service.endpoints.find((e) => e.role === 'leader' && e.healthy)
  if (leader) {
    records.push({
      fqdn: `leader.${service.headlessFqdn}`,
      recordType: 'A',
      value: leader.ip,
      ttl: 10, // Shorter TTL for leader
    })
  }

  // Store records indexed by FQDN
  for (const record of records) {
    const existing = dnsRecords.get(record.fqdn) ?? []

    // Check if same record already exists
    const exists = existing.some(
      (r) => r.recordType === record.recordType && r.value === record.value,
    )

    if (!exists) {
      existing.push(record)
    }

    dnsRecords.set(record.fqdn, existing)
  }
}

function removeDNSRecords(service: ServiceRecord): void {
  // Remove cluster records
  dnsRecords.delete(service.clusterFqdn)
  dnsRecords.delete(`_${service.name}._tcp.${service.namespace}.${SVC_ZONE}`)
  dnsRecords.delete(`leader.${service.headlessFqdn}`)

  // Remove per-pod records
  for (const endpoint of service.endpoints) {
    dnsRecords.delete(`${endpoint.podName}.${service.headlessFqdn}`)
  }
}

function extractIp(endpoint: string): string {
  // endpoint format: http://ip:port or https://ip:port
  const match = endpoint.match(/https?:\/\/([^:]+)/)
  return match ? match[1] : '127.0.0.1'
}

function extractPort(endpoint: string): number {
  const match = endpoint.match(/:(\d+)$/)
  return match ? parseInt(match[1], 10) : 80
}

// ============================================================================
// DNS Server Handler (for internal resolution)
// ============================================================================

export interface DNSQuery {
  name: string
  type: 'A' | 'SRV' | 'TXT' | 'ANY'
}

export interface DNSResponse {
  name: string
  type: 'A' | 'SRV' | 'TXT'
  ttl: number
  data: string | SRVData
}

export interface SRVData {
  priority: number
  weight: number
  port: number
  target: string
}

/**
 * Handle DNS query (for internal DNS server integration)
 */
export function handleDNSQuery(query: DNSQuery): DNSResponse[] {
  const responses: DNSResponse[] = []

  if (query.type === 'A' || query.type === 'ANY') {
    const ips = resolveA(query.name)
    for (const ip of ips) {
      responses.push({
        name: query.name,
        type: 'A',
        ttl: 30,
        data: ip,
      })
    }
  }

  if (query.type === 'SRV' || query.type === 'ANY') {
    const srvs = resolveSRV(query.name)
    for (const srv of srvs) {
      responses.push({
        name: query.name,
        type: 'SRV',
        ttl: 30,
        data: srv,
      })
    }
  }

  if (query.type === 'TXT' || query.type === 'ANY') {
    const txts = resolveTXT(query.name)
    for (const txt of txts) {
      responses.push({
        name: query.name,
        type: 'TXT',
        ttl: 30,
        data: txt,
      })
    }
  }

  return responses
}

// ============================================================================
// Service Mesh Integration
// ============================================================================

/**
 * Get connection string for a database service
 */
export function getDatabaseConnectionString(
  serviceName: string,
  namespace: string,
  database: string,
  credentials?: { user: string; password: string },
): string {
  const service = getServiceByFqdn(`${serviceName}.${namespace}.${SVC_ZONE}`)
  if (!service) {
    throw new Error(`Service not found: ${serviceName}.${namespace}`)
  }

  const healthyEndpoint = service.endpoints.find((e) => e.healthy)
  if (!healthyEndpoint) {
    throw new Error(`No healthy endpoints for ${serviceName}.${namespace}`)
  }

  const auth = credentials ? `${credentials.user}:${credentials.password}@` : ''

  switch (service.type) {
    case 'postgres':
      return `postgresql://${auth}${healthyEndpoint.ip}:${healthyEndpoint.port}/${database}`
    case 'sqlit':
      return `sqlite://${healthyEndpoint.ip}:${healthyEndpoint.port}/${database}`
    default:
      return `${healthyEndpoint.ip}:${healthyEndpoint.port}`
  }
}

/**
 * Get internal service URL
 */
export function getServiceUrl(
  serviceName: string,
  namespace: string,
  scheme: 'http' | 'https' = 'http',
): string {
  const service = getServiceByFqdn(`${serviceName}.${namespace}.${SVC_ZONE}`)
  if (!service) {
    throw new Error(`Service not found: ${serviceName}.${namespace}`)
  }

  const healthyEndpoint = service.endpoints.find((e) => e.healthy)
  if (!healthyEndpoint) {
    throw new Error(`No healthy endpoints for ${serviceName}.${namespace}`)
  }

  return `${scheme}://${healthyEndpoint.ip}:${healthyEndpoint.port}`
}
