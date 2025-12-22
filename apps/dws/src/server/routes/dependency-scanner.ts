/**
 * Dependency Scanner Route
 *
 * Provides REST API for scanning repositories and registering dependencies
 * for deep funding. Integrates with the DependencyScanner from autocrat
 * and syncs results to DeepFundingDistributor.
 *
 * Features:
 * - Scan GitHub repos for dependencies
 * - Auto-register scanned dependencies on-chain
 * - Support for npm, pypi, cargo, go
 * - Lookup registered contributors for dependencies
 */

import { Hono } from 'hono'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { scanRepositoryRequestSchema } from '../../shared/schemas'
import { expectValid } from '../../shared/validation'

// ============ Types ============

// Using Zod schema for ScanRequest validation now (scanRepositoryRequestSchema)

interface ScannedDependency {
  packageName: string
  registryType: string
  version: string
  depth: number
  weight: number
  adjustedWeight: number
  isRegistered: boolean
  maintainerContributorId: string | null
}

interface ScanResult {
  repo: string
  dependencies: ScannedDependency[]
  registeredCount: number
  unregisteredCount: number
  totalWeight: number
}

// ============ ABI ============

const DEEP_FUNDING_DISTRIBUTOR_ABI = parseAbi([
  'function registerDependency(bytes32 daoId, string packageName, string registryType, bytes32 maintainerContributorId, uint256 weight, uint256 transitiveDepth, uint256 usageCount) external',
  'function getDependencyShare(bytes32 daoId, bytes32 depHash) external view returns (bytes32, bytes32, uint256, uint256, uint256, uint256, uint256, bool)',
])

const CONTRIBUTOR_REGISTRY_ABI = parseAbi([
  'function getContributorForDependency(string packageName, string registryType) external view returns (bytes32)',
])

// ============ Depth Decay ============

const MAX_BPS = 10000
const DEPTH_DECAY_BPS = 2000 // 20% decay per level

function applyDepthDecay(weight: number, depth: number): number {
  if (depth === 0) return weight

  let decayFactor = MAX_BPS
  for (let i = 0; i < depth; i++) {
    decayFactor = Math.floor(
      (decayFactor * (MAX_BPS - DEPTH_DECAY_BPS)) / MAX_BPS,
    )
  }

  return Math.floor((weight * decayFactor) / MAX_BPS)
}

// ============ Package Metadata Fetchers ============

async function fetchNpmDependencies(
  packageJson: Record<string, Record<string, string>>,
): Promise<Record<string, string>> {
  return {
    ...(packageJson.dependencies || {}),
    ...(packageJson.devDependencies || {}),
  }
}

async function fetchNpmTransitiveDeps(packageName: string): Promise<string[]> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${packageName}`)
    if (!response.ok) return []

    const data = (await response.json()) as {
      'dist-tags'?: { latest?: string }
      versions?: Record<string, { dependencies?: Record<string, string> }>
    }
    const latestVersion = data['dist-tags']?.latest
    if (!latestVersion) return []

    const versionData = data.versions?.[latestVersion]
    return Object.keys(versionData?.dependencies || {})
  } catch {
    return []
  }
}

async function fetchPyPIDependencies(
  requirementsTxt: string,
): Promise<Record<string, string>> {
  const deps: Record<string, string> = {}
  for (const line of requirementsTxt.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    // Parse requirement: package==version or package>=version etc.
    const match = trimmed.match(/^([a-zA-Z0-9_-]+)(.*)?$/)
    if (match) {
      deps[match[1]] = match[2]?.replace(/^[=<>!~]+/, '').trim() || '*'
    }
  }
  return deps
}

async function fetchCargoDependencies(
  cargoToml: string,
): Promise<Record<string, string>> {
  const deps: Record<string, string> = {}
  const inDeps = cargoToml.includes('[dependencies]')

  if (inDeps) {
    const depSection = cargoToml.split('[dependencies]')[1]?.split('[')[0] || ''
    for (const line of depSection.split('\n')) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*"?([^"]+)"?/)
      if (match) {
        deps[match[1]] = match[2].replace(/["{},\s]/g, '')
      }
    }
  }
  return deps
}

// ============ GitHub Fetcher ============

async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  token?: string,
): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.raw+json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${path}`,
      { headers },
    )

    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

