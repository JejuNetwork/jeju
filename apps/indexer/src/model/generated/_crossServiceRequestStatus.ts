export const CrossServiceRequestStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const
export type CrossServiceRequestStatus =
  (typeof CrossServiceRequestStatus)[keyof typeof CrossServiceRequestStatus]
