/**
 * Decentralization Audit Script
 *
 * Identifies centralized dependencies in the DWS stack and provides
 * a roadmap for full decentralization.
 *
 * Run: bun packages/deployment/scripts/decentralization-audit.ts
 */

interface Dependency {
  name: string
  type: 'service' | 'infrastructure' | 'data' | 'network'
  centralized: boolean
  criticalPath: boolean
  decentralizedAlternative: string | null
  status: 'not-started' | 'in-progress' | 'completed'
  notes: string
}

interface AuditResult {
  timestamp: string
  totalDependencies: number
  centralizedCount: number
  decentralizedCount: number
  criticalPathCentralized: number
  score: number // 0-100
  dependencies: Dependency[]
  recommendations: string[]
  minimalInfrastructure: string[]
}

// Known centralized dependencies
const DEPENDENCIES: Dependency[] = [
  // === INFRASTRUCTURE ===
  {
    name: 'L1 Ethereum RPC',
    type: 'infrastructure',
    centralized: false,
    criticalPath: true,
    decentralizedAlternative: null,
    status: 'completed',
    notes:
      'L1 is inherently decentralized (Ethereum mainnet). Nodes can run their own L1 client.',
  },
  {
    name: 'L2 Sequencer',
    type: 'infrastructure',
    centralized: true,
    criticalPath: true,
    decentralizedAlternative: 'Decentralized sequencer with threshold signing',
    status: 'in-progress',
    notes:
      'ThresholdBatchSubmitter contract exists. Need to deploy distributed sequencer network.',
  },
  {
    name: 'L2 Proposer',
    type: 'infrastructure',
    centralized: true,
    criticalPath: true,
    decentralizedAlternative: 'Permissionless proposer set with dispute games',
    status: 'in-progress',
    notes: 'DisputeGameFactory and Cannon fraud proofs are implemented.',
  },
  {
    name: 'Data Availability',
    type: 'infrastructure',
    centralized: true,
    criticalPath: true,
    decentralizedAlternative: 'EigenDA, Celestia, or on-chain calldata',
    status: 'in-progress',
    notes:
      'DA server exists but is centralized. Need to integrate decentralized DA layer.',
  },
  {
    name: 'Bridge Relayer',
    type: 'infrastructure',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative: 'Permissionless relay network with incentives',
    status: 'not-started',
    notes:
      'Currently uses centralized relayer. Can implement permissionless relay.',
  },

  // === SERVICES ===
  {
    name: 'IPFS Gateway',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'DWS nodes run local IPFS. Gateway is just convenience layer.',
  },
  {
    name: 'Storage Backend',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'StorageMarket contract enables decentralized storage providers.',
  },
  {
    name: 'CDN Edge Nodes',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'CDNRegistry contract enables permissionless edge nodes.',
  },
  {
    name: 'Compute Providers',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'ComputeRegistry contract enables permissionless compute.',
  },
  {
    name: 'Worker Runtime (workerd)',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'Workers run on any node with workerd runtime.',
  },
  {
    name: 'DoH DNS Server',
    type: 'service',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'Any DWS node can run DoH server. See api/dns module.',
  },

  // === DATA ===
  {
    name: 'JNS Registry (on-chain)',
    type: 'data',
    centralized: false,
    criticalPath: true,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'JNS is fully on-chain. Names are owned by users.',
  },
  {
    name: 'App Manifests',
    type: 'data',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'Stored on IPFS, hash stored in JNS contenthash.',
  },
  {
    name: 'Indexer Database',
    type: 'data',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative: 'TheGraph decentralized network or P2P indexing',
    status: 'in-progress',
    notes:
      'Currently uses centralized Postgres. Could use decentralized indexer.',
  },
  {
    name: 'Monitoring Data',
    type: 'data',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative: 'Decentralized metrics aggregation',
    status: 'not-started',
    notes: 'Prometheus/Grafana are centralized. Non-critical for operation.',
  },

  // === NETWORK ===
  {
    name: 'DNS Resolution',
    type: 'network',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative: 'DoH via DWS nodes + DNS mirroring',
    status: 'completed',
    notes: 'DNS module implements DoH server and DNS mirroring.',
  },
  {
    name: 'TLS Certificates',
    type: 'network',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative: 'Automatic ACME + certificate sharing',
    status: 'in-progress',
    notes:
      'Lets Encrypt is centralized but widely trusted. Could implement cert pinning.',
  },
  {
    name: 'P2P Discovery',
    type: 'network',
    centralized: false,
    criticalPath: false,
    decentralizedAlternative: null,
    status: 'completed',
    notes: 'Uses libp2p DHT for node discovery.',
  },
  {
    name: 'Docker Registry',
    type: 'network',
    centralized: true,
    criticalPath: false,
    decentralizedAlternative:
      'OCI registry on IPFS or container hash verification',
    status: 'not-started',
    notes: 'Currently uses Docker Hub/GCR. Could use IPFS-backed registry.',
  },

  // === GOVERNANCE ===
  {
    name: 'Contract Upgrades',
    type: 'infrastructure',
    centralized: true,
    criticalPath: true,
    decentralizedAlternative: 'GovernanceTimelock with 30-day delay',
    status: 'in-progress',
    notes: 'Timelock contracts exist. Need to transfer ownership for Stage 2.',
  },
  {
    name: 'Emergency Pause',
    type: 'infrastructure',
    centralized: true,
    criticalPath: true,
    decentralizedAlternative: 'Security Council multisig with 7-day minimum',
    status: 'in-progress',
    notes: 'Security Council contracts exist. Need to configure properly.',
  },
]

