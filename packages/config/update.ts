/**
 * @fileoverview Config Update Utilities
 * @module config/update
 *
 * Utilities for updating config files after deployments.
 * Used by deploy scripts to automatically save deployed addresses and URLs.
 *
 * @example
 * ```ts
 * import { updateContractAddress, updateServiceUrl } from '@jejunetwork/config/update';
 *
 * // After deploying a contract
 * await updateContractAddress('oif', 'solverRegistry', '0x...', 'testnet');
 *
 * // After deploying a service
 * await updateServiceUrl('indexer', 'graphql', 'https://...', 'testnet');
 * ```
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

/** Maximum config file size (10MB) - prevents DoS via large files */
const MAX_CONFIG_FILE_SIZE = 10 * 1024 * 1024

/**
 * Safely read a file with size limit protection
 */
function safeReadFile(path: string): string {
  const stats = statSync(path)
  if (stats.size > MAX_CONFIG_FILE_SIZE) {
    throw new Error(
      `Config file exceeds maximum size limit (${MAX_CONFIG_FILE_SIZE} bytes): ${path}`,
    )
  }
  return readFileSync(path, 'utf-8')
}

import {
  ChainConfigSchema,
  type ContractCategoryExtended,
  type ContractsConfig,
  ContractsConfigSchema,
  type EILConfig,
  EILConfigSchema,
  type ExternalChainContractsDynamic,
  type NetworkContractsDynamic,
  type NetworkType,
  type ServicesConfig,
  ServicesConfigSchema,
  type ServicesNetworkConfigDynamic,
} from './schemas'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const CONFIG_DIR = __dirname
const ARTIFACTS_DIR = join(__dirname, '../deployment/.artifacts')

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid address format')

const DeploymentArtifactSchema = z.object({
  network: z.enum(['localnet', 'testnet', 'mainnet']),
  timestamp: z.string(),
  deployer: AddressSchema,
  contracts: z.record(
    z.string(),
    z.object({
      address: AddressSchema,
      txHash: z.string().optional(),
      blockNumber: z.number().optional(),
    }),
  ),
  services: z.record(z.string(), z.string()).optional(),
})

const TerraformOutputsSchema = z.record(
  z.string(),
  z.object({
    value: z.union([z.string(), z.record(z.string(), z.string())]),
    type: z.string().optional(),
  }),
)

// ============================================================================
// Types
// ============================================================================

/** Contract category keys - uses unified type from schemas.ts */
export type ContractCategoryKey = ContractCategoryExtended

export type DeploymentArtifact = z.infer<typeof DeploymentArtifactSchema>
export type TerraformOutputs = z.infer<typeof TerraformOutputsSchema>

// ============================================================================
// Contract Updates
// ============================================================================

// Helper to load and parse contracts.json with type safety
function loadContractsFile(): ContractsConfig & { lastUpdated?: string } {
  const contractsPath = join(CONFIG_DIR, 'contracts.json')
  const raw = JSON.parse(safeReadFile(contractsPath)) as ContractsConfig & {
    lastUpdated?: string
  }
  // Validate structure matches expected schema
  ContractsConfigSchema.parse(raw)
  return raw
}

// Helper to save contracts.json with proper formatting
function saveContractsFile(
  contracts: ContractsConfig & { lastUpdated?: string },
): void {
  const contractsPath = join(CONFIG_DIR, 'contracts.json')
  contracts.lastUpdated = new Date().toISOString().split('T')[0]
  writeFileSync(contractsPath, `${JSON.stringify(contracts, null, 2)}\n`)
}

/**
 * Update a contract address in contracts.json
 */
export function updateContractAddress(
  category: ContractCategoryKey,
  name: string,
  address: string,
  network: NetworkType,
): void {
  // Validate address format
  AddressSchema.parse(address)

  const contracts = loadContractsFile()

  // Use dynamic type for mutable access
  const netContracts = contracts[network] as NetworkContractsDynamic
  if (!netContracts) {
    throw new Error(`Unknown network: ${network}`)
  }

  // Initialize category if it doesn't exist
  if (!netContracts[category]) {
    netContracts[category] = {}
  }

  // Set the address - category is guaranteed to exist now
  const categoryContracts = netContracts[category] as Record<string, string>
  categoryContracts[name] = address

  saveContractsFile(contracts)
  console.log(
    `✅ Updated contracts.json: ${network}.${category}.${name} = ${address}`,
  )
}

