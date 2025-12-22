export const PerpTradeType = {
  OPEN: 'OPEN',
  INCREASE: 'INCREASE',
  DECREASE: 'DECREASE',
  CLOSE: 'CLOSE',
} as const
export type PerpTradeType = (typeof PerpTradeType)[keyof typeof PerpTradeType]
