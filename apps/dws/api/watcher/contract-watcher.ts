/**
 * DWS Contract Watcher
 * Watches on-chain events and triggers local DWS actions
 *
 * Watches:
 * - WorkerRegistry: Deploy/update workers when registered on-chain
 * - StorageManager: Sync storage uploads
 * - CDNRegistry: Update routing when sites change
 * - JNSRegistry: Update name resolution
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, http, parseAbiItem } from 'viem'
import { localhost } from 'viem/chains'

export interface ContractAddresses {
  workerRegistry: Address
  storageManager: Address
  cdnRegistry: Address
  jnsRegistry: Address
  jnsResolver: Address
}

export interface WatcherCallbacks {
  onWorkerDeployed: (
    workerId: Hex,
    owner: Address,
    name: string,
    codeHash: Hex,
  ) => Promise<void>
  onWorkerUpdated: (
    workerId: Hex,
    version: number,
    codeHash: Hex,
  ) => Promise<void>
  onFileUploaded: (
    uploadId: Hex,
    uploader: Address,
    cid: string,
    size: bigint,
  ) => Promise<void>
  onSiteUpdated: (siteId: Hex, contentHash: Hex) => Promise<void>
  onNameUpdated: (node: Hex, contentHash: Hex) => Promise<void>
}

// Event signatures
const WORKER_DEPLOYED_EVENT = parseAbiItem(
  'event WorkerDeployed(bytes32 indexed workerId, address indexed owner, string name, bytes32 codeHash)',
)
const WORKER_UPDATED_EVENT = parseAbiItem(
  'event WorkerUpdated(bytes32 indexed workerId, uint32 version, bytes32 codeHash)',
)
const FILE_UPLOADED_EVENT = parseAbiItem(
  'event FileUploaded(bytes32 indexed uploadId, address indexed uploader, string cid, uint256 size, uint8 backend)',
)
const SITE_UPDATED_EVENT = parseAbiItem(
  'event SiteUpdated(bytes32 indexed siteId, bytes32 contentHash)',
)
const CONTENTHASH_CHANGED_EVENT = parseAbiItem(
  'event ContenthashChanged(bytes32 indexed node, bytes contenthash)',
)

export class DWSContractWatcher {
  private client: ReturnType<typeof createPublicClient>
  private addresses: ContractAddresses
  private callbacks: WatcherCallbacks
  private unwatchFns: Array<() => void> = []
  private isRunning = false

  constructor(
    rpcUrl: string,
    addresses: ContractAddresses,
    callbacks: WatcherCallbacks,
  ) {
    this.client = createPublicClient({
      chain: localhost,
      transport: http(rpcUrl),
    })
    this.addresses = addresses
    this.callbacks = callbacks
  }

  async start(): Promise<void> {
    if (this.isRunning) return
    this.isRunning = true

    console.log('[DWS Watcher] Starting contract event watcher...')

    // Watch WorkerRegistry events
    this.watchWorkerDeployed()
    this.watchWorkerUpdated()

    // Watch StorageManager events
    this.watchFileUploaded()

    // Watch CDNRegistry events
    this.watchSiteUpdated()

    // Watch JNS events
    this.watchContenthashChanged()

    console.log('[DWS Watcher] Watching for contract events')
  }

  stop(): void {
    if (!this.isRunning) return
    this.isRunning = false

    for (const unwatch of this.unwatchFns) {
      unwatch()
    }
    this.unwatchFns = []

    console.log('[DWS Watcher] Stopped')
  }

  private watchWorkerDeployed(): void {
    const unwatch = this.client.watchEvent({
      address: this.addresses.workerRegistry,
      event: WORKER_DEPLOYED_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { workerId, owner, name, codeHash } = log.args as {
            workerId: Hex
            owner: Address
            name: string
            codeHash: Hex
          }
          console.log(`[DWS Watcher] Worker deployed: ${name} (${workerId})`)
          await this.callbacks
            .onWorkerDeployed(workerId, owner, name, codeHash)
            .catch(console.error)
        }
      },
    })
    this.unwatchFns.push(unwatch)
  }

  private watchWorkerUpdated(): void {
    const unwatch = this.client.watchEvent({
      address: this.addresses.workerRegistry,
      event: WORKER_UPDATED_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { workerId, version, codeHash } = log.args as {
            workerId: Hex
            version: number
            codeHash: Hex
          }
          console.log(`[DWS Watcher] Worker updated: ${workerId} v${version}`)
          await this.callbacks
            .onWorkerUpdated(workerId, version, codeHash)
            .catch(console.error)
        }
      },
    })
    this.unwatchFns.push(unwatch)
  }

  private watchFileUploaded(): void {
    const unwatch = this.client.watchEvent({
      address: this.addresses.storageManager,
      event: FILE_UPLOADED_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { uploadId, uploader, cid, size } = log.args as {
            uploadId: Hex
            uploader: Address
            cid: string
            size: bigint
          }
          console.log(`[DWS Watcher] File uploaded: ${cid}`)
          await this.callbacks
            .onFileUploaded(uploadId, uploader, cid, size)
            .catch(console.error)
        }
      },
    })
    this.unwatchFns.push(unwatch)
  }

  private watchSiteUpdated(): void {
    const unwatch = this.client.watchEvent({
      address: this.addresses.cdnRegistry,
      event: SITE_UPDATED_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { siteId, contentHash } = log.args as {
            siteId: Hex
            contentHash: Hex
          }
          console.log(`[DWS Watcher] Site updated: ${siteId}`)
          await this.callbacks
            .onSiteUpdated(siteId, contentHash)
            .catch(console.error)
        }
      },
    })
    this.unwatchFns.push(unwatch)
  }

  private watchContenthashChanged(): void {
    const unwatch = this.client.watchEvent({
      address: this.addresses.jnsResolver,
      event: CONTENTHASH_CHANGED_EVENT,
      onLogs: async (logs) => {
        for (const log of logs) {
          const { node, contenthash } = log.args as {
            node: Hex
            contenthash: Hex
          }
          console.log(`[DWS Watcher] JNS contenthash changed: ${node}`)
          await this.callbacks
            .onNameUpdated(node, contenthash)
            .catch(console.error)
        }
      },
    })
    this.unwatchFns.push(unwatch)
  }
}

/**
 * Create a contract watcher with default callbacks for local DWS
 */
