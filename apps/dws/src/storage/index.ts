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

// Types
export * from './types';

// Backends
export {
  ArweaveBackend,
  getArweaveBackend,
  resetArweaveBackend,
} from './arweave-backend';

export {
  WebTorrentBackend,
  getWebTorrentBackend,
  resetWebTorrentBackend,
  type TorrentInfo,
  type TorrentStats,
  type WebTorrentConfig,
} from './webtorrent-backend';

export {
  createBackendManager,
  type BackendManager,
  type UploadOptions as LegacyUploadOptions,
  type UploadResponse,
  type DownloadResponse,
} from './backends';

// Multi-backend manager
export {
  MultiBackendManager,
  getMultiBackendManager,
  resetMultiBackendManager,
} from './multi-backend';

// System content manifest
export {
  SystemManifestBuilder,
  SystemContentSeeder,
  buildSystemManifest,
  packageSystemContent,
} from './system-manifest';


