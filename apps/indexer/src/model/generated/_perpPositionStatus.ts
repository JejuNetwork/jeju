export const PerpPositionStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  LIQUIDATED: 'LIQUIDATED',
} as const
export type PerpPositionStatus =
  (typeof PerpPositionStatus)[keyof typeof PerpPositionStatus]