export function createLocalDWSWatcher(
  rpcUrl: string,
  addresses: ContractAddresses,
): DWSContractWatcher {
  const callbacks: WatcherCallbacks = {
    async onWorkerDeployed(workerId, owner, name, _codeHash) {
      // Fetch worker code from IPFS using _codeHash and deploy to workerd
      console.log(
        `[DWS] Deploying worker ${name} (${workerId}) for ${owner}...`,
      )
      // Implementation would:
      // 1. Fetch code from IPFS using codeHash
      // 2. Deploy to local workerd
      // 3. Register endpoint back on-chain
    },

    async onWorkerUpdated(workerId, version, _codeHash) {
      console.log(`[DWS] Updating worker ${workerId} to v${version}...`)
      // Implementation would:
      // 1. Fetch new code from IPFS
      // 2. Hot-reload worker in workerd
    },

    async onFileUploaded(_uploadId, uploader, cid, size) {
      console.log(`[DWS] Pinning file ${cid} (${size} bytes) for ${uploader}`)
      // Implementation would:
      // 1. Pin the CID to local IPFS
      // 2. Record pin in StorageManager
    },

    async onSiteUpdated(siteId, contentHash) {
      console.log(`[DWS] Updating site ${siteId} content to ${contentHash}`)
      // Implementation would:
      // 1. Fetch new content from IPFS
      // 2. Update CDN cache
    },

    async onNameUpdated(node, contentHash) {
      console.log(`[DWS] JNS name ${node} now points to ${contentHash}`)
      // Implementation would:
      // 1. Update local JNS cache
      // 2. Pre-warm CDN with new content
    },
  }

  return new DWSContractWatcher(rpcUrl, addresses, callbacks)
}
