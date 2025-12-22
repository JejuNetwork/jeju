export const OIFSettlementStatus = {
  PENDING: 'PENDING',
  ATTESTED: 'ATTESTED',
  SETTLED: 'SETTLED',
  DISPUTED: 'DISPUTED',
  SLASHED: 'SLASHED',
} as const
export type OIFSettlementStatus =
  (typeof OIFSettlementStatus)[keyof typeof OIFSettlementStatus]
