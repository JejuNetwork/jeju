export const OracleDisputeOutcome = {
  VALID: 'VALID',
  INVALID: 'INVALID',
  PENDING: 'PENDING',
} as const
export type OracleDisputeOutcome =
  (typeof OracleDisputeOutcome)[keyof typeof OracleDisputeOutcome]
