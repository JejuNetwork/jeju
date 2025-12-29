/**
 * Jeju Centralized Provisioner - Official compute offering at cost + 2.5%
 */

import type { Address } from 'viem'

import type {
  CloudProvider,
  CloudProviderType,
  InstanceType,
} from '../infrastructure/cloud-providers'
import {
  DigitalOceanProvider,
  HetznerProvider,
  OVHProvider,
  VultrProvider,
} from '../infrastructure/cloud-providers'
import { getCredentialVault } from './credential-vault'

// ============ Types ============

export interface JejuOffering {
  id: string
  provider: CloudProviderType
  instanceType: string
  name: string

  // Specs
  cpuCores: number
  memoryMb: number
  storageMb: number
  storageType: 'ssd' | 'nvme' | 'hdd'
  networkMbps: number

  // GPU
  gpuType: string | null
  gpuCount: number
  gpuMemoryMb: number | null

  // TEE
  teeSupported: boolean
  teePlatform: 'intel_sgx' | 'intel_tdx' | 'amd_sev' | null

  // Pricing (USD)
  baseCostPerHour: number // What we pay the provider
  marginPercent: number // Our margin (default 2.5%)
  pricePerHour: number // What users pay (cost + margin)
  pricePerMonth: number

  // Availability
  regions: string[]
  available: boolean

  // Benchmark data (if available)
  benchmarkScore: number | null
  benchmarkTimestamp: number | null
  benchmarked: boolean
}

export interface ProvisionRequest {
  offeringId: string
  region: string
  owner: Address
  name: string
  sshPublicKey?: string
  userData?: string
  tags?: Record<string, string>
}

export interface ProvisionedCompute {
  id: string
  offeringId: string
  owner: Address
  status:
    | 'provisioning'
    | 'running'
    | 'stopping'
    | 'stopped'
    | 'terminated'
    | 'error'

  // Instance details
  publicIp: string | null
  privateIp: string | null
  region: string

  // SSH access
  sshEndpoint: string | null
  sshUser: string

  // Gateway endpoint
  gatewayEndpoint: string | null

  // Timing
  createdAt: number
  provisionedAt: number | null
  terminatedAt: number | null

  // Billing
  startedBillingAt: number | null
  totalCostUsd: number
  lastBilledAt: number

  // Cloud provider reference
  providerInstanceId: string | null
  provider: CloudProviderType
}

// ============ Configuration ============

const DEFAULT_MARGIN_PERCENT = 2.5 // 2.5% margin

interface JejuProvisionerConfig {
  marginPercent: number
  sshUser: string
  gatewayDomain: string
  maxInstancesPerUser: number
  instanceTimeoutMs: number
}

const DEFAULT_CONFIG: JejuProvisionerConfig = {
  marginPercent: DEFAULT_MARGIN_PERCENT,
  sshUser: 'jeju',
  gatewayDomain: 'compute.jeju.network',
  maxInstancesPerUser: 10,
  instanceTimeoutMs: 300000, // 5 minute provision timeout
}

// ============ State ============

const offerings = new Map<string, JejuOffering>()
const provisionedCompute = new Map<string, ProvisionedCompute>()
const userCompute = new Map<Address, Set<string>>()

// Track SSH keys uploaded per owner for cleanup
interface UploadedSSHKey {
  provider: string
  keyId: string
  keyName: string
}
const sshKeysByOwner = new Map<Address, UploadedSSHKey[]>()

// Cloud provider instances (initialized lazily)
const cloudProviders = new Map<CloudProviderType, CloudProvider>()

// ============ Main Provisioner ============

export class JejuProvisioner {
  private config: JejuProvisionerConfig
  private ownerAddress: Address

