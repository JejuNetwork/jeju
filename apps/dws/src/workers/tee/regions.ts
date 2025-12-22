/**
 * Region Configuration
 *
 * Flexible region system supporting multiple cloud providers.
 * Regions are strings in format "provider:region-code" or just "region-code".
 */

import type {
  CloudProvider,
  GeoZone,
  NetworkEnvironment,
  Region,
  RegionConfig,
  RegionId,
  TEEPlatform,
} from './types'

// ============================================================================
// Region Definitions
// ============================================================================

/**
 * All known regions across cloud providers.
 * This is extensible - nodes can register with custom regions.
 */
export const KNOWN_REGIONS: Region[] = [
  // AWS Regions
  {
    id: 'aws:us-east-1',
    provider: 'aws',
    name: 'US East (N. Virginia)',
    geoZone: 'north-america',
    coordinates: { lat: 38.9, lon: -77.0 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'intel-tdx', 'amd-sev'],
  },
  {
    id: 'aws:us-east-2',
    provider: 'aws',
    name: 'US East (Ohio)',
    geoZone: 'north-america',
    coordinates: { lat: 40.0, lon: -83.0 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev'],
  },
  {
    id: 'aws:us-west-1',
    provider: 'aws',
    name: 'US West (N. California)',
    geoZone: 'north-america',
    coordinates: { lat: 37.3, lon: -121.9 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'aws:us-west-2',
    provider: 'aws',
    name: 'US West (Oregon)',
    geoZone: 'north-america',
    coordinates: { lat: 46.2, lon: -123.0 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'intel-tdx', 'amd-sev', 'nvidia-cc'],
  },
  {
    id: 'aws:eu-west-1',
    provider: 'aws',
    name: 'EU (Ireland)',
    geoZone: 'europe',
    coordinates: { lat: 53.3, lon: -6.3 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'intel-tdx'],
  },
  {
    id: 'aws:eu-west-2',
    provider: 'aws',
    name: 'EU (London)',
    geoZone: 'europe',
    coordinates: { lat: 51.5, lon: -0.1 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'aws:eu-central-1',
    provider: 'aws',
    name: 'EU (Frankfurt)',
    geoZone: 'europe',
    coordinates: { lat: 50.1, lon: 8.7 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev'],
  },
  {
    id: 'aws:ap-northeast-1',
    provider: 'aws',
    name: 'Asia Pacific (Tokyo)',
    geoZone: 'asia-pacific',
    coordinates: { lat: 35.7, lon: 139.7 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'aws:ap-southeast-1',
    provider: 'aws',
    name: 'Asia Pacific (Singapore)',
    geoZone: 'asia-pacific',
    coordinates: { lat: 1.3, lon: 103.8 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'aws:ap-south-1',
    provider: 'aws',
    name: 'Asia Pacific (Mumbai)',
    geoZone: 'asia-pacific',
    coordinates: { lat: 19.1, lon: 72.9 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'aws:sa-east-1',
    provider: 'aws',
    name: 'South America (São Paulo)',
    geoZone: 'south-america',
    coordinates: { lat: -23.5, lon: -46.6 },
    teeCapable: false,
    teePlatforms: [],
  },

  // GCP Regions
  {
    id: 'gcp:us-central1',
    provider: 'gcp',
    name: 'Iowa',
    geoZone: 'north-america',
    coordinates: { lat: 41.3, lon: -93.1 },
    teeCapable: true,
    teePlatforms: ['amd-sev', 'intel-tdx'],
  },
  {
    id: 'gcp:us-east1',
    provider: 'gcp',
    name: 'South Carolina',
    geoZone: 'north-america',
    coordinates: { lat: 33.8, lon: -81.2 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },
  {
    id: 'gcp:us-west1',
    provider: 'gcp',
    name: 'Oregon',
    geoZone: 'north-america',
    coordinates: { lat: 45.6, lon: -122.6 },
    teeCapable: true,
    teePlatforms: ['amd-sev', 'nvidia-cc'],
  },
  {
    id: 'gcp:europe-west1',
    provider: 'gcp',
    name: 'Belgium',
    geoZone: 'europe',
    coordinates: { lat: 50.5, lon: 4.5 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },
  {
    id: 'gcp:europe-west4',
    provider: 'gcp',
    name: 'Netherlands',
    geoZone: 'europe',
    coordinates: { lat: 52.2, lon: 4.5 },
    teeCapable: true,
    teePlatforms: ['amd-sev', 'intel-tdx'],
  },
  {
    id: 'gcp:asia-east1',
    provider: 'gcp',
    name: 'Taiwan',
    geoZone: 'asia-pacific',
    coordinates: { lat: 24.0, lon: 121.0 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },
  {
    id: 'gcp:asia-northeast1',
    provider: 'gcp',
    name: 'Tokyo',
    geoZone: 'asia-pacific',
    coordinates: { lat: 35.7, lon: 139.7 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },

  // Azure Regions
  {
    id: 'azure:eastus',
    provider: 'azure',
    name: 'East US',
    geoZone: 'north-america',
    coordinates: { lat: 37.4, lon: -79.4 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev'],
  },
  {
    id: 'azure:westus2',
    provider: 'azure',
    name: 'West US 2',
    geoZone: 'north-america',
    coordinates: { lat: 47.2, lon: -119.9 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev', 'nvidia-cc'],
  },
  {
    id: 'azure:westeurope',
    provider: 'azure',
    name: 'West Europe',
    geoZone: 'europe',
    coordinates: { lat: 52.4, lon: 4.9 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev'],
  },
  {
    id: 'azure:northeurope',
    provider: 'azure',
    name: 'North Europe',
    geoZone: 'europe',
    coordinates: { lat: 53.3, lon: -6.3 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'azure:japaneast',
    provider: 'azure',
    name: 'Japan East',
    geoZone: 'asia-pacific',
    coordinates: { lat: 35.7, lon: 139.7 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },

  // OVH Regions
  {
    id: 'ovh:gra',
    provider: 'ovh',
    name: 'Gravelines',
    geoZone: 'europe',
    coordinates: { lat: 51.0, lon: 2.1 },
    teeCapable: true,
    teePlatforms: ['intel-sgx', 'amd-sev'],
  },
  {
    id: 'ovh:sbg',
    provider: 'ovh',
    name: 'Strasbourg',
    geoZone: 'europe',
    coordinates: { lat: 48.6, lon: 7.8 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'ovh:bhs',
    provider: 'ovh',
    name: 'Beauharnois',
    geoZone: 'north-america',
    coordinates: { lat: 45.3, lon: -73.9 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },
  {
    id: 'ovh:sgp',
    provider: 'ovh',
    name: 'Singapore',
    geoZone: 'asia-pacific',
    coordinates: { lat: 1.3, lon: 103.8 },
    teeCapable: false,
    teePlatforms: [],
  },

  // DigitalOcean Regions
  {
    id: 'do:nyc1',
    provider: 'digitalocean',
    name: 'New York 1',
    geoZone: 'north-america',
    coordinates: { lat: 40.7, lon: -74.0 },
    teeCapable: false,
    teePlatforms: [],
  },
  {
    id: 'do:sfo3',
    provider: 'digitalocean',
    name: 'San Francisco 3',
    geoZone: 'north-america',
    coordinates: { lat: 37.8, lon: -122.4 },
    teeCapable: false,
    teePlatforms: [],
  },
  {
    id: 'do:ams3',
    provider: 'digitalocean',
    name: 'Amsterdam 3',
    geoZone: 'europe',
    coordinates: { lat: 52.4, lon: 4.9 },
    teeCapable: false,
    teePlatforms: [],
  },
  {
    id: 'do:sgp1',
    provider: 'digitalocean',
    name: 'Singapore 1',
    geoZone: 'asia-pacific',
    coordinates: { lat: 1.3, lon: 103.8 },
    teeCapable: false,
    teePlatforms: [],
  },

  // Hetzner Regions
  {
    id: 'hetzner:fsn1',
    provider: 'hetzner',
    name: 'Falkenstein',
    geoZone: 'europe',
    coordinates: { lat: 50.5, lon: 12.4 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },
  {
    id: 'hetzner:nbg1',
    provider: 'hetzner',
    name: 'Nuremberg',
    geoZone: 'europe',
    coordinates: { lat: 49.5, lon: 11.1 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },
  {
    id: 'hetzner:hel1',
    provider: 'hetzner',
    name: 'Helsinki',
    geoZone: 'europe',
    coordinates: { lat: 60.2, lon: 24.9 },
    teeCapable: false,
    teePlatforms: [],
  },
  {
    id: 'hetzner:ash',
    provider: 'hetzner',
    name: 'Ashburn',
    geoZone: 'north-america',
    coordinates: { lat: 39.0, lon: -77.5 },
    teeCapable: true,
    teePlatforms: ['amd-sev'],
  },

  // Akash (Decentralized)
  {
    id: 'akash:global',
    provider: 'akash',
    name: 'Akash Network',
    geoZone: 'global',
    coordinates: { lat: 0, lon: 0 },
    teeCapable: false,
    teePlatforms: [],
  },

  // Phala (TEE-native)
  {
    id: 'phala:global',
    provider: 'phala',
    name: 'Phala Network',
    geoZone: 'global',
    coordinates: { lat: 0, lon: 0 },
    teeCapable: true,
    teePlatforms: ['intel-sgx'],
  },

  // Local/Development
  {
    id: 'local',
    provider: 'custom',
    name: 'Local Development',
    geoZone: 'global',
    coordinates: { lat: 0, lon: 0 },
    teeCapable: true,
    teePlatforms: ['simulator'],
  },
]

// ============================================================================
// Environment Configurations
// ============================================================================

/**
 * Localnet: Single local node with simulated TEE
 */
export const LOCALNET_CONFIG: RegionConfig = {
  environment: 'localnet',
  regions: [KNOWN_REGIONS.find((r) => r.id === 'local')!],
  defaultRegion: 'local',
}

/**
 * Testnet: 2 regions for basic testing
 */
export const TESTNET_CONFIG: RegionConfig = {
  environment: 'testnet',
  regions: [
    KNOWN_REGIONS.find((r) => r.id === 'aws:us-east-1')!,
    KNOWN_REGIONS.find((r) => r.id === 'aws:eu-west-1')!,
  ],
  defaultRegion: 'aws:us-east-1',
}

/**
 * Mainnet: All regions available, nodes self-register
 */
export const MAINNET_CONFIG: RegionConfig = {
  environment: 'mainnet',
  regions: KNOWN_REGIONS.filter((r) => r.id !== 'local'),
  defaultRegion: 'aws:us-east-1',
}

// ============================================================================
// Region Utilities
// ============================================================================

const regionsByIdCache = new Map<string, Region>()

/**
 * Get region configuration for environment
 */
export function getRegionConfig(env: NetworkEnvironment): RegionConfig {
  switch (env) {
    case 'localnet':
      return LOCALNET_CONFIG
    case 'testnet':
      return TESTNET_CONFIG
    case 'mainnet':
      return MAINNET_CONFIG
  }
}

/**
 * Get region by ID
 */
export function getRegion(id: RegionId): Region | undefined {
  if (regionsByIdCache.size === 0) {
    for (const region of KNOWN_REGIONS) {
      regionsByIdCache.set(region.id, region)
    }
  }
  return regionsByIdCache.get(id)
}

/**
 * Get all regions for a provider
 */
export function getRegionsByProvider(provider: CloudProvider): Region[] {
  return KNOWN_REGIONS.filter((r) => r.provider === provider)
}

/**
 * Get all regions in a geo zone
 */
export function getRegionsByZone(zone: GeoZone): Region[] {
  return KNOWN_REGIONS.filter((r) => r.geoZone === zone)
}

/**
 * Get TEE-capable regions
 */
export function getTEERegions(platform?: TEEPlatform): Region[] {
  if (platform) {
    return KNOWN_REGIONS.filter(
      (r) => r.teeCapable && r.teePlatforms.includes(platform),
    )
  }
  return KNOWN_REGIONS.filter((r) => r.teeCapable)
}

/**
 * Parse region ID into provider and region code
 */
export function parseRegionId(id: RegionId): {
  provider: CloudProvider
  code: string
} {
  if (id === 'local') {
    return { provider: 'custom', code: 'local' }
  }

  const parts = id.split(':')
  if (parts.length === 2) {
    return { provider: parts[0] as CloudProvider, code: parts[1] }
  }

  // Assume custom provider for unknown formats
  return { provider: 'custom', code: id }
}

/**
 * Create a custom region (for self-hosted nodes)
 */
export function createCustomRegion(params: {
  id: string
  name: string
  geoZone: GeoZone
  coordinates: { lat: number; lon: number }
  teeCapable: boolean
  teePlatforms: TEEPlatform[]
}): Region {
  return {
    id: params.id.includes(':') ? params.id : `custom:${params.id}`,
    provider: 'custom',
    name: params.name,
    geoZone: params.geoZone,
    coordinates: params.coordinates,
    teeCapable: params.teeCapable,
    teePlatforms: params.teePlatforms,
  }
}

/**
 * Calculate haversine distance between two coordinates (km)
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371 // Earth's radius in km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

/**
 * Find nearest regions to coordinates
 */
export function findNearestRegions(
  lat: number,
  lon: number,
  options?: {
    limit?: number
    teeRequired?: boolean
    teePlatform?: TEEPlatform
    providers?: CloudProvider[]
    environment?: NetworkEnvironment
  },
): Region[] {
  let regions = options?.environment
    ? getRegionConfig(options.environment).regions
    : KNOWN_REGIONS

  // Filter by requirements
  if (options?.teeRequired) {
    regions = regions.filter((r) => r.teeCapable)
  }
  if (options?.teePlatform) {
    regions = regions.filter((r) =>
      r.teePlatforms.includes(options.teePlatform!),
    )
  }
  if (options?.providers?.length) {
    regions = regions.filter((r) => options.providers?.includes(r.provider))
  }

  // Sort by distance
  const withDistance = regions.map((region) => ({
    region,
    distance: haversineDistance(
      lat,
      lon,
      region.coordinates.lat,
      region.coordinates.lon,
    ),
  }))

  withDistance.sort((a, b) => a.distance - b.distance)

  const limit = options?.limit ?? 5
  return withDistance.slice(0, limit).map((d) => d.region)
}

/**
 * Estimate latency between two regions (ms)
 */
export function estimateLatency(from: RegionId, to: RegionId): number {
  const fromRegion = getRegion(from)
  const toRegion = getRegion(to)

  if (!fromRegion || !toRegion) return 100

  if (from === to) return 1

  const distance = haversineDistance(
    fromRegion.coordinates.lat,
    fromRegion.coordinates.lon,
    toRegion.coordinates.lat,
    toRegion.coordinates.lon,
  )

  // Rough estimate: ~0.01ms per km + 5ms base
  return Math.round(5 + distance * 0.01)
}
