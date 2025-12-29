/**
 * Cloud Provider Integrations
 *
 * SDK integrations for multiple cloud providers:
 * - Hetzner Cloud (cost-effective, EU-focused)
 * - OVH Cloud (cost-effective, global)
 * - DigitalOcean (developer-friendly)
 * - Vultr (competitive pricing)
 * - Linode (Akamai)
 *
 * Provides unified interface for:
 * - Machine provisioning
 * - Price discovery
 * - Capability detection
 * - Health monitoring
 */

// Cloud Provider Integrations

// Common Types

export type CloudProviderType =
  | 'hetzner'
  | 'ovh'
  | 'digitalocean'
  | 'vultr'
  | 'linode'
  | 'aws'
  | 'gcp'
  | 'azure'

export interface CloudCredentials {
  provider: CloudProviderType
  apiKey?: string
  apiSecret?: string
  projectId?: string
  region?: string
}

export interface InstanceType {
  id: string
  provider: CloudProviderType
  name: string
  cpuCores: number
  memoryMb: number
  storageMb: number
  storageType: 'ssd' | 'nvme' | 'hdd'
  networkMbps: number
  pricePerHourUsd: number
  pricePerMonthUsd: number
  gpuType?: string
  gpuCount?: number
  gpuMemoryMb?: number
  teeSupported: boolean
  teePlatform?: 'intel_sgx' | 'intel_tdx' | 'amd_sev'
  regions: string[]
  available: boolean
}

export interface ProvisionedInstance {
  id: string
  provider: CloudProviderType
  instanceType: string
  region: string
  publicIp?: string
  privateIp?: string
  status: 'pending' | 'running' | 'stopped' | 'terminated' | 'error'
  createdAt: number
  metadata: Record<string, string>
  sshKeyId?: string
}

export interface ProvisionRequest {
  instanceType: string
  region: string
  name: string
  sshKeyId?: string
  userData?: string
  tags?: Record<string, string>
  image?: string // OS image name (e.g., "Ubuntu 22.04")
}

// Provider Interface

export interface CloudProvider {
  readonly type: CloudProviderType
  readonly name: string

  // Authentication
  initialize(credentials: CloudCredentials): Promise<void>
  isInitialized(): boolean

  // Instance Types
  listInstanceTypes(region?: string): Promise<InstanceType[]>
  getInstanceType(id: string): Promise<InstanceType | null>

  // Regions
  listRegions(): Promise<
    Array<{ id: string; name: string; available: boolean }>
  >

  // Provisioning
  createInstance(request: ProvisionRequest): Promise<ProvisionedInstance>
  getInstance(id: string): Promise<ProvisionedInstance | null>
  listInstances(): Promise<ProvisionedInstance[]>
  deleteInstance(id: string): Promise<boolean>
  startInstance(id: string): Promise<boolean>
  stopInstance(id: string): Promise<boolean>

  // SSH Keys
  listSSHKeys(): Promise<
    Array<{ id: string; name: string; fingerprint: string }>
  >
  createSSHKey(name: string, publicKey: string): Promise<string>
  deleteSSHKey(id: string): Promise<boolean>

  // Pricing
  getCurrentPricing(): Promise<Map<string, number>>
  estimateMonthlyCost(instanceType: string, count: number): number
}

// Helper: Calculate SSH key fingerprint from public key
async function calculateSSHKeyFingerprint(publicKey: string): Promise<string> {
  // Extract the key data (ssh-rsa AAAAB3... user@host -> AAAAB3...)
  const parts = publicKey.trim().split(/\s+/)
  const keyData =
    parts.length >= 2 && parts[0].startsWith('ssh-') ? parts[1] : publicKey

  // Decode base64 key data and hash it
  const keyBytes = Buffer.from(keyData, 'base64')
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes)
  const hashArray = new Uint8Array(hashBuffer)
  const base64 = Buffer.from(hashArray).toString('base64').replace(/=+$/, '')
  return `SHA256:${base64}`
}

// Hetzner Cloud Provider

export class HetznerProvider implements CloudProvider {
  readonly type: CloudProviderType = 'hetzner'
  readonly name = 'Hetzner Cloud'

  private apiKey: string | null = null
  private baseUrl = 'https://api.hetzner.cloud/v1'
  private instanceTypesCache: InstanceType[] | null = null
  private cacheTime = 0

  async initialize(credentials: CloudCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new Error('Hetzner API key required')
    }
    this.apiKey = credentials.apiKey