/**
 * Update multiple contract addresses at once
 */
export function updateContracts(
  updates: Array<{
    category: ContractCategoryKey
    name: string
    address: string
  }>,
  network: NetworkType,
): void {
  // Validate all addresses upfront
  for (const { address } of updates) {
    AddressSchema.parse(address)
  }

  const contracts = loadContractsFile()
  // Use dynamic type for mutable access
  const netContracts = contracts[network] as NetworkContractsDynamic

  for (const { category, name, address } of updates) {
    // Initialize category if it doesn't exist
    if (!netContracts[category]) {
      netContracts[category] = {}
    }
    const categoryContracts = netContracts[category] as Record<string, string>
    categoryContracts[name] = address
  }

  saveContractsFile(contracts)
  console.log(
    `✅ Updated ${updates.length} contract addresses in contracts.json`,
  )
}

/**
 * Update an external chain contract address
 */
export function updateExternalContract(
  chain: string,
  category: 'oif' | 'eil' | 'payments' | 'tokens' | 'poc',
  name: string,
  address: string,
): void {
  // Validate address format
  AddressSchema.parse(address)

  const contracts = loadContractsFile()

  // Use dynamic type for mutable access
  const chainContracts = contracts.external[chain] as
    | ExternalChainContractsDynamic
    | undefined
  if (!chainContracts) {
    throw new Error(`Unknown external chain: ${chain}`)
  }

  // Initialize category if it doesn't exist
  if (!chainContracts[category]) {
    chainContracts[category] = {}
  }
  const categoryContracts = chainContracts[category] as Record<string, string>
  categoryContracts[name] = address

  saveContractsFile(contracts)
  console.log(
    `✅ Updated contracts.json: external.${chain}.${category}.${name} = ${address}`,
  )
}

// ============================================================================
// Service URL Updates
// ============================================================================

type ServiceCategory =
  | 'rpc'
  | 'indexer'
  | 'gateway'
  | 'storage'
  | 'compute'
  | 'oif'
  | 'leaderboard'
  | 'monitoring'
  | 'crucible'
  | 'cql'
  | 'dws'
  | 'autocrat'
  | 'kms'
  | 'factory'

const UrlSchema = z.string().url('Invalid URL format')

// Helper to load and parse services.json with type safety
function loadServicesFile(): ServicesConfig {
  const servicesPath = join(CONFIG_DIR, 'services.json')
  const raw = JSON.parse(safeReadFile(servicesPath)) as ServicesConfig
  ServicesConfigSchema.parse(raw)
  return raw
}

// Helper to save services.json with proper formatting
function saveServicesFile(services: ServicesConfig): void {
  const servicesPath = join(CONFIG_DIR, 'services.json')
  writeFileSync(servicesPath, `${JSON.stringify(services, null, 2)}\n`)
}

/**
 * Update a service URL in services.json
 */
export function updateServiceUrl(
  category: ServiceCategory,
  subKey: string,
  url: string,
  network: NetworkType,
): void {
  // Validate URL format
  UrlSchema.parse(url)

  const services = loadServicesFile()

  // Use dynamic type for mutable access
  const netServices = services[network] as ServicesNetworkConfigDynamic
  if (!netServices) {
    throw new Error(`Unknown network: ${network}`)
  }

  const categoryConfig = netServices[category]
  if (typeof categoryConfig === 'string') {
    // Replace string value with new URL
    netServices[category] = url
  } else if (
    typeof categoryConfig === 'object' &&
    categoryConfig !== undefined
  ) {
    // Update existing object
    ;(categoryConfig as Record<string, string>)[subKey] = url
  } else {
    // Create new category object
    netServices[category] = { [subKey]: url }
  }

  saveServicesFile(services)
  console.log(
    `✅ Updated services.json: ${network}.${category}.${subKey} = ${url}`,
  )
}

/**
 * Update external RPC URL
 */
export function updateExternalRpc(
  chainName: string,
  url: string,
  network: NetworkType,
): void {
  // Validate URL format
  UrlSchema.parse(url)

  const services = loadServicesFile()

  const netServices = services[network]
  if (!netServices.externalRpcs) {
    netServices.externalRpcs = {}
  }

  netServices.externalRpcs[chainName] = url
  saveServicesFile(services)
  console.log(
    `✅ Updated services.json: ${network}.externalRpcs.${chainName} = ${url}`,
  )
}

