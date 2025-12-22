/**
 * DWS Storage Module
 *
 * Multi-backend decentralized storage with:
 * - WebTorrent P2P CDN
 * - Arweave permanent storage
 * - IPFS content addressing
 * - Content tiering (System, Popular, Private)
 * - KMS encryption for private content
 */

// Backends
export {
  ArweaveBackend,
  getArweaveBackend,
  resetArweaveBackend,
} from './arweave-backend'
export {
  type BackendManager,
  createBackendManager,
  type DownloadResponse,
  type UploadOptions,
  type UploadResponse,
} from './backends'
// Multi-backend manager
export {
  getMultiBackendManager,
  MultiBackendManager,
  resetMultiBackendManager,
} from './multi-backend'
// System content manifest
export {
  buildSystemManifest,
  packageSystemContent,
  SystemContentSeeder,
  SystemManifestBuilder,
} from './system-manifest'
// Types
export * from './types'
export {
  getWebTorrentBackend,
  resetWebTorrentBackend,
  type TorrentInfo,
  type TorrentStats,
  WebTorrentBackend,
  type WebTorrentConfig,
} from './webtorrent-backend'