    // Verify credentials
    const response = await this.fetch('/datacenters')
    if (!response.ok) {
      throw new Error(`Hetzner auth failed: ${response.status}`)
    }
  }

  isInitialized(): boolean {
    return this.apiKey !== null
  }

  async listInstanceTypes(region?: string): Promise<InstanceType[]> {
    // Use cache if fresh (5 minutes)
    if (this.instanceTypesCache && Date.now() - this.cacheTime < 300000) {
      return region
        ? this.instanceTypesCache.filter((t) => t.regions.includes(region))
        : this.instanceTypesCache
    }

    const response = await this.fetch('/server_types')
    if (!response.ok) {
      throw new Error(`Failed to list server types: ${response.status}`)
    }

    const data = (await response.json()) as {
      server_types: Array<{
        id: number
        name: string
        description: string
        cores: number
        memory: number
        disk: number
        storage_type: string
        prices: Array<{
          location: string
          price_hourly: { gross: string }
          price_monthly: { gross: string }
        }>
      }>
    }

    const types: InstanceType[] = data.server_types.map((st) => ({
      id: st.name,
      provider: 'hetzner' as const,
      name: st.description,
      cpuCores: st.cores,
      memoryMb: st.memory * 1024, // GB to MB
      storageMb: st.disk * 1024, // GB to MB
      storageType: st.storage_type === 'local' ? 'nvme' : 'ssd',
      networkMbps: 1000, // Default
      pricePerHourUsd: parseFloat(st.prices[0]?.price_hourly.gross ?? '0'),
      pricePerMonthUsd: parseFloat(st.prices[0]?.price_monthly.gross ?? '0'),
      teeSupported: false,
      regions: st.prices.map((p) => p.location),
      available: true,
    }))

    this.instanceTypesCache = types
    this.cacheTime = Date.now()

    return region ? types.filter((t) => t.regions.includes(region)) : types
  }

  async getInstanceType(id: string): Promise<InstanceType | null> {
    const types = await this.listInstanceTypes()
    return types.find((t) => t.id === id) ?? null
  }

  async listRegions(): Promise<
    Array<{ id: string; name: string; available: boolean }>
  > {
    const response = await this.fetch('/locations')
    if (!response.ok) {
      throw new Error(`Failed to list locations: ${response.status}`)
    }

    const data = (await response.json()) as {
      locations: Array<{
        id: number
        name: string
        description: string
        city: string
        country: string
      }>
    }

    return data.locations.map((loc) => ({
      id: loc.name,
      name: `${loc.city}, ${loc.country} (${loc.description})`,
      available: true,
    }))
  }

  async createInstance(
    request: ProvisionRequest,
  ): Promise<ProvisionedInstance> {
    const response = await this.fetch('/servers', {
      method: 'POST',
      body: JSON.stringify({
        name: request.name,
        server_type: request.instanceType,
        location: request.region,
        ssh_keys: request.sshKeyId ? [request.sshKeyId] : [],
        user_data: request.userData,
        labels: request.tags,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create server: ${error}`)
    }

    const data = (await response.json()) as {
      server: {
        id: number
        name: string
        status: string
        public_net: {
          ipv4: { ip: string }
          ipv6: { ip: string }
        }
        private_net: Array<{ ip: string }>
        created: string
        server_type: { name: string }
        datacenter: { location: { name: string } }
        labels: Record<string, string>
      }
    }

    return {
      id: data.server.id.toString(),
      provider: 'hetzner',
      instanceType: data.server.server_type.name,
      region: data.server.datacenter.location.name,
      publicIp: data.server.public_net.ipv4?.ip,
      privateIp: data.server.private_net[0]?.ip,
      status: this.mapStatus(data.server.status),
      createdAt: new Date(data.server.created).getTime(),
      metadata: data.server.labels,
    }
  }

  async getInstance(id: string): Promise<ProvisionedInstance | null> {
    const response = await this.fetch(`/servers/${id}`)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get server: ${response.status}`)
    }

    const data = (await response.json()) as {
      server: {
        id: number
        name: string
        status: string
        public_net: {
          ipv4: { ip: string }
          ipv6: { ip: string }
        }
        private_net: Array<{ ip: string }>
        created: string
        server_type: { name: string }
        datacenter: { location: { name: string } }
        labels: Record<string, string>
      }
    }

    return {
      id: data.server.id.toString(),
      provider: 'hetzner',
      instanceType: data.server.server_type.name,
      region: data.server.datacenter.location.name,
      publicIp: data.server.public_net.ipv4?.ip,
      privateIp: data.server.private_net[0]?.ip,
      status: this.mapStatus(data.server.status),
      createdAt: new Date(data.server.created).getTime(),
      metadata: data.server.labels,
    }
  }

  async listInstances(): Promise<ProvisionedInstance[]> {
    const response = await this.fetch('/servers')
    if (!response.ok) {
      throw new Error(`Failed to list servers: ${response.status}`)
    }

    const data = (await response.json()) as {
      servers: Array<{
        id: number
        name: string
        status: string
        public_net: {
          ipv4: { ip: string }
          ipv6: { ip: string }
        }
        private_net: Array<{ ip: string }>
        created: string
        server_type: { name: string }
        datacenter: { location: { name: string } }
        labels: Record<string, string>
      }>
    }

    return data.servers.map((server) => ({
      id: server.id.toString(),
      provider: 'hetzner' as const,
      instanceType: server.server_type.name,
      region: server.datacenter.location.name,
      publicIp: server.public_net.ipv4?.ip,
      privateIp: server.private_net[0]?.ip,
      status: this.mapStatus(server.status),
      createdAt: new Date(server.created).getTime(),
      metadata: server.labels,
    }))
  }

  async deleteInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/servers/${id}`, { method: 'DELETE' })
    return response.ok || response.status === 404
  }

  async startInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/servers/${id}/actions/poweron`, {
      method: 'POST',
    })
    return response.ok
  }

  async stopInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/servers/${id}/actions/poweroff`, {
      method: 'POST',
    })
    return response.ok
  }

  async listSSHKeys(): Promise<
    Array<{ id: string; name: string; fingerprint: string }>
  > {
    const response = await this.fetch('/ssh_keys')
    if (!response.ok) {
      throw new Error(`Failed to list SSH keys: ${response.status}`)
    }

    const data = (await response.json()) as {
      ssh_keys: Array<{
        id: number
        name: string
        fingerprint: string
      }>
    }

    return data.ssh_keys.map((key) => ({
      id: key.id.toString(),
      name: key.name,
      fingerprint: key.fingerprint,
    }))
  }

  async createSSHKey(name: string, publicKey: string): Promise<string> {
    const response = await this.fetch('/ssh_keys', {
      method: 'POST',
      body: JSON.stringify({ name, public_key: publicKey }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create SSH key: ${response.status}`)
    }

    const data = (await response.json()) as { ssh_key: { id: number } }
    return data.ssh_key.id.toString()
  }

  async deleteSSHKey(id: string): Promise<boolean> {
    const response = await this.fetch(`/ssh_keys/${id}`, { method: 'DELETE' })
    return response.ok || response.status === 404
  }

  async getCurrentPricing(): Promise<Map<string, number>> {
    const types = await this.listInstanceTypes()
    const pricing = new Map<string, number>()
    for (const type of types) {
      pricing.set(type.id, type.pricePerHourUsd)
    }
    return pricing
  }

  estimateMonthlyCost(instanceType: string, count: number): number {
    const type = this.instanceTypesCache?.find((t) => t.id === instanceType)
    return type ? type.pricePerMonthUsd * count : 0
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    if (!this.apiKey) {
      throw new Error('Hetzner provider not initialized')
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  }

  private mapStatus(status: string): ProvisionedInstance['status'] {
    switch (status) {
      case 'initializing':
      case 'starting':
        return 'pending'
      case 'running':
        return 'running'
      case 'stopping':
      case 'off':
        return 'stopped'
      case 'deleting':
        return 'terminated'
      default:
        return 'error'
    }
  }
}

// DigitalOcean Provider

export class DigitalOceanProvider implements CloudProvider {
  readonly type: CloudProviderType = 'digitalocean'
  readonly name = 'DigitalOcean'