// ============================================================================
// EIL Config Updates
// ============================================================================

// Helper to load and parse eil.json with type safety
function loadEILFile(): EILConfig & { lastUpdated?: string } {
  const eilPath = join(CONFIG_DIR, 'eil.json')
  const raw = JSON.parse(safeReadFile(eilPath)) as EILConfig & {
    lastUpdated?: string
  }
  EILConfigSchema.parse(raw)
  return raw
}

// Helper to save eil.json with proper formatting
function saveEILFile(eil: EILConfig & { lastUpdated?: string }): void {
  const eilPath = join(CONFIG_DIR, 'eil.json')
  eil.lastUpdated = new Date().toISOString().split('T')[0]
  writeFileSync(eilPath, `${JSON.stringify(eil, null, 2)}\n`)
}

/**
 * Update EIL chain config
 */
export function updateEILChain(
  chainName: string,
  updates: {
    crossChainPaymaster?: string
    l1StakeManager?: string
    status?: 'active' | 'planned'
    tokens?: Record<string, string>
  },
  network: NetworkType,
): void {
  // Validate addresses if provided
  if (updates.crossChainPaymaster)
    AddressSchema.parse(updates.crossChainPaymaster)
  if (updates.l1StakeManager) AddressSchema.parse(updates.l1StakeManager)
  if (updates.tokens) {
    for (const addr of Object.values(updates.tokens)) {
      AddressSchema.parse(addr)
    }
  }

  const eil = loadEILFile()

  const netConfig = eil[network]
  if (!netConfig?.chains?.[chainName]) {
    throw new Error(`Unknown EIL chain: ${chainName} on ${network}`)
  }

  const chain = netConfig.chains[chainName]

  if (updates.crossChainPaymaster)
    chain.crossChainPaymaster = updates.crossChainPaymaster
  if (updates.l1StakeManager) chain.l1StakeManager = updates.l1StakeManager
  if (updates.status) chain.status = updates.status
  if (updates.tokens) chain.tokens = { ...chain.tokens, ...updates.tokens }

  saveEILFile(eil)
  console.log(`✅ Updated eil.json: ${network}.chains.${chainName}`)
}

// ============================================================================
// Deployment Artifacts
// ============================================================================

/**
 * Save deployment artifact for tracking
 */
export function saveDeploymentArtifact(artifact: DeploymentArtifact): void {
  const networkDir = join(ARTIFACTS_DIR, artifact.network)

  if (!existsSync(networkDir)) {
    mkdirSync(networkDir, { recursive: true })
  }

  // Save timestamped artifact
  const timestamp = artifact.timestamp.replace(/[:.]/g, '-')
  const artifactPath = join(networkDir, `deploy-${timestamp}.json`)
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2))

  // Also save as latest
  const latestPath = join(networkDir, 'latest.json')
  writeFileSync(latestPath, JSON.stringify(artifact, null, 2))

  console.log(`✅ Saved deployment artifact: ${artifactPath}`)
}

/**
 * Load latest deployment artifact
 */
export function loadLatestArtifact(
  network: NetworkType,
): DeploymentArtifact | null {
  const latestPath = join(ARTIFACTS_DIR, network, 'latest.json')

  if (!existsSync(latestPath)) {
    return null
  }

  const raw = JSON.parse(safeReadFile(latestPath))
  return DeploymentArtifactSchema.parse(raw)
}

/**
 * Apply artifact to config files
 */
export function applyArtifactToConfig(artifact: DeploymentArtifact): void {
  const { network, contracts, services } = artifact

  // Update contracts
  for (const [key, data] of Object.entries(contracts)) {
    const [category, name] = key.split('.')
    if (category && name && data.address) {
      updateContractAddress(
        category as ContractCategoryKey,
        name,
        data.address,
        network,
      )
    }
  }

  // Update services
  if (services) {
    for (const [key, url] of Object.entries(services)) {
      const [category, subKey] = key.split('.')
      if (category && url) {
        updateServiceUrl(
          category as ServiceCategory,
          subKey ?? 'default',
          url,
          network,
        )
      }
    }
  }
}

// ============================================================================
// Terraform Integration
// ============================================================================

/**
 * Parse Terraform outputs and update config
 */