// ============ Scanner ============

async function scanRepository(
  owner: string,
  repo: string,
  registryTypes: string[],
  maxDepth: number,
  token?: string,
): Promise<ScannedDependency[]> {
  const dependencies: ScannedDependency[] = []
  const seen = new Set<string>()

  // Helper to add dependency
  const addDep = (
    name: string,
    version: string,
    registryType: string,
    depth: number,
  ) => {
    const key = `${registryType}:${name}`
    if (seen.has(key)) return
    seen.add(key)

    // Base weight based on direct vs transitive
    const baseWeight = depth === 0 ? 100 : 50
    const adjustedWeight = applyDepthDecay(baseWeight, depth)

    dependencies.push({
      packageName: name,
      registryType,
      version,
      depth,
      weight: baseWeight,
      adjustedWeight,
      isRegistered: false, // Will be filled in later
      maintainerContributorId: null,
    })
  }

  // Scan npm
  if (registryTypes.includes('npm')) {
    const packageJson = await fetchRepoFile(owner, repo, 'package.json', token)
    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson)
        const directDeps = await fetchNpmDependencies(parsed)

        for (const [name, version] of Object.entries(directDeps)) {
          addDep(name, version, 'npm', 0)

          // Fetch transitive deps if depth allows
          if (maxDepth > 0) {
            const transitive = await fetchNpmTransitiveDeps(name)
            for (const transDep of transitive.slice(0, 20)) {
              // Limit transitive
              addDep(transDep, '*', 'npm', 1)
            }
          }
        }
      } catch {
        // Invalid JSON
      }
    }
  }

  // Scan pypi
  if (registryTypes.includes('pypi')) {
    const requirements = await fetchRepoFile(
      owner,
      repo,
      'requirements.txt',
      token,
    )
    if (requirements) {
      const deps = await fetchPyPIDependencies(requirements)
      for (const [name, version] of Object.entries(deps)) {
        addDep(name, version, 'pypi', 0)
      }
    }
  }

  // Scan cargo
  if (registryTypes.includes('cargo')) {
    const cargoToml = await fetchRepoFile(owner, repo, 'Cargo.toml', token)
    if (cargoToml) {
      const deps = await fetchCargoDependencies(cargoToml)
      for (const [name, version] of Object.entries(deps)) {
        addDep(name, version, 'cargo', 0)
      }
    }
  }

  // Scan go
  if (registryTypes.includes('go')) {
    const goMod = await fetchRepoFile(owner, repo, 'go.mod', token)
    if (goMod) {
      // Simple go.mod parsing
      for (const line of goMod.split('\n')) {
        const match = line.match(/^\s*([\w.-]+\/[\w.-]+\/[\w.-]+)\s+(v[\d.]+)/)
        if (match) {
          addDep(match[1], match[2], 'go', 0)
        }
      }
    }
  }

  return dependencies
}

// ============ Router ============

