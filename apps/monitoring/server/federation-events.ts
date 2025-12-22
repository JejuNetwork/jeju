#!/usr/bin/env bun
/**
 * Federation Contract Event Monitor
 *
 * Monitors critical events from federation contracts and sends alerts.
 * Designed to run as a daemon or be invoked by a monitoring system.
 *
 * ## Monitored Events
 *
 * ### RegistryHub
 * - ChainRegistered: New chain joined federation
 * - RegistryRegistered: New registry added
 * - SolanaRegistryVerified: Solana registry verified via Wormhole
 * - ChainDeactivated: Chain removed from federation (CRITICAL)
 * - StakeSlashed: Chain stake was slashed (CRITICAL)
 *
 * ### CrossChainIdentitySync
 * - AgentSynced: Agent identity synced cross-chain
 * - AgentBanSynced: Ban propagated cross-chain (HIGH)
 * - AgentSlashSynced: Slash propagated cross-chain (HIGH)
 * - RateLimitExceeded: Rate limit hit (WARNING)
 *
 * ### NetworkRegistry
 * - NetworkVerified: Network achieved verified status
 * - VerificationRevoked: Network verification revoked (CRITICAL)
 * - TrustEstablished: Trust relationship created
 * - TrustRevoked: Trust relationship broken (HIGH)
 *
 * ## Usage
 *
 *   REGISTRY_HUB=0x... NETWORK_REGISTRY=0x... bun run monitoring/federation-events.ts
 *
 * ## Environment Variables
 *
 *   RPC_URL - RPC endpoint to monitor
 *   REGISTRY_HUB - RegistryHub contract address
 *   NETWORK_REGISTRY - NetworkRegistry contract address
 *   CROSS_CHAIN_SYNC - CrossChainIdentitySync contract address
 *   ALERT_WEBHOOK - Webhook URL for critical alerts (Slack, Discord, PagerDuty)
 *   PROMETHEUS_PORT - Port for Prometheus metrics (default: 9090)
 */

import {
  type Address,
  createPublicClient,
  http,
  type Log,
  parseAbi,
} from 'viem'

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://localhost:6546'
const REGISTRY_HUB = process.env.REGISTRY_HUB as Address
const NETWORK_REGISTRY = process.env.NETWORK_REGISTRY as Address
const CROSS_CHAIN_SYNC = process.env.CROSS_CHAIN_SYNC as Address
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK
const PROMETHEUS_PORT = parseInt(process.env.PROMETHEUS_PORT || '9090', 10)

// Alert severity levels
const AlertSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  HIGH: 'high',
  CRITICAL: 'critical',
} as const
type AlertSeverity = (typeof AlertSeverity)[keyof typeof AlertSeverity]

// Metrics storage with atomic update helpers to prevent race conditions
interface Metrics {
  chainsRegistered: number
  registriesAdded: number
  solanaRegistriesVerified: number
  agentsSynced: number
  bansPropagated: number
  slashesPropagated: number
  rateLimitsHit: number
  trustRelationsCreated: number
  trustRelationsBroken: number
  lastBlockProcessed: bigint
  alertsSent: number
  errors: number
}

const metrics: Metrics = {
  chainsRegistered: 0,
  registriesAdded: 0,
  solanaRegistriesVerified: 0,
  agentsSynced: 0,
  bansPropagated: 0,
  slashesPropagated: 0,
  rateLimitsHit: 0,
  trustRelationsCreated: 0,
  trustRelationsBroken: 0,
  lastBlockProcessed: 0n,
  alertsSent: 0,
  errors: 0,
}

// Mutex for serializing metric updates to prevent race conditions
let metricsLock: Promise<void> = Promise.resolve()

function withMetricsLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const currentLock = metricsLock
  let releaseLock: () => void
  metricsLock = new Promise((resolve) => {
    releaseLock = resolve
  })

  return currentLock.then(async () => {
    const result = await fn()
    releaseLock()
    return result
  })
}

// Safe metric increment helper
function incrementMetric(key: keyof Omit<Metrics, 'lastBlockProcessed'>): void {
  metrics[key]++
}