export function applyTerraformOutputs(
  outputs: TerraformOutputs,
  network: NetworkType,
): void {
  // Common Terraform output mappings
  const mappings: Record<
    string,
    { category: ServiceCategory; subKey: string }
  > = {
    rpc_endpoint: { category: 'rpc', subKey: 'l2' },
    ws_endpoint: { category: 'rpc', subKey: 'ws' },
    l1_rpc_endpoint: { category: 'rpc', subKey: 'l1' },
    indexer_url: { category: 'indexer', subKey: 'graphql' },
    gateway_url: { category: 'gateway', subKey: 'ui' },
    gateway_api_url: { category: 'gateway', subKey: 'api' },
    storage_url: { category: 'storage', subKey: 'api' },
    compute_url: { category: 'compute', subKey: 'marketplace' },
  }

  for (const [outputKey, config] of Object.entries(mappings)) {
    const output = outputs[outputKey]
    if (output && typeof output.value === 'string') {
      updateServiceUrl(config.category, config.subKey, output.value, network)
    }
  }
}

/**
 * Load Terraform outputs from file and apply
 */
export function applyTerraformOutputsFile(
  outputsPath: string,
  network: NetworkType,
): void {
  if (!existsSync(outputsPath)) {
    throw new Error(`Terraform outputs file not found: ${outputsPath}`)
  }

  const raw = JSON.parse(safeReadFile(outputsPath))
  const outputs = TerraformOutputsSchema.parse(raw)
  applyTerraformOutputs(outputs, network)
}

// ============================================================================
// Chain Config Updates
// ============================================================================

/**
 * Update chain-specific config (L1/L2 contracts, etc.)
 */
export function updateChainConfig(
  network: NetworkType,
  updates: {
    l1?: Record<string, string>
    l2?: Record<string, string>
  },
): void {
  // Validate addresses
  const validateAddresses = (addresses: Record<string, string>): void => {
    for (const addr of Object.values(addresses)) {
      AddressSchema.parse(addr)
    }
  }

  if (updates.l1) validateAddresses(updates.l1)
  if (updates.l2) validateAddresses(updates.l2)

  const chainPath = join(CONFIG_DIR, `chain/${network}.json`)
  const chain = ChainConfigSchema.parse(JSON.parse(safeReadFile(chainPath)))

  if (updates.l1) {
    chain.contracts.l1 = { ...chain.contracts.l1, ...updates.l1 }
  }
  if (updates.l2) {
    chain.contracts.l2 = { ...chain.contracts.l2, ...updates.l2 }
  }

  writeFileSync(chainPath, `${JSON.stringify(chain, null, 2)}\n`)
  console.log(`✅ Updated chain/${network}.json`)
}

// ============================================================================
// Validation
// ============================================================================

const CONFIG_VALIDATORS = {
  'contracts.json': ContractsConfigSchema,
  'services.json': ServicesConfigSchema,
  'eil.json': EILConfigSchema,
} as const

/**
 * Validate config files are properly formatted and match schemas
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  for (const [file, schema] of Object.entries(CONFIG_VALIDATORS)) {
    const path = join(CONFIG_DIR, file)
    const raw = JSON.parse(safeReadFile(path))
    const result = schema.safeParse(raw)
    if (!result.success) {
      errors.push(
        `Schema validation failed for ${file}: ${result.error.message}`,
      )
    }
  }

  // Also validate federation.json exists and is valid JSON
  const federationPath = join(CONFIG_DIR, 'federation.json')
  JSON.parse(safeReadFile(federationPath))

  return { valid: errors.length === 0, errors }
}

/**
 * Print config update summary
 */
export function printConfigSummary(network: NetworkType): void {
  console.log(`\n📋 Config Summary for ${network}\n`)
  console.log('─'.repeat(60))

  // Count contracts using typed access
  const contracts = loadContractsFile()
  const netContracts = contracts[network]
  let total = 0
  let configured = 0

  for (const category of Object.keys(netContracts)) {
    if (category === 'chainId') continue
    const categoryContracts =
      netContracts[category as keyof typeof netContracts]
    if (typeof categoryContracts === 'object') {
      for (const address of Object.values(
        categoryContracts as Record<string, string>,
      )) {
        total++
        if (address) configured++
      }
    }
  }

  console.log(`Contracts: ${configured}/${total} configured`)

  // Services - load with validation
  loadServicesFile()
  console.log(`Services: Configured for ${network}`)

  console.log('─'.repeat(60))
}
