export const KeepaliveResourceType = {
  IPFS_CONTENT: 'IPFS_CONTENT',
  COMPUTE_ENDPOINT: 'COMPUTE_ENDPOINT',
  TRIGGER: 'TRIGGER',
  STORAGE: 'STORAGE',
  AGENT: 'AGENT',
  CUSTOM: 'CUSTOM',
} as const
export type KeepaliveResourceType =
  (typeof KeepaliveResourceType)[keyof typeof KeepaliveResourceType]