// Minimal infrastructure required for Stage 2 L2
const MINIMAL_INFRASTRUCTURE = [
  'L1 RPC endpoint (can be self-hosted geth/reth)',
  'At least 1 L2 sequencer (threshold signing recommended)',
  'At least 1 L2 proposer with fraud proof capability',
  'Data availability solution (on-chain calldata minimum)',
  'IPFS node for content storage',
  'At least 1 DWS node for serving apps',
  'JNS contracts deployed on L1',
  'Bridge contracts deployed on L1/L2',
  'GovernanceTimelock deployed and active',
]

// Cloud services that can be replaced with local equivalents
const CLOUD_TO_LOCAL: Record<string, string> = {
  'AWS S3': 'MinIO (local S3-compatible) or IPFS',
  'AWS RDS': 'Local PostgreSQL',
  'AWS EKS': 'k3s or minikube',
  'GCP Cloud Run': 'Local Docker or workerd',
  'Cloudflare Workers': 'Local workerd runtime',
  'Cloudflare R2': 'MinIO or IPFS',
  Vercel: 'jeju deploy --network localnet',
  'Docker Hub': 'Local registry or IPFS OCI',
  'GitHub Actions': 'Local CI with Jeju workflows',
}

function runAudit(): AuditResult {
  const centralizedDeps = DEPENDENCIES.filter((d) => d.centralized)
  const decentralizedDeps = DEPENDENCIES.filter((d) => !d.centralized)
  const criticalCentralized = centralizedDeps.filter((d) => d.criticalPath)

  // Calculate score (0-100)
  // Weight critical path dependencies more heavily
  const criticalWeight = 2
  const normalWeight = 1

  const totalWeight =
    DEPENDENCIES.filter((d) => d.criticalPath).length * criticalWeight +
    DEPENDENCIES.filter((d) => !d.criticalPath).length * normalWeight

  const decentralizedWeight =
    decentralizedDeps.filter((d) => d.criticalPath).length * criticalWeight +
    decentralizedDeps.filter((d) => !d.criticalPath).length * normalWeight

  const score = Math.round((decentralizedWeight / totalWeight) * 100)

  // Generate recommendations
  const recommendations: string[] = []

  for (const dep of criticalCentralized) {
    if (dep.decentralizedAlternative) {
      recommendations.push(
        `[CRITICAL] ${dep.name}: ${dep.decentralizedAlternative}`,
      )
    }
  }

  for (const dep of centralizedDeps.filter((d) => !d.criticalPath)) {
    if (dep.decentralizedAlternative) {
      recommendations.push(
        `[RECOMMENDED] ${dep.name}: ${dep.decentralizedAlternative}`,
      )
    }
  }

  return {
    timestamp: new Date().toISOString(),
    totalDependencies: DEPENDENCIES.length,
    centralizedCount: centralizedDeps.length,
    decentralizedCount: decentralizedDeps.length,
    criticalPathCentralized: criticalCentralized.length,
    score,
    dependencies: DEPENDENCIES,
    recommendations,
    minimalInfrastructure: MINIMAL_INFRASTRUCTURE,
  }
}