  private apiKey: string | null = null
  private baseUrl = 'https://api.digitalocean.com/v2'
  private instanceTypesCache: InstanceType[] | null = null
  private cacheTime = 0

  async initialize(credentials: CloudCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new Error('DigitalOcean API key required')
    }
    this.apiKey = credentials.apiKey

    // Verify credentials
    const response = await this.fetch('/account')
    if (!response.ok) {
      throw new Error(`DigitalOcean auth failed: ${response.status}`)
    }
  }

  isInitialized(): boolean {
    return this.apiKey !== null
  }

  async listInstanceTypes(region?: string): Promise<InstanceType[]> {
    if (this.instanceTypesCache && Date.now() - this.cacheTime < 300000) {
      return region
        ? this.instanceTypesCache.filter((t) => t.regions.includes(region))
        : this.instanceTypesCache
    }

    const response = await this.fetch('/sizes')
    if (!response.ok) {
      throw new Error(`Failed to list sizes: ${response.status}`)
    }

    const data = (await response.json()) as {
      sizes: Array<{
        slug: string
        available: boolean
        transfer: number
        price_hourly: number
        price_monthly: number
        memory: number
        vcpus: number
        disk: number
        regions: string[]
        description: string
      }>
    }

    const types: InstanceType[] = data.sizes.map((size) => ({
      id: size.slug,
      provider: 'digitalocean' as const,
      name: size.description || size.slug,
      cpuCores: size.vcpus,
      memoryMb: size.memory,
      storageMb: size.disk * 1024, // GB to MB
      storageType: 'ssd',
      networkMbps: 1000,
      pricePerHourUsd: size.price_hourly,
      pricePerMonthUsd: size.price_monthly,
      teeSupported: false,
      regions: size.regions,
      available: size.available,
    }))

    this.instanceTypesCache = types
    this.cacheTime = Date.now()

    return region ? types.filter((t) => t.regions.includes(region)) : types
  }

  async getInstanceType(id: string): Promise<InstanceType | null> {
    const types = await this.listInstanceTypes()
    return types.find((t) => t.id === id) ?? null
  }

  async listRegions(): Promise<
    Array<{ id: string; name: string; available: boolean }>
  > {
    const response = await this.fetch('/regions')
    if (!response.ok) {
      throw new Error(`Failed to list regions: ${response.status}`)
    }

    const data = (await response.json()) as {
      regions: Array<{
        slug: string
        name: string
        available: boolean
      }>
    }

    return data.regions.map((region) => ({
      id: region.slug,
      name: region.name,
      available: region.available,
    }))
  }

  async createInstance(
    request: ProvisionRequest,
  ): Promise<ProvisionedInstance> {
    const response = await this.fetch('/droplets', {
      method: 'POST',
      body: JSON.stringify({
        name: request.name,
        region: request.region,
        size: request.instanceType,
        image: 'ubuntu-22-04-x64',
        ssh_keys: request.sshKeyId ? [request.sshKeyId] : [],
        user_data: request.userData,
        tags: request.tags ? Object.values(request.tags) : [],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create droplet: ${error}`)
    }

    const data = (await response.json()) as {
      droplet: {
        id: number
        name: string
        status: string
        size_slug: string
        region: { slug: string }
        networks: {
          v4: Array<{ ip_address: string; type: string }>
        }
        created_at: string
        tags: string[]
      }
    }

    const publicNetwork = data.droplet.networks.v4.find(
      (n) => n.type === 'public',
    )
    const privateNetwork = data.droplet.networks.v4.find(
      (n) => n.type === 'private',
    )

    return {
      id: data.droplet.id.toString(),
      provider: 'digitalocean',
      instanceType: data.droplet.size_slug,
      region: data.droplet.region.slug,
      publicIp: publicNetwork?.ip_address,
      privateIp: privateNetwork?.ip_address,
      status: this.mapStatus(data.droplet.status),
      createdAt: new Date(data.droplet.created_at).getTime(),
      metadata: Object.fromEntries(
        data.droplet.tags.map((t, i) => [i.toString(), t]),
      ),
    }
  }

  async getInstance(id: string): Promise<ProvisionedInstance | null> {
    const response = await this.fetch(`/droplets/${id}`)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get droplet: ${response.status}`)
    }

    const data = (await response.json()) as {
      droplet: {
        id: number
        name: string
        status: string
        size_slug: string
        region: { slug: string }
        networks: {
          v4: Array<{ ip_address: string; type: string }>
        }
        created_at: string
        tags: string[]
      }
    }

    const publicNetwork = data.droplet.networks.v4.find(
      (n) => n.type === 'public',
    )
    const privateNetwork = data.droplet.networks.v4.find(
      (n) => n.type === 'private',
    )

    return {
      id: data.droplet.id.toString(),
      provider: 'digitalocean',
      instanceType: data.droplet.size_slug,
      region: data.droplet.region.slug,
      publicIp: publicNetwork?.ip_address,
      privateIp: privateNetwork?.ip_address,
      status: this.mapStatus(data.droplet.status),
      createdAt: new Date(data.droplet.created_at).getTime(),
      metadata: Object.fromEntries(
        data.droplet.tags.map((t, i) => [i.toString(), t]),
      ),
    }
  }

  async listInstances(): Promise<ProvisionedInstance[]> {
    const response = await this.fetch('/droplets')
    if (!response.ok) {
      throw new Error(`Failed to list droplets: ${response.status}`)
    }

    const data = (await response.json()) as {
      droplets: Array<{
        id: number
        name: string
        status: string
        size_slug: string
        region: { slug: string }
        networks: {
          v4: Array<{ ip_address: string; type: string }>
        }
        created_at: string
        tags: string[]
      }>
    }

    return data.droplets.map((droplet) => {
      const publicNetwork = droplet.networks.v4.find((n) => n.type === 'public')
      const privateNetwork = droplet.networks.v4.find(
        (n) => n.type === 'private',
      )

      return {
        id: droplet.id.toString(),
        provider: 'digitalocean' as const,
        instanceType: droplet.size_slug,
        region: droplet.region.slug,
        publicIp: publicNetwork?.ip_address,
        privateIp: privateNetwork?.ip_address,
        status: this.mapStatus(droplet.status),
        createdAt: new Date(droplet.created_at).getTime(),
        metadata: Object.fromEntries(
          droplet.tags.map((t, i) => [i.toString(), t]),
        ),
      }
    })
  }

  async deleteInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/droplets/${id}`, { method: 'DELETE' })
    return response.ok || response.status === 404
  }

  async startInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/droplets/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'power_on' }),
    })
    return response.ok
  }

  async stopInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/droplets/${id}/actions`, {
      method: 'POST',
      body: JSON.stringify({ type: 'power_off' }),
    })
    return response.ok
  }

  async listSSHKeys(): Promise<
    Array<{ id: string; name: string; fingerprint: string }>
  > {
    const response = await this.fetch('/account/keys')
    if (!response.ok) {
      throw new Error(`Failed to list SSH keys: ${response.status}`)
    }

    const data = (await response.json()) as {
      ssh_keys: Array<{
        id: number
        name: string
        fingerprint: string
      }>
    }

    return data.ssh_keys.map((key) => ({
      id: key.id.toString(),
      name: key.name,
      fingerprint: key.fingerprint,
    }))
  }

  async createSSHKey(name: string, publicKey: string): Promise<string> {
    const response = await this.fetch('/account/keys', {
      method: 'POST',
      body: JSON.stringify({ name, public_key: publicKey }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create SSH key: ${response.status}`)
    }

    const data = (await response.json()) as { ssh_key: { id: number } }
    return data.ssh_key.id.toString()
  }

  async deleteSSHKey(id: string): Promise<boolean> {
    const response = await this.fetch(`/account/keys/${id}`, {
      method: 'DELETE',
    })
    return response.ok || response.status === 404
  }

  async getCurrentPricing(): Promise<Map<string, number>> {
    const types = await this.listInstanceTypes()
    const pricing = new Map<string, number>()
    for (const type of types) {
      pricing.set(type.id, type.pricePerHourUsd)
    }
    return pricing
  }

  estimateMonthlyCost(instanceType: string, count: number): number {
    const type = this.instanceTypesCache?.find((t) => t.id === instanceType)
    return type ? type.pricePerMonthUsd * count : 0
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    if (!this.apiKey) {
      throw new Error('DigitalOcean provider not initialized')
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  }

  private mapStatus(status: string): ProvisionedInstance['status'] {
    switch (status) {
      case 'new':
        return 'pending'
      case 'active':
        return 'running'
      case 'off':
        return 'stopped'
      case 'archive':
        return 'terminated'
      default:
        return 'error'
    }
  }
}

// Vultr Provider

export class VultrProvider implements CloudProvider {
  readonly type: CloudProviderType = 'vultr'
  readonly name = 'Vultr'

  private apiKey: string | null = null
  private baseUrl = 'https://api.vultr.com/v2'
  private instanceTypesCache: InstanceType[] | null = null
  private cacheTime = 0

  async initialize(credentials: CloudCredentials): Promise<void> {
    if (!credentials.apiKey) {
      throw new Error('Vultr API key required')
    }
    this.apiKey = credentials.apiKey

    const response = await this.fetch('/account')
    if (!response.ok) {
      throw new Error(`Vultr auth failed: ${response.status}`)
    }
  }

  isInitialized(): boolean {
    return this.apiKey !== null
  }

  async listInstanceTypes(region?: string): Promise<InstanceType[]> {
    if (this.instanceTypesCache && Date.now() - this.cacheTime < 300000) {
      return region
        ? this.instanceTypesCache.filter((t) => t.regions.includes(region))
        : this.instanceTypesCache
    }

    const response = await this.fetch('/plans')
    if (!response.ok) {
      throw new Error(`Failed to list plans: ${response.status}`)
    }

    const data = (await response.json()) as {
      plans: Array<{
        id: string
        vcpu_count: number
        ram: number
        disk: number
        disk_count: number
        bandwidth: number
        monthly_cost: number
        type: string
        locations: string[]
        gpu_vram_gb?: number
        gpu_type?: string
      }>
    }

    const types: InstanceType[] = data.plans.map((plan) => ({
      id: plan.id,
      provider: 'vultr' as const,
      name: plan.id,
      cpuCores: plan.vcpu_count,
      memoryMb: plan.ram,
      storageMb: plan.disk * 1024 * plan.disk_count,
      storageType: plan.type === 'vhp' ? 'nvme' : 'ssd',
      networkMbps: Math.round((plan.bandwidth / 30 / 24) * 8), // Convert to Mbps estimate
      pricePerHourUsd: plan.monthly_cost / 720,
      pricePerMonthUsd: plan.monthly_cost,
      gpuType: plan.gpu_type,
      gpuCount: plan.gpu_vram_gb ? 1 : 0,
      gpuMemoryMb: plan.gpu_vram_gb ? plan.gpu_vram_gb * 1024 : undefined,
      teeSupported: false,
      regions: plan.locations,
      available: true,
    }))

    this.instanceTypesCache = types
    this.cacheTime = Date.now()

    return region ? types.filter((t) => t.regions.includes(region)) : types
  }

  async getInstanceType(id: string): Promise<InstanceType | null> {
    const types = await this.listInstanceTypes()
    return types.find((t) => t.id === id) ?? null
  }

  async listRegions(): Promise<
    Array<{ id: string; name: string; available: boolean }>
  > {
    const response = await this.fetch('/regions')
    if (!response.ok) {
      throw new Error(`Failed to list regions: ${response.status}`)
    }

    const data = (await response.json()) as {
      regions: Array<{
        id: string
        city: string
        country: string
      }>
    }

    return data.regions.map((region) => ({
      id: region.id,
      name: `${region.city}, ${region.country}`,
      available: true,
    }))
  }

  async createInstance(
    request: ProvisionRequest,
  ): Promise<ProvisionedInstance> {
    const response = await this.fetch('/instances', {
      method: 'POST',
      body: JSON.stringify({
        region: request.region,
        plan: request.instanceType,
        label: request.name,
        os_id: 1743, // Ubuntu 22.04 LTS
        sshkey_id: request.sshKeyId ? [request.sshKeyId] : [],
        user_data: request.userData,
        tags: request.tags ? Object.values(request.tags) : [],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create instance: ${error}`)
    }

    const data = (await response.json()) as {
      instance: {
        id: string
        label: string
        status: string
        plan: string
        region: string
        main_ip: string
        internal_ip: string
        date_created: string
        tags: string[]
      }
    }

    return {
      id: data.instance.id,
      provider: 'vultr',
      instanceType: data.instance.plan,
      region: data.instance.region,
      publicIp: data.instance.main_ip,
      privateIp: data.instance.internal_ip,
      status: this.mapStatus(data.instance.status),
      createdAt: new Date(data.instance.date_created).getTime(),
      metadata: Object.fromEntries(
        data.instance.tags.map((t, i) => [i.toString(), t]),
      ),
    }
  }

  async getInstance(id: string): Promise<ProvisionedInstance | null> {
    const response = await this.fetch(`/instances/${id}`)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Failed to get instance: ${response.status}`)
    }

    const data = (await response.json()) as {
      instance: {
        id: string
        label: string
        status: string
        plan: string
        region: string
        main_ip: string
        internal_ip: string
        date_created: string
        tags: string[]
      }
    }

    return {
      id: data.instance.id,
      provider: 'vultr',
      instanceType: data.instance.plan,
      region: data.instance.region,
      publicIp: data.instance.main_ip,
      privateIp: data.instance.internal_ip,
      status: this.mapStatus(data.instance.status),
      createdAt: new Date(data.instance.date_created).getTime(),
      metadata: Object.fromEntries(
        data.instance.tags.map((t, i) => [i.toString(), t]),
      ),
    }
  }

  async listInstances(): Promise<ProvisionedInstance[]> {
    const response = await this.fetch('/instances')
    if (!response.ok) {
      throw new Error(`Failed to list instances: ${response.status}`)
    }

    const data = (await response.json()) as {
      instances: Array<{
        id: string
        label: string
        status: string
        plan: string
        region: string
        main_ip: string
        internal_ip: string
        date_created: string
        tags: string[]
      }>
    }

    return data.instances.map((instance) => ({
      id: instance.id,
      provider: 'vultr' as const,
      instanceType: instance.plan,
      region: instance.region,
      publicIp: instance.main_ip,
      privateIp: instance.internal_ip,
      status: this.mapStatus(instance.status),
      createdAt: new Date(instance.date_created).getTime(),
      metadata: Object.fromEntries(
        instance.tags.map((t, i) => [i.toString(), t]),
      ),
    }))
  }

  async deleteInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/instances/${id}`, { method: 'DELETE' })
    return response.ok || response.status === 404
  }

  async startInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/instances/${id}/start`, {
      method: 'POST',
    })
    return response.ok
  }

  async stopInstance(id: string): Promise<boolean> {
    const response = await this.fetch(`/instances/${id}/halt`, {
      method: 'POST',
    })
    return response.ok
  }

  async listSSHKeys(): Promise<
    Array<{ id: string; name: string; fingerprint: string }>
  > {
    const response = await this.fetch('/ssh-keys')
    if (!response.ok) {
      throw new Error(`Failed to list SSH keys: ${response.status}`)
    }

    const data = (await response.json()) as {
      ssh_keys: Array<{
        id: string
        name: string
        ssh_key: string
      }>
    }

    return Promise.all(
      data.ssh_keys.map(async (key) => ({
        id: key.id,
        name: key.name,
        fingerprint: await calculateSSHKeyFingerprint(key.ssh_key),
      })),
    )
  }

  async createSSHKey(name: string, publicKey: string): Promise<string> {
    const response = await this.fetch('/ssh-keys', {
      method: 'POST',
      body: JSON.stringify({ name, ssh_key: publicKey }),
    })

    if (!response.ok) {
      throw new Error(`Failed to create SSH key: ${response.status}`)
    }

    const data = (await response.json()) as { ssh_key: { id: string } }
    return data.ssh_key.id
  }

  async deleteSSHKey(id: string): Promise<boolean> {
    const response = await this.fetch(`/ssh-keys/${id}`, { method: 'DELETE' })
    return response.ok || response.status === 404
  }

  async getCurrentPricing(): Promise<Map<string, number>> {
    const types = await this.listInstanceTypes()
    const pricing = new Map<string, number>()
    for (const type of types) {
      pricing.set(type.id, type.pricePerHourUsd)
    }
    return pricing
  }

  estimateMonthlyCost(instanceType: string, count: number): number {
    const type = this.instanceTypesCache?.find((t) => t.id === instanceType)
    return type ? type.pricePerMonthUsd * count : 0
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    if (!this.apiKey) {
      throw new Error('Vultr provider not initialized')
    }

    return fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  }

  private mapStatus(status: string): ProvisionedInstance['status'] {
    switch (status) {
      case 'pending':
        return 'pending'
      case 'active':
        return 'running'
      case 'suspended':
      case 'stopped':
        return 'stopped'
      default:
        return 'error'
    }
  }
}

// OVH Cloud Provider

export class OVHProvider implements CloudProvider {
  readonly type: CloudProviderType = 'ovh'
  readonly name = 'OVH Cloud'

  private baseUrl = 'https://api.ovh.com/1.0'
  private applicationKey: string | null = null
  private applicationSecret: string | null = null
  private consumerKey: string | null = null
  private projectId: string | null = null
  private initialized = false
  private instanceTypesCache: InstanceType[] | null = null
  private imageCache: Map<string, string> = new Map() // region -> imageId mapping

  async initialize(credentials: CloudCredentials): Promise<void> {
    if (credentials.provider !== 'ovh') {
      throw new Error('Invalid credentials for OVH provider')
    }

    // OVH requires application key, secret, and consumer key
    // API key format: "appKey:appSecret:consumerKey"
    if (credentials.apiKey) {
      const parts = credentials.apiKey.split(':')
      if (parts.length === 3) {
        this.applicationKey = parts[0]
        this.applicationSecret = parts[1]
        this.consumerKey = parts[2]
      } else {
        this.applicationKey = credentials.apiKey
        this.applicationSecret = credentials.apiSecret ?? null
        this.consumerKey = credentials.projectId ?? null
      }
    }

    this.projectId = credentials.projectId ?? null

    if (!this.applicationKey) {
      throw new Error('OVH application key required')
    }

    // Verify credentials by listing projects
    const response = await this.fetch('/cloud/project')
    if (!response.ok) {
      throw new Error(`OVH authentication failed: ${response.status}`)
    }

    const projects = (await response.json()) as string[]
    if (projects.length > 0 && !this.projectId) {
      this.projectId = projects[0]
    }

    this.initialized = true
    console.log(`[OVH] Initialized for project ${this.projectId}`)
  }

  isInitialized(): boolean {
    return this.initialized
  }

  async listInstanceTypes(region?: string): Promise<InstanceType[]> {
    if (this.instanceTypesCache) {
      if (region) {
        return this.instanceTypesCache.filter((t) => t.regions.includes(region))
      }
      return this.instanceTypesCache
    }

    const response = await this.fetch(`/cloud/project/${this.projectId}/flavor`)
    if (!response.ok) {
      throw new Error(`Failed to list OVH flavors: ${response.status}`)
    }

    interface OVHFlavor {
      id: string
      name: string
      vcpus: number
      ram: number
      disk: number
      type: string
      region: string
      available: boolean
      planCodes: { hourly: string; monthly: string }
    }

    const flavors = (await response.json()) as OVHFlavor[]
    const regionMap = new Map<string, InstanceType>()

    for (const flavor of flavors) {
      const existing = regionMap.get(flavor.name)
      if (existing) {
        if (!existing.regions.includes(flavor.region)) {
          existing.regions.push(flavor.region)
        }
        continue
      }

      // Get pricing - try catalog first, fall back to estimation
      const pricePerHour = this.estimatePrice({
        vcpus: flavor.vcpus,
        ram: flavor.ram,
        disk: flavor.disk,
        planCodes: flavor.planCodes,
      })

      // Try to get actual price from catalog (async, but we'll update cache later)
      if (flavor.planCodes?.hourly) {
        this.getPriceFromCatalog(flavor.planCodes.hourly)
          .then((catalogPrice) => {
            if (catalogPrice && this.instanceTypesCache) {
              const cached = this.instanceTypesCache.find(
                (t) => t.id === flavor.name,
              )
              if (cached) {
                cached.pricePerHourUsd = catalogPrice
                cached.pricePerMonthUsd = catalogPrice * 720
              }
            }
          })
          .catch(() => {
            // Catalog lookup failed, stick with estimate
          })
      }

      const instanceType: InstanceType = {
        id: flavor.name,
        provider: 'ovh',
        name: flavor.name,
        cpuCores: flavor.vcpus,
        memoryMb: flavor.ram,
        storageMb: flavor.disk * 1024,
        storageType: flavor.type.includes('nvme') ? 'nvme' : 'ssd',
        networkMbps: 1000,
        pricePerHourUsd: pricePerHour,
        pricePerMonthUsd: pricePerHour * 720,
        teeSupported: false,
        regions: [flavor.region],
        available: flavor.available,
      }

      regionMap.set(flavor.name, instanceType)
    }

    this.instanceTypesCache = Array.from(regionMap.values())
    return region
      ? this.instanceTypesCache.filter((t) => t.regions.includes(region))
      : this.instanceTypesCache
  }

  async getInstanceType(id: string): Promise<InstanceType | null> {
    const types = await this.listInstanceTypes()
    return types.find((t) => t.id === id) ?? null
  }

  async listRegions(): Promise<
    Array<{ id: string; name: string; available: boolean }>
  > {
    const response = await this.fetch(`/cloud/project/${this.projectId}/region`)
    if (!response.ok) {
      return []
    }

    const regions = (await response.json()) as Array<{
      name: string
      status: string
      services: Array<{ name: string; status: string }>
    }>

    return regions.map((r) => ({
      id: r.name,
      name: r.name,
      available: r.status === 'UP',
    }))
  }

  /**
   * Resolve Ubuntu image ID for a region
   * OVH uses unique IDs per region, so we need to look them up
   */
  private async resolveImageId(
    region: string,
    osName = 'Ubuntu 22.04',
  ): Promise<string> {
    const cacheKey = `${region}:${osName}`
    if (this.imageCache.has(cacheKey)) {
      return this.imageCache.get(cacheKey) as string
    }

    const response = await this.fetch(
      `/cloud/project/${this.projectId}/image?region=${region}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to list OVH images: ${response.status}`)
    }

    interface OVHImage {
      id: string
      name: string
      region: string
      visibility: string
      status: string
      type: string
      minDisk: number
      minRam: number
      size: number
      user: string
    }

    const images = (await response.json()) as OVHImage[]

    // Find matching image - prefer exact match, then partial match
    let imageId: string | null = null

    // First try exact match
    const exactMatch = images.find(
      (img) =>
        img.name.toLowerCase() === osName.toLowerCase() &&
        img.status === 'active',
    )
    if (exactMatch) {
      imageId = exactMatch.id
    } else {
      // Try partial match (e.g., "Ubuntu 22.04" matches "Ubuntu 22.04 LTS")
      const partialMatch = images.find(
        (img) =>
          img.name.toLowerCase().includes(osName.toLowerCase()) &&
          img.status === 'active',
      )
      if (partialMatch) {
        imageId = partialMatch.id
      }
    }

    if (!imageId) {
      // Fallback to any Ubuntu image
      const ubuntuImage = images.find(
        (img) =>
          img.name.toLowerCase().includes('ubuntu') && img.status === 'active',
      )
      if (ubuntuImage) {
        imageId = ubuntuImage.id
        console.warn(
          `[OVHProvider] Using fallback image ${ubuntuImage.name} for region ${region}`,
        )
      }
    }

    if (!imageId) {
      throw new Error(
        `No suitable image found for ${osName} in region ${region}`,
      )
    }

    // Cache for future use
    this.imageCache.set(cacheKey, imageId)
    return imageId
  }

  async createInstance(
    request: ProvisionRequest,
  ): Promise<ProvisionedInstance> {
    // Resolve image ID from OS name
    const imageId = await this.resolveImageId(
      request.region,
      request.image ?? 'Ubuntu 22.04',
    )

    const body = {
      name: request.name,
      flavorId: request.instanceType,
      region: request.region,
      imageId,
      sshKeyId: request.sshKeyId,
      userData: request.userData
        ? Buffer.from(request.userData).toString('base64')
        : undefined,
    }

    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Failed to create OVH instance: ${error}`)
    }

    const instance = (await response.json()) as {
      id: string
      name: string
      status: string
      region: string
      ipAddresses: Array<{ ip: string; type: string }>
      created: string
    }

    return {
      id: instance.id,
      provider: 'ovh',
      instanceType: request.instanceType,
      region: instance.region,
      publicIp: instance.ipAddresses.find((ip) => ip.type === 'public')?.ip,
      privateIp: instance.ipAddresses.find((ip) => ip.type === 'private')?.ip,
      status: this.mapStatus(instance.status),
      createdAt: new Date(instance.created).getTime(),
      metadata: request.tags ?? {},
    }
  }

  async getInstance(id: string): Promise<ProvisionedInstance | null> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance/${id}`,
    )
    if (!response.ok) return null

    const instance = (await response.json()) as {
      id: string
      name: string
      status: string
      region: string
      flavorId: string
      ipAddresses: Array<{ ip: string; type: string }>
      created: string
    }

    return {
      id: instance.id,
      provider: 'ovh',
      instanceType: instance.flavorId,
      region: instance.region,
      publicIp: instance.ipAddresses.find((ip) => ip.type === 'public')?.ip,
      privateIp: instance.ipAddresses.find((ip) => ip.type === 'private')?.ip,
      status: this.mapStatus(instance.status),
      createdAt: new Date(instance.created).getTime(),
      metadata: {},
    }
  }

  async listInstances(): Promise<ProvisionedInstance[]> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance`,
    )
    if (!response.ok) return []

    const instances = (await response.json()) as Array<{
      id: string
      name: string
      status: string
      region: string
      flavorId: string
      ipAddresses: Array<{ ip: string; type: string }>
      created: string
    }>

    return instances.map((instance) => ({
      id: instance.id,
      provider: 'ovh' as CloudProviderType,
      instanceType: instance.flavorId,
      region: instance.region,
      publicIp: instance.ipAddresses.find((ip) => ip.type === 'public')?.ip,
      privateIp: instance.ipAddresses.find((ip) => ip.type === 'private')?.ip,
      status: this.mapStatus(instance.status),
      createdAt: new Date(instance.created).getTime(),
      metadata: {},
    }))
  }

  async deleteInstance(id: string): Promise<boolean> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance/${id}`,
      {
        method: 'DELETE',
      },
    )
    return response.ok
  }

  async startInstance(id: string): Promise<boolean> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance/${id}/start`,
      {
        method: 'POST',
      },
    )
    return response.ok
  }

  async stopInstance(id: string): Promise<boolean> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/instance/${id}/stop`,
      {
        method: 'POST',
      },
    )
    return response.ok
  }

  async listSSHKeys(): Promise<
    Array<{ id: string; name: string; fingerprint: string }>
  > {
    const response = await this.fetch(`/cloud/project/${this.projectId}/sshkey`)
    if (!response.ok) return []

    const keys = (await response.json()) as Array<{
      id: string
      name: string
      fingerprint: string
    }>

    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      fingerprint: k.fingerprint,
    }))
  }

  async createSSHKey(name: string, publicKey: string): Promise<string> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/sshkey`,
      {
        method: 'POST',
        body: JSON.stringify({ name, publicKey }),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to create SSH key: ${response.status}`)
    }

    const key = (await response.json()) as { id: string }
    return key.id
  }

  async deleteSSHKey(id: string): Promise<boolean> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/sshkey/${id}`,
      {
        method: 'DELETE',
      },
    )
    return response.ok
  }

  async getCurrentPricing(): Promise<Map<string, number>> {
    const types = await this.listInstanceTypes()
    const pricing = new Map<string, number>()
    for (const type of types) {
      pricing.set(type.id, type.pricePerHourUsd)
    }
    return pricing
  }

  estimateMonthlyCost(instanceType: string, count: number): number {
    const type = this.instanceTypesCache?.find((t) => t.id === instanceType)
    return type ? type.pricePerMonthUsd * count : 0
  }

  /**
   * Get price from OVH catalog or estimate if not available
   * Uses the planCodes from flavors to look up actual prices
   */
  private async getPriceFromCatalog(planCode: string): Promise<number | null> {
    const response = await this.fetch(
      `/cloud/project/${this.projectId}/catalog`,
    )
    if (!response.ok) {
      return null
    }

    interface OVHCatalogPrice {
      planCode: string
      prices: Array<{
        capacities: string[]
        price: { value: number; currencyCode: string }
        duration: string
      }>
    }

    interface OVHCatalog {
      addons: OVHCatalogPrice[]
    }

    const catalog = (await response.json()) as OVHCatalog

    // Find the plan in catalog
    const plan = catalog.addons.find((p) => p.planCode === planCode)
    if (!plan) return null

    // Find hourly price
    const hourlyPrice = plan.prices.find((p) => p.duration === 'P1H')
    if (!hourlyPrice) return null

    // Convert to USD (OVH catalog is in EUR)
    // Use a rough EUR to USD conversion rate
    const eurToUsd = 1.1
    return (hourlyPrice.price.value / 100000000) * eurToUsd // OVH prices are in micro-cents
  }

  private estimatePrice(flavor: {
    vcpus: number
    ram: number
    disk: number
    planCodes?: { hourly: string }
  }): number {
    // OVH pricing tiers based on flavor type (2024 prices)
    // These are closer to actual OVH public cloud pricing

    // Detect flavor tier from specs
    let cpuPriceMultiplier = 0.008 // base price per vCPU/hour
    let ramPriceMultiplier = 0.004 // base price per GB RAM/hour
    const diskPriceMultiplier = 0.0001 // base price per GB disk/hour

    // Adjust for high-performance flavors (detected by high RAM/CPU ratio)
    const ramPerCpu = flavor.ram / (flavor.vcpus * 1024) // GB per vCPU
    if (ramPerCpu > 8) {
      // Memory-optimized (like r2 series)
      cpuPriceMultiplier = 0.012
      ramPriceMultiplier = 0.008
    } else if (ramPerCpu < 2) {
      // Compute-optimized
      cpuPriceMultiplier = 0.015
      ramPriceMultiplier = 0.003
    }

    // GPU instances (detected by name convention or very high price expectation)
    // This is an estimate - real GPU pricing should come from catalog
    if (flavor.vcpus >= 16 && flavor.ram / 1024 >= 60) {
      // Likely GPU instance
      cpuPriceMultiplier = 0.05
      ramPriceMultiplier = 0.01
    }

    const cpuPrice = flavor.vcpus * cpuPriceMultiplier
    const ramPrice = (flavor.ram / 1024) * ramPriceMultiplier
    const diskPrice = flavor.disk * diskPriceMultiplier

    return Math.round((cpuPrice + ramPrice + diskPrice) * 10000) / 10000
  }

  private async fetch(path: string, options?: RequestInit): Promise<Response> {
    if (!this.applicationKey) {
      throw new Error('OVH provider not initialized')
    }

    const timestamp = Math.floor(Date.now() / 1000)
    const method = options?.method ?? 'GET'
    const body = options?.body ?? ''

    // OVH requires signed requests
    // Signature: SHA1($applicationSecret + "+" + $consumerKey + "+" + $method + "+" + $url + "+" + $body + "+" + $timestamp)
    const url = `${this.baseUrl}${path}`
    const toSign = `${this.applicationSecret}+${this.consumerKey}+${method}+${url}+${body}+${timestamp}`

    // Create SHA1 signature
    const encoder = new TextEncoder()
    const data = encoder.encode(toSign)
    const hashBuffer = await crypto.subtle.digest('SHA-1', data)
    const hashArray = new Uint8Array(hashBuffer)
    const signature = `$1$${Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`

    return fetch(url, {
      ...options,
      headers: {
        'X-Ovh-Application': this.applicationKey,
        'X-Ovh-Consumer': this.consumerKey ?? '',
        'X-Ovh-Timestamp': timestamp.toString(),
        'X-Ovh-Signature': signature,
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })
  }

  private mapStatus(status: string): ProvisionedInstance['status'] {
    switch (status.toLowerCase()) {
      case 'active':
        return 'running'
      case 'build':
      case 'rebuild':
        return 'pending'
      case 'shutoff':
      case 'suspended':
        return 'stopped'
      case 'deleted':
        return 'terminated'
      default:
        return 'error'
    }
  }
}

