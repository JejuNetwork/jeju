export const OIFIntentStatus = {
  OPEN: 'OPEN',
  CLAIMED: 'CLAIMED',
  PENDING_FILL: 'PENDING_FILL',
  FILLED: 'FILLED',
  PENDING_SETTLEMENT: 'PENDING_SETTLEMENT',
  SETTLED: 'SETTLED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
} as const
export type OIFIntentStatus =
  (typeof OIFIntentStatus)[keyof typeof OIFIntentStatus]