function updateLastBlock(blockNumber: bigint): void {
  if (blockNumber > metrics.lastBlockProcessed) {
    metrics.lastBlockProcessed = blockNumber
  }
}

// Event ABIs
const REGISTRY_HUB_EVENTS = parseAbi([
  'event ChainRegistered(uint256 indexed chainId, uint8 chainType, string name, address indexed operator, uint256 stake)',
  'event RegistryRegistered(bytes32 indexed registryId, uint256 indexed chainId, uint8 registryType, bytes32 contractAddress, string name)',
  'event SolanaRegistryVerified(bytes32 indexed registryId, bytes32 programId)',
  'event ChainDeactivated(uint256 indexed chainId)',
  'event StakeSlashed(uint256 indexed chainId, uint256 amount)',
  'event Paused(address account)',
  'event Unpaused(address account)',
])

const NETWORK_REGISTRY_EVENTS = parseAbi([
  'event NetworkRegistered(uint256 indexed chainId, string name, address indexed operator, uint256 stake)',
  'event NetworkVerified(uint256 indexed chainId, address indexed verifier)',
  'event VerificationRevoked(uint256 indexed chainId, string reason)',
  'event TrustEstablished(uint256 indexed sourceChainId, uint256 indexed targetChainId, address indexed attestedBy)',
  'event TrustRevoked(uint256 indexed sourceChainId, uint256 indexed targetChainId)',
  'event StakeWithdrawn(uint256 indexed chainId, address indexed operator, uint256 amount)',
])

const CROSS_CHAIN_SYNC_EVENTS = parseAbi([
  'event AgentSynced(bytes32 indexed crossChainKey, uint32 indexed originDomain, uint256 originAgentId, address owner)',
  'event AgentBanSynced(bytes32 indexed crossChainKey, uint32 originDomain)',
  'event AgentSlashSynced(bytes32 indexed crossChainKey, uint32 originDomain, uint256 slashAmount)',
  'event MessageDispatched(uint32 indexed destinationDomain, bytes32 indexed messageId, uint8 messageType)',
  'event MessageReceived(uint32 indexed originDomain, bytes32 indexed messageId, uint8 messageType)',
])

interface Alert {
  severity: AlertSeverity
  title: string
  message: string
  contract: string
  event: string
  txHash: string
  blockNumber: bigint
  timestamp: Date
}