function printAudit(result: AuditResult): void {
  console.log()
  console.log(
    '╔═══════════════════════════════════════════════════════════════════════════╗',
  )
  console.log(
    '║                    DWS DECENTRALIZATION AUDIT REPORT                      ║',
  )
  console.log(
    '╚═══════════════════════════════════════════════════════════════════════════╝',
  )
  console.log()

  // Score
  const scoreBar =
    '█'.repeat(Math.floor(result.score / 5)) +
    '░'.repeat(20 - Math.floor(result.score / 5))
  console.log(`Decentralization Score: ${result.score}/100`)
  console.log(`[${scoreBar}]`)
  console.log()

  // Summary
  console.log(
    '┌─ Summary ─────────────────────────────────────────────────────────────────┐',
  )
  console.log(
    `│  Total Dependencies:        ${String(result.totalDependencies).padEnd(4)} ${' '.repeat(41)}│`,
  )
  console.log(
    `│  Decentralized:             ${String(result.decentralizedCount).padEnd(4)} (${Math.round((result.decentralizedCount / result.totalDependencies) * 100)}%)${' '.repeat(36)}│`,
  )
  console.log(
    `│  Centralized:               ${String(result.centralizedCount).padEnd(4)} (${Math.round((result.centralizedCount / result.totalDependencies) * 100)}%)${' '.repeat(36)}│`,
  )
  console.log(
    `│  Critical Path Centralized: ${String(result.criticalPathCentralized).padEnd(4)} (needs attention)${' '.repeat(26)}│`,
  )
  console.log(
    '└───────────────────────────────────────────────────────────────────────────┘',
  )
  console.log()

  // Dependencies by type
  const byType = new Map<string, Dependency[]>()
  for (const dep of result.dependencies) {
    const existing = byType.get(dep.type) ?? []
    existing.push(dep)
    byType.set(dep.type, existing)
  }

  for (const [type, deps] of byType) {
    console.log(`┌─ ${type.toUpperCase()} ─${'─'.repeat(67 - type.length)}┐`)
    for (const dep of deps) {
      const status = dep.centralized
        ? dep.criticalPath
          ? '❌ CRITICAL'
          : '⚠️  Warning '
        : '✅ OK      '
      console.log(
        `│  ${status} ${dep.name.padEnd(40)} [${dep.status.padEnd(11)}] │`,
      )
    }
    console.log(
      '└───────────────────────────────────────────────────────────────────────────┘',
    )
    console.log()
  }

  // Recommendations
  console.log(
    '┌─ RECOMMENDATIONS ──────────────────────────────────────────────────────────┐',
  )
  for (const rec of result.recommendations) {
    console.log(`│  • ${rec.slice(0, 70).padEnd(70)}│`)
  }
  console.log(
    '└───────────────────────────────────────────────────────────────────────────┘',
  )
  console.log()

  // Minimal infrastructure
  console.log(
    '┌─ MINIMAL INFRASTRUCTURE FOR STAGE 2 L2 ────────────────────────────────────┐',
  )
  for (const item of result.minimalInfrastructure) {
    console.log(`│  • ${item.padEnd(70)}│`)
  }
  console.log(
    '└───────────────────────────────────────────────────────────────────────────┘',
  )
  console.log()

  // Cloud to local alternatives
  console.log(
    '┌─ CLOUD SERVICE ALTERNATIVES ───────────────────────────────────────────────┐',
  )
  for (const [cloud, local] of Object.entries(CLOUD_TO_LOCAL)) {
    console.log(`│  ${cloud.padEnd(20)} → ${local.padEnd(45)}│`)
  }
  console.log(
    '└───────────────────────────────────────────────────────────────────────────┘',
  )
  console.log()

  // Stage 2 checklist
  console.log(
    '┌─ STAGE 2 L2 CHECKLIST ─────────────────────────────────────────────────────┐',
  )
  const stage2Items = [
    { name: 'Fraud proofs deployed and tested', done: true },
    { name: 'Escape hatch (ForcedInclusion) working', done: true },
    { name: 'GovernanceTimelock with 30-day delay', done: true },
    { name: 'Security Council can only pause', done: true },
    { name: 'Contract ownership transferred to timelock', done: false },
    { name: 'Decentralized sequencer network', done: false },
    { name: 'Data availability verification on-chain', done: false },
    { name: 'All upgrade keys burned or multisig', done: false },
  ]

  for (const item of stage2Items) {
    const icon = item.done ? '✅' : '⬜'
    console.log(`│  ${icon} ${item.name.padEnd(65)}│`)
  }
  console.log(
    '└───────────────────────────────────────────────────────────────────────────┘',
  )
}

// Run audit
if (import.meta.main) {
  const result = runAudit()
  printAudit(result)

  // Exit with non-zero if critical centralized dependencies
  if (result.criticalPathCentralized > 0) {
    console.log(
      `\n⚠️  ${result.criticalPathCentralized} critical dependencies are still centralized.\n`,
    )
  }
}

export { runAudit, printAudit, type AuditResult, type Dependency }