// Provider Factory

export function createCloudProvider(type: CloudProviderType): CloudProvider {
  switch (type) {
    case 'hetzner':
      return new HetznerProvider()
    case 'digitalocean':
      return new DigitalOceanProvider()
    case 'vultr':
      return new VultrProvider()
    case 'ovh':
      return new OVHProvider()
    default:
      throw new Error(`Unsupported cloud provider: ${type}`)
  }
}

// Multi-Cloud Manager

export class MultiCloudManager {
  private providers: Map<CloudProviderType, CloudProvider> = new Map()

  async addProvider(
    type: CloudProviderType,
    credentials: CloudCredentials,
  ): Promise<void> {
    const provider = createCloudProvider(type)
    await provider.initialize(credentials)
    this.providers.set(type, provider)
    console.log(`[MultiCloud] Added provider: ${type}`)
  }

  getProvider(type: CloudProviderType): CloudProvider | null {
    return this.providers.get(type) ?? null
  }

  getAllProviders(): CloudProvider[] {
    return Array.from(this.providers.values())
  }

  /**
   * Find the best provider for given requirements
   */
  async findBestProvider(requirements: {
    minCpuCores: number
    minMemoryMb: number
    minStorageMb?: number
    gpuRequired?: boolean
    teeRequired?: boolean
    region?: string
    maxPricePerHour?: number
  }): Promise<{
    provider: CloudProvider
    instanceType: InstanceType
  } | null> {
    const candidates: Array<{
      provider: CloudProvider
      instanceType: InstanceType
    }> = []

    for (const provider of this.providers.values()) {
      const types = await provider.listInstanceTypes(requirements.region)

      for (const type of types) {
        if (!type.available) continue
        if (type.cpuCores < requirements.minCpuCores) continue
        if (type.memoryMb < requirements.minMemoryMb) continue
        if (
          requirements.minStorageMb &&
          type.storageMb < requirements.minStorageMb
        )
          continue
        if (requirements.gpuRequired && !type.gpuType) continue
        if (requirements.teeRequired && !type.teeSupported) continue
        if (
          requirements.maxPricePerHour &&
          type.pricePerHourUsd > requirements.maxPricePerHour
        )
          continue

        candidates.push({ provider, instanceType: type })
      }
    }

    if (candidates.length === 0) return null

    // Sort by price, then by best fit
    candidates.sort((a, b) => {
      const priceDiff =
        a.instanceType.pricePerHourUsd - b.instanceType.pricePerHourUsd
      if (Math.abs(priceDiff) > 0.001) return priceDiff

      // Prefer closer match to requirements
      const overProvisionA =
        a.instanceType.cpuCores -
        requirements.minCpuCores +
        (a.instanceType.memoryMb - requirements.minMemoryMb) / 1024
      const overProvisionB =
        b.instanceType.cpuCores -
        requirements.minCpuCores +
        (b.instanceType.memoryMb - requirements.minMemoryMb) / 1024

      return overProvisionA - overProvisionB
    })

    return candidates[0]
  }