export function createDependencyScannerRouter(): Hono {
  const router = new Hono()

  const rpcUrl = process.env.RPC_URL || 'http://127.0.0.1:6546'
  const adminKey = process.env.DAO_ADMIN_PRIVATE_KEY
  const distributorAddress = process.env
    .DEEP_FUNDING_DISTRIBUTOR_ADDRESS as Address
  const contributorRegistryAddress = process.env
    .CONTRIBUTOR_REGISTRY_ADDRESS as Address
  const githubToken = process.env.GITHUB_TOKEN

  const publicClient = createPublicClient({ transport: http(rpcUrl) })

  // Scan a repository
  router.post('/scan', async (c) => {
    const body = expectValid(
      scanRepositoryRequestSchema,
      await c.req.json(),
      'Scan repository request',
    )
    const {
      daoId,
      repoOwner,
      repoName,
      registryTypes,
      maxDepth,
      autoRegister,
    } = body

    // Scan repository
    const deps = await scanRepository(
      repoOwner,
      repoName,
      registryTypes || ['npm', 'pypi', 'cargo', 'go'],
      maxDepth ?? 1,
      githubToken,
    )

    // Look up registered contributors
    for (const dep of deps) {
      try {
        const contributorId = (await publicClient.readContract({
          address: contributorRegistryAddress,
          abi: CONTRIBUTOR_REGISTRY_ABI,
          functionName: 'getContributorForDependency',
          args: [dep.packageName, dep.registryType],
        })) as Hex

        if (contributorId !== `0x${'0'.repeat(64)}`) {
          dep.isRegistered = true
          dep.maintainerContributorId = contributorId
        }
      } catch {
        // Contract not deployed or error
      }
    }

    const result: ScanResult = {
      repo: `${repoOwner}/${repoName}`,
      dependencies: deps,
      registeredCount: deps.filter((d) => d.isRegistered).length,
      unregisteredCount: deps.filter((d) => !d.isRegistered).length,
      totalWeight: deps.reduce((sum, d) => sum + d.adjustedWeight, 0),
    }

    // Auto-register if requested
    if (autoRegister && adminKey && distributorAddress) {
      const account = privateKeyToAccount(adminKey as Hex)
      const walletClient = createWalletClient({
        account,
        transport: http(rpcUrl),
      })

      const registered: string[] = []
      const errors: string[] = []

      for (const dep of deps) {
        try {
          await walletClient.writeContract({
            address: distributorAddress,
            abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
            functionName: 'registerDependency',
            args: [
              daoId as Hex,
              dep.packageName,
              dep.registryType,
              (dep.maintainerContributorId || `0x${'0'.repeat(64)}`) as Hex,
              BigInt(dep.adjustedWeight),
              BigInt(dep.depth),
              BigInt(1), // usageCount - we increment this for each repo
            ],
          })
          registered.push(`${dep.registryType}:${dep.packageName}`)
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error'
          errors.push(`${dep.registryType}:${dep.packageName}: ${msg}`)
        }
      }

      return c.json({
        ...result,
        autoRegistered: registered.length,
        registrationErrors: errors,
      })
    }

    return c.json(result)
  })

  // Get dependency info from on-chain
  router.get('/dependency/:registryType/:packageName', async (c) => {
    const { registryType, packageName } = c.req.param()
    const daoId = c.req.query('daoId')

    if (!daoId) {
      return c.json({ error: 'daoId query param required' }, 400)
    }

    const depHash = keccak256(Buffer.from(`${registryType}:${packageName}`))

    try {
      const result = (await publicClient.readContract({
        address: distributorAddress,
        abi: DEEP_FUNDING_DISTRIBUTOR_ABI,
        functionName: 'getDependencyShare',
        args: [daoId as Hex, depHash],
      })) as [Hex, Hex, bigint, bigint, bigint, bigint, bigint, boolean]

      return c.json({
        depHash: result[0],
        contributorId: result[1],
        weight: result[2].toString(),
        transitiveDepth: Number(result[3]),
        usageCount: Number(result[4]),
        pendingRewards: result[5].toString(),
        claimedRewards: result[6].toString(),
        isRegistered: result[7],
      })
    } catch {
      return c.json({ error: 'Dependency not found' }, 404)
    }
  })

  // Get all DAO repos to scan (from on-chain registry)
  router.get('/repos/:daoId', async (c) => {
    const { daoId } = c.req.param()

    // In production, this would fetch from DAORegistry.getLinkedRepos()
    // For now, return empty since we need the actual contract call
    return c.json({
      daoId,
      repos: [],
      message: 'Fetch linked repos from DAORegistry in production',
    })
  })

  // Health check
  router.get('/health', (c) => {
    return c.json({
      configured: !!adminKey && !!distributorAddress,
      hasGitHubToken: !!githubToken,
    })
  })

  return router
}