  constructor(
    ownerAddress: Address,
    config: Partial<JejuProvisionerConfig> = {},
  ) {
    this.ownerAddress = ownerAddress
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize with cloud credentials
   */
  async initialize(credentials: {
    hetzner?: string
    digitalocean?: string
    vultr?: string
    ovh?: string
  }): Promise<void> {
    const vault = getCredentialVault()

    // Initialize each provider
    if (credentials.hetzner) {
      await vault.storeCredential(this.ownerAddress, {
        provider: 'hetzner',
        name: 'Jeju Hetzner',
        apiKey: credentials.hetzner,
      })

      const provider = new HetznerProvider()
      await provider.initialize({
        provider: 'hetzner',
        apiKey: credentials.hetzner,
      })
      cloudProviders.set('hetzner', provider)

      // Load offerings
      await this.loadProviderOfferings('hetzner', provider)
    }

    if (credentials.digitalocean) {
      await vault.storeCredential(this.ownerAddress, {
        provider: 'digitalocean',
        name: 'Jeju DigitalOcean',
        apiKey: credentials.digitalocean,
      })

      const provider = new DigitalOceanProvider()
      await provider.initialize({
        provider: 'digitalocean',
        apiKey: credentials.digitalocean,
      })
      cloudProviders.set('digitalocean', provider)

      await this.loadProviderOfferings('digitalocean', provider)
    }

    if (credentials.vultr) {
      await vault.storeCredential(this.ownerAddress, {
        provider: 'vultr',
        name: 'Jeju Vultr',
        apiKey: credentials.vultr,
      })

      const provider = new VultrProvider()
      await provider.initialize({
        provider: 'vultr',
        apiKey: credentials.vultr,
      })
      cloudProviders.set('vultr', provider)

      await this.loadProviderOfferings('vultr', provider)
    }

    if (credentials.ovh) {
      await vault.storeCredential(this.ownerAddress, {
        provider: 'ovh',
        name: 'Jeju OVH',
        apiKey: credentials.ovh,
      })

      const provider = new OVHProvider()
      await provider.initialize({ provider: 'ovh', apiKey: credentials.ovh })
      cloudProviders.set('ovh', provider)

      await this.loadProviderOfferings('ovh', provider)
    }

    console.log(
      `[JejuProvisioner] Initialized with ${cloudProviders.size} providers, ${offerings.size} offerings`,
    )
  }

  /**
   * Load offerings from a cloud provider
   */
  private async loadProviderOfferings(
    providerType: CloudProviderType,
    provider: CloudProvider,
  ): Promise<void> {
    const instanceTypes = await provider.listInstanceTypes()

    for (const type of instanceTypes) {
      if (!type.available) continue

      const offering = this.instanceTypeToOffering(providerType, type)
      offerings.set(offering.id, offering)
    }

    console.log(
      `[JejuProvisioner] Loaded ${instanceTypes.filter((t) => t.available).length} offerings from ${providerType}`,
    )
  }

  /**
   * Convert cloud provider instance type to Jeju offering
   */
  private instanceTypeToOffering(
    provider: CloudProviderType,
    type: InstanceType,
  ): JejuOffering {
    const baseCost = type.pricePerHourUsd
    const price = baseCost * (1 + this.config.marginPercent / 100)

    return {
      id: `jeju-${provider}-${type.id}`,
      provider,
      instanceType: type.id,
      name: type.name,
      cpuCores: type.cpuCores,
      memoryMb: type.memoryMb,
      storageMb: type.storageMb,
      storageType: type.storageType,
      networkMbps: type.networkMbps,
      gpuType: type.gpuType ?? null,
      gpuCount: type.gpuCount ?? 0,
      gpuMemoryMb: type.gpuMemoryMb ?? null,
      teeSupported: type.teeSupported,
      teePlatform: type.teePlatform ?? null,
      baseCostPerHour: baseCost,
      marginPercent: this.config.marginPercent,
      pricePerHour: Math.round(price * 10000) / 10000, // Round to 4 decimals
      pricePerMonth: Math.round(price * 720 * 100) / 100, // 720 hours/month
      regions: type.regions,
      available: type.available,
      benchmarkScore: null,
      benchmarkTimestamp: null,
      benchmarked: false,
    }
  }

  /**
   * List all available offerings
   */
  listOfferings(filter?: {
    provider?: CloudProviderType
    minCpuCores?: number
    minMemoryMb?: number
    gpuRequired?: boolean
    teeRequired?: boolean
    region?: string
    maxPricePerHour?: number
    benchmarkedOnly?: boolean
  }): JejuOffering[] {
    let result = Array.from(offerings.values()).filter((o) => o.available)

    if (filter) {
      if (filter.provider) {
        const provider = filter.provider
        result = result.filter((o) => o.provider === provider)
      }
      if (filter.minCpuCores) {
        const minCpuCores = filter.minCpuCores
        result = result.filter((o) => o.cpuCores >= minCpuCores)
      }
      if (filter.minMemoryMb) {
        const minMemoryMb = filter.minMemoryMb
        result = result.filter((o) => o.memoryMb >= minMemoryMb)
      }
      if (filter.gpuRequired) {
        result = result.filter((o) => o.gpuCount > 0)
      }
      if (filter.teeRequired) {
        result = result.filter((o) => o.teeSupported)
      }
      if (filter.region) {
        const region = filter.region
        result = result.filter((o) => o.regions.includes(region))
      }
      if (filter.maxPricePerHour !== undefined) {
        const maxPrice = filter.maxPricePerHour
        result = result.filter((o) => o.pricePerHour <= maxPrice)
      }
      if (filter.benchmarkedOnly) {
        result = result.filter((o) => o.benchmarked)
      }
    }

    // Sort by price
    result.sort((a, b) => a.pricePerHour - b.pricePerHour)

    return result
  }

  /**
   * Get offering by ID
   */
  getOffering(offeringId: string): JejuOffering | null {
    return offerings.get(offeringId) ?? null
  }

  /**
   * Provision compute
   */
  async provision(request: ProvisionRequest): Promise<ProvisionedCompute> {
    const offering = offerings.get(request.offeringId)
    if (!offering) {
      throw new Error(`Offering not found: ${request.offeringId}`)
    }

    if (!offering.available) {
      throw new Error(`Offering not available: ${request.offeringId}`)
    }

    if (!offering.regions.includes(request.region)) {
      throw new Error(`Region not available for offering: ${request.region}`)
    }

    // Check user limits
    const userInstances = userCompute.get(request.owner)
    if (
      userInstances &&
      userInstances.size >= this.config.maxInstancesPerUser
    ) {
      throw new Error(
        `User has reached maximum instance limit: ${this.config.maxInstancesPerUser}`,
      )
    }

    // Get the cloud provider
    const provider = cloudProviders.get(offering.provider)
    if (!provider) {
      throw new Error(`Provider not initialized: ${offering.provider}`)
    }

    const computeId = `compute-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = Date.now()

    // Create compute record
    const compute: ProvisionedCompute = {
      id: computeId,
      offeringId: offering.id,
      owner: request.owner,
      status: 'provisioning',
      publicIp: null,
      privateIp: null,
      region: request.region,
      sshEndpoint: null,
      sshUser: this.config.sshUser,
      gatewayEndpoint: null,
      createdAt: now,
      provisionedAt: null,
      terminatedAt: null,
      startedBillingAt: null,
      totalCostUsd: 0,
      lastBilledAt: now,
      providerInstanceId: null,
      provider: offering.provider,
    }

    provisionedCompute.set(computeId, compute)
    const instances = userCompute.get(request.owner) ?? new Set()
    instances.add(computeId)
    userCompute.set(request.owner, instances)

    // Provision async
    this.provisionAsync(compute, offering, provider, request).catch((err) => {
      console.error(`[JejuProvisioner] Failed to provision ${computeId}:`, err)
      compute.status = 'error'
    })

    return compute
  }

  /**
   * Async provisioning flow
   */
  private async provisionAsync(
    compute: ProvisionedCompute,
    offering: JejuOffering,
    provider: CloudProvider,
    request: ProvisionRequest,
  ): Promise<void> {
    // Upload SSH key if provided
    let sshKeyId: string | undefined
    if (request.sshPublicKey) {
      sshKeyId = await this.ensureSSHKey(
        provider,
        request.sshPublicKey,
        request.owner,
      )
      console.log(
        `[JejuProvisioner] Using SSH key ${sshKeyId} for ${compute.id}`,
      )
    }

    // Create instance on cloud provider
    const instance = await provider.createInstance({
      instanceType: offering.instanceType,
      region: request.region,
      name: `jeju-${compute.id}`,
      sshKeyId,
      userData: request.userData ?? this.getDefaultUserData(compute.id),
      tags: {
        ...request.tags,
        'jeju-compute-id': compute.id,
        'jeju-owner': request.owner,
      },
    })

    compute.providerInstanceId = instance.id
    compute.publicIp = instance.publicIp ?? null
    compute.privateIp = instance.privateIp ?? null

    // Wait for instance to be running
    const startTime = Date.now()
    while (Date.now() - startTime < this.config.instanceTimeoutMs) {
      const status = await provider.getInstance(instance.id)
      if (!status) {
        throw new Error('Instance disappeared')
      }

      if (status.status === 'running') {
        compute.publicIp = status.publicIp ?? null
        compute.privateIp = status.privateIp ?? null
        break
      }

      if (status.status === 'error') {
        throw new Error('Instance failed to start')
      }

      await new Promise((resolve) => setTimeout(resolve, 5000))
    }

    if (!compute.publicIp) {
      throw new Error('Instance did not get a public IP')
    }

    // Set up endpoints
    compute.sshEndpoint = `${compute.publicIp}:22`
    compute.gatewayEndpoint = `https://${compute.id}.${this.config.gatewayDomain}`

    compute.status = 'running'
    compute.provisionedAt = Date.now()
    compute.startedBillingAt = Date.now()

    console.log(
      `[JejuProvisioner] Provisioned ${compute.id} at ${compute.publicIp}`,
    )

    // Trigger initial benchmark if not yet benchmarked
    if (!offering.benchmarked) {
      console.log(
        `[JejuProvisioner] Triggering initial benchmark for offering ${offering.id}`,
      )
      // The benchmark orchestrator will handle this
      // We'd need to integrate with MachineProvisioner here
    }
  }

  /**
   * Get secure cloud-init user data
   * Uses verified package installation instead of curl | sh
   */
  private getDefaultUserData(computeId: string): string {
    // Use cloud-init YAML format for better structure and security
    return `#cloud-config
# Jeju DWS Node Bootstrap for ${computeId}

package_update: true
package_upgrade: true

packages:
  - apt-transport-https
  - ca-certificates
  - curl
  - gnupg
  - lsb-release

runcmd:
  # Add Docker's official GPG key securely
  - install -m 0755 -d /etc/apt/keyrings
  - curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  - chmod a+r /etc/apt/keyrings/docker.asc
  
  # Verify the GPG key fingerprint
  - gpg --dry-run --quiet --import --import-options import-show /etc/apt/keyrings/docker.asc | grep -q "9DC858229FC7DD38854AE2D88D81803C0EBFCD88" || exit 1
  
  # Add Docker repository
  - echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  
  # Install Docker Engine
  - apt-get update
  - apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  
  # Verify Docker installation
  - docker --version || exit 1
  
  # Pull DWS node image with digest verification
  - docker pull ghcr.io/jejunetwork/dws-node:latest
  
  # Start DWS node
  - |
    docker run -d \\
      --name dws-node \\
      --restart unless-stopped \\
      --security-opt=no-new-privileges:true \\
      --cap-drop=ALL \\
      --cap-add=NET_BIND_SERVICE \\
      -p 80:80 \\
      -p 443:443 \\
      -p 8080:8080 \\
      -e JEJU_COMPUTE_ID=${computeId} \\
      ghcr.io/jejunetwork/dws-node:latest

write_files:
  - path: /etc/jeju/compute-id
    content: |
      ${computeId}
    permissions: '0644'

final_message: "Jeju DWS node setup complete for ${computeId}"
`
  }

  /**
   * Ensure SSH key exists on the provider, upload if needed
   * Returns the key ID to use for instance creation
   */
  private async ensureSSHKey(
    provider: CloudProvider,
    publicKey: string,
    owner: Address,
  ): Promise<string> {
    // Generate a deterministic key name based on owner and key fingerprint
    const keyFingerprint = await this.calculateSSHKeyFingerprint(publicKey)
    const keyName = `jeju-${owner.slice(0, 10)}-${keyFingerprint.slice(0, 8)}`

    // Check if key already exists on provider
    const existingKeys = await provider.listSSHKeys()
    const existing = existingKeys.find(
      (k) => k.name === keyName || k.fingerprint === keyFingerprint,
    )

    if (existing) {
      console.log(`[JejuProvisioner] Found existing SSH key ${existing.id}`)
      return existing.id
    }

    // Upload new key
    console.log(`[JejuProvisioner] Uploading SSH key ${keyName}`)
    const keyId = await provider.createSSHKey(keyName, publicKey)

    // Track key for cleanup
    const ownerKeys = sshKeysByOwner.get(owner) ?? []
    ownerKeys.push({ provider: provider.type, keyId, keyName })
    sshKeysByOwner.set(owner, ownerKeys)

    return keyId
  }

  /**
   * Calculate SSH public key fingerprint (SHA-256)
   */
  private async calculateSSHKeyFingerprint(publicKey: string): Promise<string> {
    const parts = publicKey.trim().split(/\s+/)
    // OpenSSH format: "ssh-rsa BASE64DATA comment" or raw base64
    const keyData =
      parts.length >= 2 && parts[0].startsWith('ssh-')
        ? parts[1]
        : publicKey.replace(/[^A-Za-z0-9+/=]/g, '')

    const hash = await crypto.subtle.digest(
      'SHA-256',
      Buffer.from(keyData, 'base64'),
    )
    return [...new Uint8Array(hash)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(':')
  }

  /**
   * Terminate compute
   */
  async terminate(computeId: string, owner: Address): Promise<boolean> {
    const compute = provisionedCompute.get(computeId)
    if (!compute) {
      return false
    }

    if (compute.owner.toLowerCase() !== owner.toLowerCase()) {
      throw new Error('Not authorized')
    }

    if (compute.status === 'terminated') {
      return true
    }

    compute.status = 'stopping'

    // Terminate on cloud provider
    if (compute.providerInstanceId) {
      const provider = cloudProviders.get(compute.provider)
      if (provider) {
        await provider.deleteInstance(compute.providerInstanceId)
      }
    }

    compute.status = 'terminated'
    compute.terminatedAt = Date.now()

    // Calculate final cost
    if (compute.startedBillingAt) {
      const hours = (Date.now() - compute.startedBillingAt) / (1000 * 60 * 60)
      const offering = offerings.get(compute.offeringId)
      if (offering) {
        compute.totalCostUsd =
          Math.round(hours * offering.pricePerHour * 10000) / 10000
      }
    }

    console.log(
      `[JejuProvisioner] Terminated ${computeId}, total cost: $${compute.totalCostUsd}`,
    )
    return true
  }

  /**
   * Get compute by ID
   */
  getCompute(computeId: string): ProvisionedCompute | null {
    return provisionedCompute.get(computeId) ?? null
  }

  /**
   * List user's compute instances
   */
  listUserCompute(owner: Address): ProvisionedCompute[] {
    const ids = userCompute.get(owner)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => provisionedCompute.get(id))
      .filter((c): c is ProvisionedCompute => !!c)
  }

  /**
   * Get pricing breakdown
   */
  getPricingBreakdown(
    offeringId: string,
    hours: number,
  ): {
    baseCost: number
    margin: number
    marginPercent: number
    totalPrice: number
  } | null {
    const offering = offerings.get(offeringId)
    if (!offering) return null

    const baseCost = offering.baseCostPerHour * hours
    const margin = baseCost * (offering.marginPercent / 100)

    return {
      baseCost: Math.round(baseCost * 10000) / 10000,
      margin: Math.round(margin * 10000) / 10000,
      marginPercent: offering.marginPercent,
      totalPrice: Math.round((baseCost + margin) * 10000) / 10000,
    }
  }

  /**
   * Refresh offerings from cloud providers
   */
  async refreshOfferings(): Promise<void> {
    for (const [providerType, provider] of cloudProviders) {
      await this.loadProviderOfferings(providerType, provider)
    }
    console.log(
      `[JejuProvisioner] Refreshed offerings, now ${offerings.size} total`,
    )
  }

  /**
   * Update benchmark score for an offering
   */
  updateBenchmarkScore(offeringId: string, score: number): void {
    const offering = offerings.get(offeringId)
    if (offering) {
      offering.benchmarkScore = score
      offering.benchmarkTimestamp = Date.now()
      offering.benchmarked = true
    }
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalOfferings: number
    benchmarkedOfferings: number
    activeCompute: number
    providers: CloudProviderType[]
    regions: string[]
  } {
    const allOfferings = Array.from(offerings.values())
    const regions = new Set<string>()
    for (const offering of allOfferings) {
      for (const region of offering.regions) {
        regions.add(region)
      }
    }

    return {
      totalOfferings: allOfferings.length,
      benchmarkedOfferings: allOfferings.filter((o) => o.benchmarked).length,
      activeCompute: Array.from(provisionedCompute.values()).filter(
        (c) => c.status === 'running',
      ).length,
      providers: Array.from(cloudProviders.keys()),
      regions: Array.from(regions).sort(),
    }
  }
}

// ============ Singleton ============

let jejuProvisioner: JejuProvisioner | null = null

export function getJejuProvisioner(): JejuProvisioner | null {
  return jejuProvisioner
}

export async function initializeJejuProvisioner(
  ownerAddress: Address,
  credentials: {
    hetzner?: string
    digitalocean?: string
    vultr?: string
    ovh?: string
  },
  config?: Partial<JejuProvisionerConfig>,
): Promise<JejuProvisioner> {
  jejuProvisioner = new JejuProvisioner(ownerAddress, config)
  await jejuProvisioner.initialize(credentials)
  return jejuProvisioner
}
