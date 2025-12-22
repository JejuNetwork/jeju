export const StorageDealStatus = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
  FAILED: 'FAILED',
  DISPUTED: 'DISPUTED',
} as const
export type StorageDealStatus =
  (typeof StorageDealStatus)[keyof typeof StorageDealStatus]
