export const PerpPositionSide = {
  LONG: 'LONG',
  SHORT: 'SHORT',
} as const
export type PerpPositionSide =
  (typeof PerpPositionSide)[keyof typeof PerpPositionSide]