async function sendAlert(alert: Alert): Promise<void> {
  console.log(
    `[${alert.severity.toUpperCase()}] ${alert.title}: ${alert.message}`,
  )

  if (!ALERT_WEBHOOK) {
    return
  }

  const payload = {
    severity: alert.severity,
    title: alert.title,
    message: alert.message,
    contract: alert.contract,
    event: alert.event,
    txHash: alert.txHash,
    blockNumber: alert.blockNumber.toString(),
    timestamp: alert.timestamp.toISOString(),
  }

  const response = await fetch(ALERT_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  // Update metrics atomically
  await withMetricsLock(() => {
    if (!response.ok) {
      console.error(`Failed to send alert: ${response.status}`)
      incrementMetric('errors')
    } else {
      incrementMetric('alertsSent')
    }
  })
}

function createAlert(
  severity: AlertSeverity,
  title: string,
  message: string,
  contract: string,
  event: string,
  log: Log,
): Alert {
  return {
    severity,
    title,
    message,
    contract,
    event,
    txHash: log.transactionHash || '0x',
    blockNumber: log.blockNumber || 0n,
    timestamp: new Date(),
  }
}

async function handleRegistryHubEvent(
  log: Log,
  eventName: string,
): Promise<void> {
  switch (eventName) {
    case 'ChainRegistered':
      metrics.chainsRegistered++
      await sendAlert(
        createAlert(
          AlertSeverity.INFO,
          'New Chain Registered',
          `Chain joined the federation`,
          'RegistryHub',
          eventName,
          log,
        ),
      )
      break

    case 'RegistryRegistered':
      metrics.registriesAdded++
      break

    case 'SolanaRegistryVerified':
      metrics.solanaRegistriesVerified++
      await sendAlert(
        createAlert(
          AlertSeverity.INFO,
          'Solana Registry Verified',
          `Solana registry verified via Wormhole`,
          'RegistryHub',
          eventName,
          log,
        ),
      )
      break

    case 'ChainDeactivated':
      await sendAlert(
        createAlert(
          AlertSeverity.CRITICAL,
          'Chain Deactivated',
          `A chain has been deactivated from the federation`,
          'RegistryHub',
          eventName,
          log,
        ),
      )
      break

    case 'StakeSlashed':
      await sendAlert(
        createAlert(
          AlertSeverity.CRITICAL,
          'Stake Slashed',
          `Chain stake has been slashed`,
          'RegistryHub',
          eventName,
          log,
        ),
      )
      break

    case 'Paused':
      await sendAlert(
        createAlert(
          AlertSeverity.CRITICAL,
          'Contract Paused',
          `RegistryHub has been paused`,
          'RegistryHub',
          eventName,
          log,
        ),
      )
      break
  }
}

async function handleNetworkRegistryEvent(
  log: Log,
  eventName: string,
): Promise<void> {
  await withMetricsLock(async () => {
    switch (eventName) {
      case 'NetworkVerified':
        await sendAlert(
          createAlert(
            AlertSeverity.INFO,
            'Network Verified',
            `A network has achieved verified status`,
            'NetworkRegistry',
            eventName,
            log,
          ),
        )
        break

      case 'VerificationRevoked':
        await sendAlert(
          createAlert(
            AlertSeverity.CRITICAL,
            'Verification Revoked',
            `Network verification has been revoked`,
            'NetworkRegistry',
            eventName,
            log,
          ),
        )
        break

      case 'TrustEstablished':
        incrementMetric('trustRelationsCreated')
        break

      case 'TrustRevoked':
        incrementMetric('trustRelationsBroken')
        await sendAlert(
          createAlert(
            AlertSeverity.HIGH,
            'Trust Revoked',
            `Trust relationship between networks has been broken`,
            'NetworkRegistry',
            eventName,
            log,
          ),
        )
        break
    }
  })
}

async function handleCrossChainSyncEvent(
  log: Log,
  eventName: string,
): Promise<void> {
  await withMetricsLock(async () => {
    switch (eventName) {
      case 'AgentSynced':
        incrementMetric('agentsSynced')
        break

      case 'AgentBanSynced':
        incrementMetric('bansPropagated')
        await sendAlert(
          createAlert(
            AlertSeverity.HIGH,
            'Agent Ban Synced',
            `An agent ban has been propagated cross-chain`,
            'CrossChainIdentitySync',
            eventName,
            log,
          ),
        )
        break

      case 'AgentSlashSynced':
        incrementMetric('slashesPropagated')
        await sendAlert(
          createAlert(
            AlertSeverity.HIGH,
            'Agent Slash Synced',
            `An agent slash has been propagated cross-chain`,
            'CrossChainIdentitySync',
            eventName,
            log,
          ),
        )
        break
    }
  })
}

function serveMetrics(): void {
  Bun.serve({
    port: PROMETHEUS_PORT,
    fetch() {
      const metricsText = `
# HELP federation_chains_registered Total chains registered in federation
# TYPE federation_chains_registered counter
federation_chains_registered ${metrics.chainsRegistered}

# HELP federation_registries_added Total registries added
# TYPE federation_registries_added counter
federation_registries_added ${metrics.registriesAdded}

# HELP federation_solana_verified Solana registries verified via Wormhole
# TYPE federation_solana_verified counter
federation_solana_verified ${metrics.solanaRegistriesVerified}

# HELP federation_agents_synced Agents synced cross-chain
# TYPE federation_agents_synced counter
federation_agents_synced ${metrics.agentsSynced}

# HELP federation_bans_propagated Bans propagated cross-chain
# TYPE federation_bans_propagated counter
federation_bans_propagated ${metrics.bansPropagated}

# HELP federation_slashes_propagated Slashes propagated cross-chain
# TYPE federation_slashes_propagated counter
federation_slashes_propagated ${metrics.slashesPropagated}

# HELP federation_trust_created Trust relationships created
# TYPE federation_trust_created counter
federation_trust_created ${metrics.trustRelationsCreated}

# HELP federation_trust_broken Trust relationships broken
# TYPE federation_trust_broken counter
federation_trust_broken ${metrics.trustRelationsBroken}

# HELP federation_last_block Last processed block
# TYPE federation_last_block gauge
federation_last_block ${metrics.lastBlockProcessed}

# HELP federation_alerts_sent Alerts sent
# TYPE federation_alerts_sent counter
federation_alerts_sent ${metrics.alertsSent}

# HELP federation_errors Monitoring errors
# TYPE federation_errors counter
federation_errors ${metrics.errors}
`
      return new Response(metricsText, {
        headers: { 'Content-Type': 'text/plain' },
      })
    },
  })
  console.log(
    `📊 Prometheus metrics available at http://localhost:${PROMETHEUS_PORT}/metrics`,
  )
}

async function main(): Promise<void> {
  console.log('🔍 Federation Contract Monitor Starting...\n')

  if (!REGISTRY_HUB && !NETWORK_REGISTRY && !CROSS_CHAIN_SYNC) {
    console.error('❌ At least one contract address must be provided')
    console.error('   Set REGISTRY_HUB, NETWORK_REGISTRY, or CROSS_CHAIN_SYNC')
    process.exit(1)
  }

  const client = createPublicClient({
    transport: http(RPC_URL),
  })

  const chainId = await client.getChainId()
  console.log(`Connected to chain ${chainId} at ${RPC_URL}`)

  if (REGISTRY_HUB) console.log(`Monitoring RegistryHub: ${REGISTRY_HUB}`)
  if (NETWORK_REGISTRY)
    console.log(`Monitoring NetworkRegistry: ${NETWORK_REGISTRY}`)
  if (CROSS_CHAIN_SYNC)
    console.log(`Monitoring CrossChainIdentitySync: ${CROSS_CHAIN_SYNC}`)
  console.log('')

  // Start metrics server
  serveMetrics()

  // Watch for events
  const startBlock = await client.getBlockNumber()
  metrics.lastBlockProcessed = startBlock

  console.log(`Starting from block ${startBlock}`)
  console.log('Watching for events...\n')

  if (REGISTRY_HUB) {
    client.watchContractEvent({
      address: REGISTRY_HUB,
      abi: REGISTRY_HUB_EVENTS,
      onLogs: async (logs) => {
        for (const log of logs) {
          const blockNumber = log.blockNumber ?? 0n
          await withMetricsLock(() => updateLastBlock(blockNumber))
          const eventName =
            (log as Log & { eventName?: string }).eventName || 'Unknown'
          await handleRegistryHubEvent(log, eventName)
        }
      },
    })
  }

  if (NETWORK_REGISTRY) {
    client.watchContractEvent({
      address: NETWORK_REGISTRY,
      abi: NETWORK_REGISTRY_EVENTS,
      onLogs: async (logs) => {
        for (const log of logs) {
          const blockNumber = log.blockNumber ?? 0n
          await withMetricsLock(() => updateLastBlock(blockNumber))
          const eventName =
            (log as Log & { eventName?: string }).eventName || 'Unknown'
          await handleNetworkRegistryEvent(log, eventName)
        }
      },
    })
  }

  if (CROSS_CHAIN_SYNC) {
    client.watchContractEvent({
      address: CROSS_CHAIN_SYNC,
      abi: CROSS_CHAIN_SYNC_EVENTS,
      onLogs: async (logs) => {
        for (const log of logs) {
          const blockNumber = log.blockNumber ?? 0n
          await withMetricsLock(() => updateLastBlock(blockNumber))
          const eventName =
            (log as Log & { eventName?: string }).eventName || 'Unknown'
          await handleCrossChainSyncEvent(log, eventName)
        }
      },
    })
  }

  // Keep process alive - never resolves to keep the daemon running
  await new Promise<never>(() => {
    // Intentionally empty - this promise never resolves, keeping the process alive
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
