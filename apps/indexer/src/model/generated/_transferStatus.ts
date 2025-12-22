export const TransferStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const
export type TransferStatus =
  (typeof TransferStatus)[keyof typeof TransferStatus]
