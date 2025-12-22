export const OracleDisputeStatus = {
  OPEN: 'OPEN',
  CHALLENGED: 'CHALLENGED',
  RESOLVED: 'RESOLVED',
  EXPIRED: 'EXPIRED',
  ESCALATED: 'ESCALATED',
} as const
export type OracleDisputeStatus =
  (typeof OracleDisputeStatus)[keyof typeof OracleDisputeStatus]
