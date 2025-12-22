export const StorageProviderType = {
  IPFS_NODE: 'IPFS_NODE',
  FILECOIN: 'FILECOIN',
  ARWEAVE: 'ARWEAVE',
  CLOUD_S3: 'CLOUD_S3',
  CLOUD_VERCEL: 'CLOUD_VERCEL',
  CLOUD_R2: 'CLOUD_R2',
  HYBRID: 'HYBRID',
} as const
export type StorageProviderType =
  (typeof StorageProviderType)[keyof typeof StorageProviderType]