  /**
   * Get pricing comparison across all providers
   */
  async getPricingComparison(
    cpuCores: number,
    memoryMb: number,
  ): Promise<
    Array<{
      provider: CloudProviderType
      instanceType: string
      pricePerHour: number
      pricePerMonth: number
      specs: { cpu: number; memory: number }
    }>
  > {
    const results: Array<{
      provider: CloudProviderType
      instanceType: string
      pricePerHour: number
      pricePerMonth: number
      specs: { cpu: number; memory: number }
    }> = []

    for (const provider of this.providers.values()) {
      const types = await provider.listInstanceTypes()

      // Find the closest matching instance type
      const matching = types
        .filter((t) => t.cpuCores >= cpuCores && t.memoryMb >= memoryMb)
        .sort((a, b) => a.pricePerHourUsd - b.pricePerHourUsd)

      if (matching.length > 0) {
        const best = matching[0]
        results.push({
          provider: provider.type,
          instanceType: best.id,
          pricePerHour: best.pricePerHourUsd,
          pricePerMonth: best.pricePerMonthUsd,
          specs: { cpu: best.cpuCores, memory: best.memoryMb },
        })
      }
    }

    results.sort((a, b) => a.pricePerHour - b.pricePerHour)
    return results
  }
}

// Singleton

let multiCloudManager: MultiCloudManager | null = null

export function getMultiCloudManager(): MultiCloudManager {
  if (!multiCloudManager) {
    multiCloudManager = new MultiCloudManager()
  }
  return multiCloudManager
}
